/** Liga o store ao Web Worker e corre o relógio da simulação em tempo real. */
import type { WorkerRequest, WorkerResponse } from '@faisca/sim-core';
import { applySnapshot, setBridge, setComplianceResults, setExerciseResult, setMatrix, setWhyNot, useApp } from '../store';

/** Passo máximo enviado num fotograma (s de simulação); o núcleo subdivide em passos de 50 ms. */
const MAX_FRAME_DT = 2;

export function startSimulation(): () => void {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  // Os exercícios verificam-se num segundo worker: correm várias simulações sem parar o relógio.
  let checker: Worker | null = null;
  const checkerWorker = () => {
    if (!checker) {
      checker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      checker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.type === 'exercise') setExerciseResult(e.data.seq, e.data.result);
        else if (e.data.type === 'error') console.error('[exercício]', e.data.message);
      };
    }
    return checker;
  };
  let busy = false;
  let busySince = 0;
  const post = (m: WorkerRequest) => worker.postMessage(m);
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const m = e.data;
    if (m.type === 'snapshot') {
      busy = false;
      applySnapshot(m);
    } else if (m.type === 'whyNot') setWhyNot({ device: m.device, diagnostic: m.diagnostic });
    else if (m.type === 'matrix') setMatrix(m);
    else if (m.type === 'compliance') setComplianceResults(m.results);
    else if (m.type === 'error') {
      busy = false;
      console.error('[simulação]', m.message);
    }
  };
  setBridge({
    load: (project) => post({ type: 'load', project }),
    step: (dt) => post({ type: 'step', dt }),
    operate: (device, action, phase) => post({ type: 'operate', device, action, phase }),
    whyNot: (device) => post({ type: 'whyNot', device }),
    probes: (probes) => post({ type: 'probes', probes }),
    matrix: () => post({ type: 'matrix' }),
    reset: () => post({ type: 'reset' }),
    checkExercise: (seq, exercise, project) => checkerWorker().postMessage({ type: 'checkExercise', seq, exercise, project } satisfies WorkerRequest),
    compliance: (rules) => post({ type: 'compliance', rules }),
  });

  let last = performance.now();
  let raf = 0;
  const frame = (now: number) => {
    const elapsed = Math.min(0.25, (now - last) / 1000);
    last = now;
    const { sim } = useApp.getState();
    // Se uma resposta se perder (worker ainda sem projecto), não bloquear o relógio.
    if (busy && now - busySince > 500) busy = false;
    if (sim.realtime && sim.running && !busy) {
      busy = true;
      busySince = now;
      post({ type: 'step', dt: Math.min(MAX_FRAME_DT, elapsed * sim.speed) });
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    setBridge(null);
    worker.terminate();
    checker?.terminate();
  };
}
