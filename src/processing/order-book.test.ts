import { describe, it, expect, beforeEach } from 'vitest';
import { processOrderBookUpdate, resetOrderBook } from './order-book.js';
import type { OrderBookMessage } from '../types.js';

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

describe('processOrderBookUpdate', () => {
  beforeEach(() => {
    resetOrderBook();
  });

  it('returns a valid snapshot after a single bid', () => {
    const snap = processOrderBookUpdate(makeMessage({ side: 'bid', price: 100, quantity: 5 }));
    expect(snap.topBids).toHaveLength(1);
    expect(snap.topBids[0]).toEqual({ price: 100, quantity: 5 });
    expect(snap.topAsks).toHaveLength(0);
    expect(snap.levelsProcessed).toBe(1);
  });

  it('returns a valid snapshot after a single ask', () => {
    const snap = processOrderBookUpdate(makeMessage({ side: 'ask', price: 101, quantity: 3 }));
    expect(snap.topAsks).toHaveLength(1);
    expect(snap.topAsks[0]).toEqual({ price: 101, quantity: 3 });
    expect(snap.topBids).toHaveLength(0);
  });

  it('computes spread and mid-price correctly', () => {
    processOrderBookUpdate(makeMessage({ side: 'bid', price: 100, quantity: 1 }));
    const snap = processOrderBookUpdate(makeMessage({ side: 'ask', price: 102, quantity: 1 }));

    expect(snap.spread).toBe(2);
    expect(snap.midPrice).toBe(101);
  });

  it('sorts bids descending and asks ascending', () => {
    processOrderBookUpdate(makeMessage({ side: 'bid', price: 98, quantity: 1 }));
    processOrderBookUpdate(makeMessage({ side: 'bid', price: 100, quantity: 1 }));
    processOrderBookUpdate(makeMessage({ side: 'bid', price: 99, quantity: 1 }));
    processOrderBookUpdate(makeMessage({ side: 'ask', price: 103, quantity: 1 }));
    processOrderBookUpdate(makeMessage({ side: 'ask', price: 101, quantity: 1 }));
    const snap = processOrderBookUpdate(makeMessage({ side: 'ask', price: 102, quantity: 1 }));

    expect(snap.topBids.map((l) => l.price)).toEqual([100, 99, 98]);
    expect(snap.topAsks.map((l) => l.price)).toEqual([101, 102, 103]);
  });

  it('removes a level when quantity is 0', () => {
    processOrderBookUpdate(makeMessage({ side: 'bid', price: 100, quantity: 5 }));
    processOrderBookUpdate(makeMessage({ side: 'bid', price: 99, quantity: 3 }));
    const snap = processOrderBookUpdate(makeMessage({ side: 'bid', price: 100, quantity: 0 }));

    expect(snap.topBids).toHaveLength(1);
    expect(snap.topBids[0].price).toBe(99);
    expect(snap.levelsProcessed).toBe(1);
  });

  it('detects crossed orders', () => {
    processOrderBookUpdate(makeMessage({ side: 'ask', price: 100, quantity: 1 }));
    const snap = processOrderBookUpdate(makeMessage({ side: 'bid', price: 101, quantity: 1 }));

    expect(snap.crossedOrders).toBe(true);
  });

  it('reports no crossed orders in a normal book', () => {
    processOrderBookUpdate(makeMessage({ side: 'bid', price: 99, quantity: 1 }));
    const snap = processOrderBookUpdate(makeMessage({ side: 'ask', price: 101, quantity: 1 }));

    expect(snap.crossedOrders).toBe(false);
  });

  it('computes VWAP across all levels', () => {
    processOrderBookUpdate(makeMessage({ side: 'bid', price: 100, quantity: 2 }));
    const snap = processOrderBookUpdate(makeMessage({ side: 'ask', price: 200, quantity: 3 }));

    // VWAP = (100*2 + 200*3) / (2+3) = 800/5 = 160
    expect(snap.vwap).toBeCloseTo(160, 5);
  });
});
