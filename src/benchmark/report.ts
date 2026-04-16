import type { BenchmarkResult } from '../types.js';

function fmt(n: number, decimals = 1): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function padRight(str: string, len: number): string {
  return str + ' '.repeat(Math.max(0, len - str.length));
}

function padLeft(str: string, len: number): string {
  return ' '.repeat(Math.max(0, len - str.length)) + str;
}

export function formatResults(single: BenchmarkResult, pool: BenchmarkResult): string {
  const rows = [
    ['Throughput', `${fmt(single.throughput, 0)} msg/s`, `${fmt(pool.throughput, 0)} msg/s`],
    ['Latency p50', `${fmt(single.latencyP50)} ms`, `${fmt(pool.latencyP50)} ms`],
    ['Latency p95', `${fmt(single.latencyP95)} ms`, `${fmt(pool.latencyP95)} ms`],
    ['Latency p99', `${fmt(single.latencyP99)} ms`, `${fmt(pool.latencyP99)} ms`],
    ['Event-loop lag', `${fmt(single.eventLoopLagMs)} ms`, `${fmt(pool.eventLoopLagMs)} ms`],
    ['Memory (RSS)', `${fmt(single.memoryRssMb)} MB`, `${fmt(pool.memoryRssMb)} MB`],
  ];

  const col0Width = 16;
  const col1Width = 22;
  const col2Width = 26;
  const totalWidth = col0Width + col1Width + col2Width + 4; // +4 for separators

  const top = `\u250C${'─'.repeat(totalWidth)}\u2510`;
  const titleRow = `\u2502${padLeft(`Benchmark Results — ${fmt(single.totalMessages, 0)} messages`, totalWidth - 1).padEnd(totalWidth)}\u2502`;
  const headerSep = `\u251C${'─'.repeat(col0Width + 1)}\u252C${'─'.repeat(col1Width + 1)}\u252C${'─'.repeat(col2Width)}\u2524`;
  const header = `\u2502 ${padRight('Metric', col0Width)}\u2502 ${padRight('Single-threaded', col1Width)}\u2502 ${padRight(`Worker Pool (${pool.config.workerCount} workers)`, col2Width - 1)}\u2502`;
  const rowSep = `\u251C${'─'.repeat(col0Width + 1)}\u253C${'─'.repeat(col1Width + 1)}\u253C${'─'.repeat(col2Width)}\u2524`;
  const bottom = `\u2514${'─'.repeat(col0Width + 1)}\u2534${'─'.repeat(col1Width + 1)}\u2534${'─'.repeat(col2Width)}\u2518`;

  const lines: string[] = [top, titleRow, headerSep, header, rowSep];
  for (let i = 0; i < rows.length; i++) {
    const [label, v1, v2] = rows[i];
    lines.push(`\u2502 ${padRight(label, col0Width)}\u2502 ${padRight(v1, col1Width)}\u2502 ${padRight(v2, col2Width - 1)}\u2502`);
    if (i < rows.length - 1) lines.push(rowSep);
  }
  lines.push(bottom);

  // Summary line
  const throughputRatio = pool.throughput / Math.max(single.throughput, 1);
  const p99Ratio = single.latencyP99 / Math.max(pool.latencyP99, 0.01);
  const memRatio = pool.memoryRssMb / Math.max(single.memoryRssMb, 1);
  lines.push('');
  lines.push(
    `✓ Worker pool: ${fmt(throughputRatio, 1)}x throughput, ${fmt(p99Ratio, 0)}x lower p99 latency, at ${fmt(memRatio, 1)}x memory cost`,
  );

  return lines.join('\n');
}

export function formatMarkdown(single: BenchmarkResult, pool: BenchmarkResult): string {
  const lines: string[] = [
    `# Benchmark Results`,
    '',
    `**${fmt(single.totalMessages, 0)} messages** | Book depth: ${single.config.bookDepth} levels | Workers: ${pool.config.workerCount}`,
    '',
    '| Metric | Single-threaded | Worker Pool |',
    '|--------|-----------------|-------------|',
    `| Throughput | ${fmt(single.throughput, 0)} msg/s | ${fmt(pool.throughput, 0)} msg/s |`,
    `| Latency p50 | ${fmt(single.latencyP50)} ms | ${fmt(pool.latencyP50)} ms |`,
    `| Latency p95 | ${fmt(single.latencyP95)} ms | ${fmt(pool.latencyP95)} ms |`,
    `| Latency p99 | ${fmt(single.latencyP99)} ms | ${fmt(pool.latencyP99)} ms |`,
    `| Event-loop lag | ${fmt(single.eventLoopLagMs)} ms | ${fmt(pool.eventLoopLagMs)} ms |`,
    `| Memory (RSS) | ${fmt(single.memoryRssMb)} MB | ${fmt(pool.memoryRssMb)} MB |`,
    '',
    `> Worker pool: **${fmt(pool.throughput / Math.max(single.throughput, 1), 1)}x throughput**, **${fmt(single.latencyP99 / Math.max(pool.latencyP99, 0.01), 0)}x lower p99 latency**, at ${fmt(pool.memoryRssMb / Math.max(single.memoryRssMb, 1), 1)}x memory cost`,
    '',
    `*Generated on ${new Date().toISOString().split('T')[0]}*`,
  ];
  return lines.join('\n');
}
