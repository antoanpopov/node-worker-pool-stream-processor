# node-worker-pool-stream-processor

Reference implementation for offloading high-throughput stream processing to Node.js worker threads. Includes benchmarks.

## The problem

When a Node.js service ingests high-volume event streams — order books, IoT telemetry, log pipelines — processing each event on the main thread blocks the event loop and degrades latency for everything else: HTTP handlers, health checks, WebSocket frames. The standard advice is "use a different language." Often the fix is simpler: move the heavy work to worker threads.

## The approach

This repo contains two implementations of the same CPU-intensive workload (order-book processing with 2,000 price levels per side), benchmarked against each other:

- **[Single-threaded](src/single-threaded/processor.ts)** — processes everything on the main event loop. Under load, the main thread blocks and latency degrades.
- **[Worker pool](src/worker-pool/pool.ts)** — dispatches processing to a pool of pre-warmed worker threads. The main loop stays responsive.

A [benchmark harness](src/benchmark/runner.ts) runs both under identical synthetic load and produces comparative results.

## Results

**20,000 messages** | Book depth: 2,000 levels/side | 4 workers

| Metric | Single-threaded | Worker Pool |
|--------|-----------------|-------------|
| Throughput | 3,307 msg/s | 6,007 msg/s |
| Latency p50 | 1,109 ms | 462 ms |
| Latency p95 | 3,681 ms | 1,224 ms |
| Latency p99 | 3,977 ms | 1,301 ms |
| Event-loop lag | 31.8 ms | 10.0 ms |
| Memory (RSS) | 86 MB | 156 MB |

**1.8x throughput, 3x lower p99 latency, 3x less event-loop blockage — at 1.8x memory cost.**

The worker pool doesn't eliminate latency — it trades memory for parallelism. Each worker runs its own V8 isolate, so the cost scales linearly with worker count. The win is that the main thread stays free for I/O while workers crunch numbers.

## Quick start

```bash
git clone https://github.com/antoanpopov/node-worker-pool-stream-processor.git
cd node-worker-pool-stream-processor
pnpm install
pnpm benchmark
```

## How the WorkerPool works

The [`WorkerPool`](src/worker-pool/pool.ts) is a generic, reusable abstraction — not coupled to order books:

```typescript
const pool = new WorkerPool<TInput, TOutput>({
  workerPath: './worker.js',  // Worker entry script
  size: 4,                    // Number of workers (default: os.cpus() - 1)
  maxQueueSize: 10_000,       // Backpressure: reject if queue exceeds this
});

const result = await pool.dispatch(input);
const { activeWorkers, queuedTasks, completedTasks } = pool.stats();
await pool.shutdown();
```

Key design decisions:

- **Generic over `<TInput, TOutput>`** — works with any serializable payload, not just order books.
- **Pre-warmed workers** — all threads are spawned at construction time. No cold-start on first dispatch.
- **Backpressure via `maxQueueSize`** — if workers can't keep up, `dispatch()` rejects with an error rather than growing an unbounded queue. This prevents OOM under burst load.
- **Idle-first dispatch** — finds an idle worker immediately if one exists, otherwise queues. When a worker finishes, it drains the queue.
- **Error isolation** — a worker exception rejects the individual dispatch promise. The pool continues operating.
- **Graceful shutdown** — `shutdown()` waits for all in-flight work to complete before terminating threads.

Each [worker](src/worker-pool/worker.ts) is a simple message handler:

```typescript
parentPort?.on('message', (message: WorkerMessage) => {
  try {
    const result = processOrderBookUpdate(message.data);
    parentPort?.postMessage({ id: message.id, result });
  } catch (error) {
    parentPort?.postMessage({ id: message.id, error: String(error) });
  }
});
```

Workers communicate via structured clone (`postMessage`). Each maintains its own order-book state — no shared memory, no locks, no `SharedArrayBuffer` complexity.

## When to use this pattern

- **High-frequency data streams** — order books, market data, IoT sensor feeds arriving at thousands of messages/second.
- **CPU-bound transformations** — sorting, aggregation, statistical computation, compression, hashing on each message.
- **Real-time aggregation** — building windowed summaries or snapshots that require non-trivial computation per update.
- **Batch processing within a request lifecycle** — offloading expensive computation from a request handler so the HTTP server stays responsive.

## When NOT to use this pattern

- **If your processing is I/O-bound** (database queries, HTTP calls, file reads), worker threads add overhead without benefit. Use `async`/`await` — that's what the event loop is for.
- **If your throughput is under ~1,000 msg/s with lightweight processing**, the main thread handles it fine. Don't over-engineer. Profile first.
- **If you need shared mutable state across workers**, `SharedArrayBuffer` adds significant complexity (atomics, manual memory layout). Consider whether a single-threaded approach with better data structures is simpler.
- **If you need more than ~8-12 workers**, you're likely better served by horizontal scaling (multiple processes or containers) than packing more threads into one process. V8 isolates aren't free.
- **If message ordering matters strictly**, workers process concurrently and return results out of order. You'd need a resequencing layer, which adds complexity.

## Background

This pattern is extracted from a production system I built at a crypto trading firm, where I refactored a monolithic Node.js service processing real-time order-book updates via KafkaJS. The team believed Node.js was fundamentally too slow for the workload. Moving the heavy processing to a worker pool proved the bottleneck was architecture, not runtime — latency improved dramatically with no language change.

[antoanpopov.com](https://antoanpopov.com) | [LinkedIn](https://www.linkedin.com/in/antoan-popov)

## Tech stack

- **TypeScript** (strict mode, zero `any`)
- **Node.js 22+** (LTS)
- **`node:worker_threads`** — built-in, no external threading library
- **`node:perf_hooks`** — `monitorEventLoopDelay`, `performance.now()`
- **Vitest** — testing
- **pnpm** — package manager
- **Zero runtime dependencies** — only Node.js built-ins

## License

[MIT](LICENSE)
