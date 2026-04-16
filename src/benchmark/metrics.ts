import type { LatencyRecord } from '../types.js';

export function computePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

export function computeLatencyStats(records: LatencyRecord[]) {
  const durations = records.map((r) => r.completedAt - r.enqueuedAt);
  return {
    p50: computePercentile(durations, 50),
    p95: computePercentile(durations, 95),
    p99: computePercentile(durations, 99),
    mean: durations.reduce((a, b) => a + b, 0) / durations.length,
    min: Math.min(...durations),
    max: Math.max(...durations),
  };
}
