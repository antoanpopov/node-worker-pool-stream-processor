import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { WorkerPoolStats } from '../types.js';

interface PendingTask<TOutput> {
  resolve: (value: TOutput) => void;
  reject: (reason: Error) => void;
}

interface WorkerEntry {
  worker: Worker;
  busy: boolean;
  currentTaskId: number | null;
}

interface WorkerPoolOptions {
  workerPath: string;
  size?: number;
  maxQueueSize?: number;
}

export class WorkerPool<TInput, TOutput> {
  private workers: WorkerEntry[] = [];
  private queue: Array<{ input: TInput; id: number; resolve: (v: TOutput) => void; reject: (e: Error) => void }> = [];
  private pending = new Map<number, PendingTask<TOutput>>();
  private nextId = 0;
  private completedCount = 0;
  private failedCount = 0;
  private readonly maxQueueSize: number;
  private shuttingDown = false;

  constructor(options: WorkerPoolOptions) {
    const size = options.size ?? Math.max(1, cpus().length - 1);
    this.maxQueueSize = options.maxQueueSize ?? 10_000;

    // Resolve worker path — handle both file paths and file:// URLs
    const workerPath = options.workerPath.startsWith('file://')
      ? fileURLToPath(options.workerPath)
      : options.workerPath;

    for (let i = 0; i < size; i++) {
      const worker = new Worker(workerPath);
      const entry: WorkerEntry = { worker, busy: false, currentTaskId: null };

      worker.on('message', (msg: { id: number; result?: TOutput; error?: string }) => {
        const task = this.pending.get(msg.id);
        if (!task) return;
        this.pending.delete(msg.id);

        if (msg.error) {
          this.failedCount++;
          task.reject(new Error(msg.error));
        } else {
          this.completedCount++;
          task.resolve(msg.result as TOutput);
        }

        entry.busy = false;
        entry.currentTaskId = null;
        this.drainQueue();
      });

      worker.on('error', (err: Error) => {
        // Worker crashed — reject the in-flight task so dispatch() doesn't hang
        if (entry.currentTaskId !== null) {
          const task = this.pending.get(entry.currentTaskId);
          if (task) {
            this.pending.delete(entry.currentTaskId);
            this.failedCount++;
            task.reject(err);
          }
        }
        entry.busy = false;
        entry.currentTaskId = null;
        console.error(`Worker ${i} crashed:`, err.message);
      });

      this.workers.push(entry);
    }
  }

  dispatch(input: TInput): Promise<TOutput> {
    if (this.shuttingDown) {
      return Promise.reject(new Error('Pool is shutting down'));
    }

    return new Promise<TOutput>((resolve, reject) => {
      const id = this.nextId++;

      // Try to find an idle worker immediately
      const idle = this.workers.find((w) => !w.busy);
      if (idle) {
        idle.busy = true;
        idle.currentTaskId = id;
        this.pending.set(id, { resolve, reject });
        idle.worker.postMessage({ id, data: input });
        return;
      }

      // No idle worker — queue the task
      if (this.queue.length >= this.maxQueueSize) {
        this.failedCount++;
        reject(new Error(`Queue full (max ${this.maxQueueSize})`));
        return;
      }

      this.queue.push({ input, id, resolve, reject });
    });
  }

  private drainQueue(): void {
    while (this.queue.length > 0) {
      const idle = this.workers.find((w) => !w.busy);
      if (!idle) break;

      const task = this.queue.shift();
      if (!task) break;
      idle.busy = true;
      idle.currentTaskId = task.id;
      this.pending.set(task.id, { resolve: task.resolve, reject: task.reject });
      idle.worker.postMessage({ id: task.id, data: task.input });
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;

    // Wait for all pending tasks
    if (this.pending.size > 0) {
      await new Promise<void>((resolve) => {
        const check = () => {
          if (this.pending.size === 0) {
            resolve();
          } else {
            setTimeout(check, 10);
          }
        };
        check();
      });
    }

    await Promise.all(this.workers.map((w) => w.worker.terminate()));
    this.workers = [];
  }

  stats(): WorkerPoolStats {
    return {
      activeWorkers: this.workers.filter((w) => w.busy).length,
      queuedTasks: this.queue.length,
      completedTasks: this.completedCount,
      failedTasks: this.failedCount,
    };
  }
}
