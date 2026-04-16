import { performance } from 'node:perf_hooks';
import type { OrderBookMessage, OrderBookSnapshot, LatencyRecord } from '../types.js';
import { processOrderBookUpdate, resetOrderBook } from '../processing/order-book.js';

export interface SingleThreadResult {
  results: OrderBookSnapshot[];
  latencies: LatencyRecord[];
}

export function processBatch(messages: OrderBookMessage[]): SingleThreadResult {
  resetOrderBook();
  const results: OrderBookSnapshot[] = [];
  const latencies: LatencyRecord[] = [];

  for (const message of messages) {
    const enqueuedAt = message.timestamp;
    const result = processOrderBookUpdate(message);
    const completedAt = performance.now();

    results.push(result);
    latencies.push({ enqueuedAt, completedAt });
  }

  return { results, latencies };
}
