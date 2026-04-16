import { describe, it, expect, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WorkerPool } from './pool.js';
import type { OrderBookMessage, OrderBookSnapshot } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// We need the compiled worker, so tests must run after `tsc`.
// vitest.config.ts uses pool: 'forks' to avoid worker_threads conflicts.
function getWorkerPath(): string {
  return join(__dirname, '..', '..', 'dist', 'worker-pool', 'worker.js');
}

function makeMessage(overrides: Partial<OrderBookMessage> = {}): OrderBookMessage {
  return {
    id: 0,
    side: 'bid',
    price: 50_000,
    quantity: 1.0,
    timestamp: 0,
    ...overrides,
  };
}

describe('WorkerPool', () => {
  let pool: WorkerPool<OrderBookMessage, OrderBookSnapshot> | null = null;

  afterEach(async () => {
    if (pool) {
      await pool.shutdown();
      pool = null;
    }
  });

  it('dispatches a single task and returns a result', async () => {
    pool = new WorkerPool<OrderBookMessage, OrderBookSnapshot>({
      workerPath: getWorkerPath(),
      size: 1,
    });

    const result = await pool.dispatch(makeMessage({ side: 'bid', price: 100, quantity: 5 }));

    expect(result).toBeDefined();
    expect(result.topBids.length).toBeGreaterThanOrEqual(1);
    expect(result.topBids[0].price).toBe(100);
  });

  it('dispatches multiple tasks across workers', async () => {
    pool = new WorkerPool<OrderBookMessage, OrderBookSnapshot>({
      workerPath: getWorkerPath(),
      size: 2,
    });

    const results = await Promise.all([
      pool.dispatch(makeMessage({ side: 'bid', price: 100, quantity: 1 })),
      pool.dispatch(makeMessage({ side: 'ask', price: 101, quantity: 2 })),
      pool.dispatch(makeMessage({ side: 'bid', price: 99, quantity: 3 })),
    ]);

    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.levelsProcessed).toBeGreaterThanOrEqual(1);
    }
  });

  it('reports stats correctly', async () => {
    pool = new WorkerPool<OrderBookMessage, OrderBookSnapshot>({
      workerPath: getWorkerPath(),
      size: 2,
    });

    await pool.dispatch(makeMessage());
    await pool.dispatch(makeMessage());
    const stats = pool.stats();

    expect(stats.completedTasks).toBe(2);
    expect(stats.failedTasks).toBe(0);
    expect(stats.queuedTasks).toBe(0);
  });

  it('rejects dispatch after shutdown', async () => {
    pool = new WorkerPool<OrderBookMessage, OrderBookSnapshot>({
      workerPath: getWorkerPath(),
      size: 1,
    });

    await pool.shutdown();
    await expect(pool.dispatch(makeMessage())).rejects.toThrow('Pool is shutting down');
    pool = null; // already shut down
  });

  it('enforces backpressure when queue is full', async () => {
    pool = new WorkerPool<OrderBookMessage, OrderBookSnapshot>({
      workerPath: getWorkerPath(),
      size: 1,
      maxQueueSize: 2,
    });

    // Flood the pool — 1 in-flight + 2 queued = full, the 4th+ should reject
    const promises: Promise<OrderBookSnapshot>[] = [];
    const errors: Error[] = [];

    for (let i = 0; i < 20; i++) {
      promises.push(
        pool.dispatch(makeMessage({ id: i })).catch((err: Error) => {
          errors.push(err);
          return {} as OrderBookSnapshot;
        }),
      );
    }

    await Promise.all(promises);

    // Some should have been rejected due to queue full
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('Queue full');
  });
});
