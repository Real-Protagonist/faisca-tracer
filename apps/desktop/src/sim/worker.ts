/// <reference lib="webworker" />
/** Web Worker de simulação: só liga as mensagens ao protocolo puro do núcleo. */
import { createWorkerHandler, type WorkerRequest } from '@faisca/sim-core';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const handle = createWorkerHandler((m) => scope.postMessage(m));
scope.onmessage = (e: MessageEvent<WorkerRequest>) => handle(e.data);
