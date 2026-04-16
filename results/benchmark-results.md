# Benchmark Results

**20,000 messages** | Book depth: 2000 levels | Workers: 4

| Metric | Single-threaded | Worker Pool |
|--------|-----------------|-------------|
| Throughput | 3,307 msg/s | 6,007 msg/s |
| Latency p50 | 1,109.2 ms | 462.3 ms |
| Latency p95 | 3,681.2 ms | 1,223.6 ms |
| Latency p99 | 3,977.2 ms | 1,300.8 ms |
| Event-loop lag | 31.8 ms | 10.0 ms |
| Memory (RSS) | 85.7 MB | 155.8 MB |

> Worker pool: **1.8x throughput**, **3x lower p99 latency**, at 1.8x memory cost

*Generated on 2026-04-16*