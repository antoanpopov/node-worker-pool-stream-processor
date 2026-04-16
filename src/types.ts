export interface OrderBookMessage {
  id: number;
  side: 'bid' | 'ask';
  price: number;
  quantity: number;
  timestamp: number; // performance.now() at creation
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderBookSnapshot {
  topBids: OrderBookLevel[];
  topAsks: OrderBookLevel[];
  spread: number;
  midPrice: number;
  vwap: number;
  crossedOrders: boolean;
  levelsProcessed: number;
}

export interface WorkerMessage {
  id: number;
  data: OrderBookMessage;
}

export interface WorkerResult {
  id: number;
  result?: OrderBookSnapshot;
  error?: string;
}

export interface BenchmarkConfig {
  messageCount: number;
  messagesPerSecond: number;
  bookDepth: number;
  workerCount: number;
  warmupMessages: number;
}

export interface LatencyRecord {
  enqueuedAt: number;
  completedAt: number;
}

export interface BenchmarkResult {
  name: string;
  config: BenchmarkConfig;
  throughput: number;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  eventLoopLagMs: number;
  memoryRssMb: number;
  totalMessages: number;
  durationMs: number;
}

export interface WorkerPoolStats {
  activeWorkers: number;
  queuedTasks: number;
  completedTasks: number;
  failedTasks: number;
}
