import { performance } from 'node:perf_hooks';
import type { OrderBookMessage } from '../types.js';

/**
 * Generates synthetic order-book messages.
 * Spreads prices across a realistic range with random walks.
 */
export function generateMessages(count: number, bookDepth: number): OrderBookMessage[] {
  const messages: OrderBookMessage[] = [];
  const basePrice = 50_000; // BTC-like price

  // Pre-seed the book with `bookDepth` levels on each side
  for (let i = 0; i < bookDepth; i++) {
    messages.push({
      id: messages.length,
      side: 'bid',
      price: basePrice - (i + 1) * 0.01,
      quantity: Math.random() * 10 + 0.1,
      timestamp: performance.now(),
    });
    messages.push({
      id: messages.length,
      side: 'ask',
      price: basePrice + (i + 1) * 0.01,
      quantity: Math.random() * 10 + 0.1,
      timestamp: performance.now(),
    });
  }

  // Generate remaining messages as random updates
  const remaining = count - messages.length;
  for (let i = 0; i < remaining; i++) {
    const side: 'bid' | 'ask' = Math.random() > 0.5 ? 'bid' : 'ask';
    const offset = (Math.random() * bookDepth) * 0.01;
    const price = side === 'bid'
      ? basePrice - offset
      : basePrice + offset;
    // ~10% chance of removing a level (quantity 0)
    const quantity = Math.random() < 0.1 ? 0 : Math.random() * 10 + 0.1;

    messages.push({
      id: messages.length,
      side,
      price: Math.round(price * 100) / 100,
      quantity: Math.round(quantity * 1000) / 1000,
      timestamp: 0, // stamped at dispatch time
    });
  }

  return messages;
}
