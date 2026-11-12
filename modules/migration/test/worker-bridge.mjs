// Only transport glue: executes the production Web Worker entry on a real thread.
import { parentPort, workerData } from 'node:worker_threads';
globalThis.self = globalThis;
self.postMessage = value => parentPort.postMessage(value);
await import(workerData.entry);
parentPort.on('message', data => self.onmessage({ data }));