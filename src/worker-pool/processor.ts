import { performance } from 'node:perf_hooks';
import type { OrderBookMessage, OrderBookSnapshot, LatencyRecord } from '../types.js';
import { WorkerPool } from './pool.js';

export interface WorkerPoolResult {
  results: OrderBookSnapshot[];
  latencies: LatencyRecord[];
}

export async function processBatchWithPool(
  messages: OrderBookMessage[],
  workerPath: string,
  workerCount: number,
): Promise<WorkerPoolResult> {
  const pool = new WorkerPool<OrderBookMessage, OrderBookSnapshot>({
    workerPath,
    size: workerCount,
    maxQueueSize: messages.length,
  });

  const results: OrderBookSnapshot[] = [];
  const latencies: LatencyRecord[] = [];

  const promises = messages.map(async (message) => {
    const result = await pool.dispatch(message);
    const completedAt = performance.now();
    results.push(result);
    latencies.push({ enqueuedAt: message.timestamp, completedAt });
  });

  await Promise.all(promises);
  await pool.shutdown();

  return { results, latencies };
}
