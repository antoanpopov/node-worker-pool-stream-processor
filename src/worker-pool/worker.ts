import { parentPort } from 'node:worker_threads';
import { processOrderBookUpdate, resetOrderBook } from '../processing/order-book.js';
import type { WorkerMessage } from '../types.js';

// Each worker maintains its own independent order-book state
resetOrderBook();

parentPort?.on('message', (message: WorkerMessage) => {
  try {
    const result = processOrderBookUpdate(message.data);
    parentPort?.postMessage({ id: message.id, result });
  } catch (error) {
    parentPort?.postMessage({ id: message.id, error: String(error) });
  }
});
