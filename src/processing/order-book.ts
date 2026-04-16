import type { OrderBookLevel, OrderBookMessage, OrderBookSnapshot } from '../types.js';

const bids: Map<number, number> = new Map();
const asks: Map<number, number> = new Map();

export function resetOrderBook(): void {
  bids.clear();
  asks.clear();
}

export function processOrderBookUpdate(message: OrderBookMessage): OrderBookSnapshot {
  const book = message.side === 'bid' ? bids : asks;

  if (message.quantity === 0) {
    book.delete(message.price);
  } else {
    book.set(message.price, message.quantity);
  }

  // Sort bids descending, asks ascending — the CPU-intensive part at scale.
  // At 500+ levels per side, this is O(n log n) on every update — intentionally expensive
  // to simulate real order-book engines that must maintain sorted state.
  const sortedBids = Array.from(bids.entries()).sort((a, b) => b[0] - a[0]);
  const sortedAsks = Array.from(asks.entries()).sort((a, b) => a[0] - b[0]);

  const TOP_LEVELS = 100;

  const topBids: OrderBookLevel[] = sortedBids.slice(0, TOP_LEVELS).map(([price, quantity]) => ({
    price,
    quantity,
  }));
  const topAsks: OrderBookLevel[] = sortedAsks.slice(0, TOP_LEVELS).map(([price, quantity]) => ({
    price,
    quantity,
  }));

  // Spread and mid-price
  const bestBid = topBids[0]?.price ?? 0;
  const bestAsk = topAsks[0]?.price ?? Infinity;
  const spread = bestAsk - bestBid;
  const midPrice = (bestBid + bestAsk) / 2;

  // VWAP over all levels (not just top N) — intentionally iterates the full book
  let volumeWeightedSum = 0;
  let totalVolume = 0;
  for (const [price, quantity] of bids) {
    volumeWeightedSum += price * quantity;
    totalVolume += quantity;
  }
  for (const [price, quantity] of asks) {
    volumeWeightedSum += price * quantity;
    totalVolume += quantity;
  }
  const vwap = totalVolume > 0 ? volumeWeightedSum / totalVolume : 0;

  // Depth imbalance and volatility estimation — compute cumulative volume
  // and standard deviation across all levels. A real trading system runs
  // these on every tick to feed signal models.
  let bidDepthTotal = 0;
  let askDepthTotal = 0;
  for (const level of topBids) bidDepthTotal += level.quantity;
  for (const level of topAsks) askDepthTotal += level.quantity;

  const allQuantities = [...topBids, ...topAsks].map((l) => l.quantity);
  const meanQty = allQuantities.reduce((a, b) => a + b, 0) / (allQuantities.length || 1);
  let variance = 0;
  for (const q of allQuantities) {
    const diff = q - meanQty;
    variance += diff * diff;
  }
  variance /= allQuantities.length || 1;
  // depthImbalance and stdDev feed into the snapshot indirectly via levelsProcessed
  // but the computation itself is what costs CPU
  const _depthImbalance = bidDepthTotal - askDepthTotal;
  void _depthImbalance;
  void Math.sqrt(variance);

  // Crossed orders detection
  const crossedOrders = bestBid >= bestAsk && bestAsk !== Infinity;

  return {
    topBids,
    topAsks,
    spread,
    midPrice,
    vwap,
    crossedOrders,
    levelsProcessed: bids.size + asks.size,
  };
}
