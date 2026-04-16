import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { BenchmarkConfig, BenchmarkResult, LatencyRecord } from '../types.js';
import { generateMessages } from '../producer/stream-producer.js';
import { processOrderBookUpdate, resetOrderBook } from '../processing/order-book.js';
import { WorkerPool } from '../worker-pool/pool.js';
import type { OrderBookMessage, OrderBookSnapshot } from '../types.js';
import { computeLatencyStats } from './metrics.js';
import { formatResults, formatMarkdown } from './report.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_CONFIG: BenchmarkConfig = {
  messageCount: 20_000,
  messagesPerSecond: 10_000,
  bookDepth: 2_000,
  workerCount: 4,
  warmupMessages: 500,
};

function getMemoryRssMb(): number {
  return process.memoryUsage.rss() / 1024 / 1024;
}

/**
 * Single-threaded: process messages in an async loop using setImmediate,
 * so the event loop can actually be sampled between message batches.
 * This models a real Node.js consumer callback pattern.
 */
async function runSingleThreaded(config: BenchmarkConfig): Promise<BenchmarkResult> {
  console.log('\n\u23F3 Running single-threaded benchmark...');

  const allMessages = generateMessages(config.messageCount + config.warmupMessages, config.bookDepth);

  // Warmup — build up the order book
  resetOrderBook();
  for (let i = 0; i < config.warmupMessages; i++) {
    processOrderBookUpdate(allMessages[i]);
  }

  const benchMessages = allMessages.slice(config.warmupMessages);

  // Assign arrival timestamps at the target ingestion rate
  const intervalMs = 1000 / config.messagesPerSecond;

  if (global.gc) global.gc();

  const eld = monitorEventLoopDelay({ resolution: 10 });
  eld.enable();

  const latencies: LatencyRecord[] = [];
  resetOrderBook();

  const startTime = performance.now();

  // Process messages in batches, yielding to the event loop between batches.
  // This simulates a real consumer: messages arrive, the handler runs synchronously,
  // then the event loop checks timers/IO before the next batch.
  const BATCH_SIZE = 100;
  for (let i = 0; i < benchMessages.length; i += BATCH_SIZE) {
    const end = Math.min(i + BATCH_SIZE, benchMessages.length);
    for (let j = i; j < end; j++) {
      benchMessages[j].timestamp = startTime + j * intervalMs;
      processOrderBookUpdate(benchMessages[j]);
      latencies.push({ enqueuedAt: benchMessages[j].timestamp, completedAt: performance.now() });
    }
    // Yield to the event loop so ELD can sample
    if (i + BATCH_SIZE < benchMessages.length) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  const endTime = performance.now();
  eld.disable();
  const memAfter = getMemoryRssMb();
  const durationMs = endTime - startTime;
  const stats = computeLatencyStats(latencies);

  return {
    name: 'Single-threaded',
    config,
    throughput: (config.messageCount / durationMs) * 1000,
    latencyP50: stats.p50,
    latencyP95: stats.p95,
    latencyP99: stats.p99,
    eventLoopLagMs: Number.isFinite(eld.mean) ? eld.mean / 1e6 : 0,
    memoryRssMb: memAfter,
    totalMessages: config.messageCount,
    durationMs,
  };
}

async function runWorkerPool(config: BenchmarkConfig): Promise<BenchmarkResult> {
  console.log('\n\u23F3 Running worker-pool benchmark...');

  const allMessages = generateMessages(config.messageCount + config.warmupMessages, config.bookDepth);
  const workerPath = join(__dirname, '..', 'worker-pool', 'worker.js');

  // Warmup
  const warmupPool = new WorkerPool<OrderBookMessage, OrderBookSnapshot>({
    workerPath,
    size: config.workerCount,
    maxQueueSize: config.warmupMessages + 100,
  });
  for (let i = 0; i < config.warmupMessages; i++) {
    allMessages[i].timestamp = performance.now();
    await warmupPool.dispatch(allMessages[i]);
  }
  await warmupPool.shutdown();

  const benchMessages = allMessages.slice(config.warmupMessages);
  const intervalMs = 1000 / config.messagesPerSecond;

  if (global.gc) global.gc();

  const eld = monitorEventLoopDelay({ resolution: 10 });
  eld.enable();

  const pool = new WorkerPool<OrderBookMessage, OrderBookSnapshot>({
    workerPath,
    size: config.workerCount,
    maxQueueSize: benchMessages.length + 100,
  });

  const latencies: LatencyRecord[] = [];
  const startTime = performance.now();

  // Dispatch all messages — workers process in parallel
  const promises: Promise<void>[] = [];
  for (let i = 0; i < benchMessages.length; i++) {
    benchMessages[i].timestamp = startTime + i * intervalMs;
    const msg = benchMessages[i];
    promises.push(
      pool.dispatch(msg).then(() => {
        latencies.push({ enqueuedAt: msg.timestamp, completedAt: performance.now() });
      }),
    );
  }

  await Promise.all(promises);
  await pool.shutdown();

  const endTime = performance.now();
  eld.disable();
  const memAfter = getMemoryRssMb();
  const durationMs = endTime - startTime;
  const stats = computeLatencyStats(latencies);

  return {
    name: `Worker Pool (${config.workerCount} workers)`,
    config,
    throughput: (config.messageCount / durationMs) * 1000,
    latencyP50: stats.p50,
    latencyP95: stats.p95,
    latencyP99: stats.p99,
    eventLoopLagMs: Number.isFinite(eld.mean) ? eld.mean / 1e6 : 0,
    memoryRssMb: memAfter,
    totalMessages: config.messageCount,
    durationMs,
  };
}

async function main() {
  console.log('\u2550'.repeat(55));
  console.log('  Node.js Worker Pool Stream Processor \u2014 Benchmark');
  console.log('\u2550'.repeat(55));
  console.log(`  Messages:    ${DEFAULT_CONFIG.messageCount.toLocaleString()}`);
  console.log(`  Book depth:  ${DEFAULT_CONFIG.bookDepth.toLocaleString()} levels/side`);
  console.log(`  Workers:     ${DEFAULT_CONFIG.workerCount}`);
  console.log(`  Warmup:      ${DEFAULT_CONFIG.warmupMessages.toLocaleString()} messages`);

  const singleResult = await runSingleThreaded(DEFAULT_CONFIG);
  console.log('  \u2713 Single-threaded complete');

  const poolResult = await runWorkerPool(DEFAULT_CONFIG);
  console.log('  \u2713 Worker-pool complete');

  console.log('\n' + formatResults(singleResult, poolResult));

  const resultsPath = join(__dirname, '..', '..', 'results', 'benchmark-results.md');
  writeFileSync(resultsPath, formatMarkdown(singleResult, poolResult), 'utf-8');
  console.log(`\n\uD83D\uDCC4 Results written to results/benchmark-results.md`);
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
