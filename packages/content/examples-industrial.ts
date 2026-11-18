/** Exemplos industriais (Fase 4). Ver `examples.ts`. */
import { addDevice, addWire, createProject, type Device, type Project, type WireOptions } from '../sim-core/index';

type W = (a: Device, ta: string, b: Device, tb: string, o?: WireOptions) => void;
type Three = [string, string, string];

function make(level: 'beginner' | 'pro', build: (P: Project, w: W) => void): Project {
  const P = createProject({ domain: 'industrial', level });
  build(P, (a, ta, b, tb, o) => void addWire(P, a, ta, b, tb, { length: 1, ...o }));
  return P;
}

const L123: Three = ['L1', 'L2', 'L3'];
const IN3: Three = ['1', '3', '5'];
const OUT3: Three = ['2', '4', '6'];
const MOT: Three = ['U1', 'V1', 'W1'];
/** Liga três terminais de um aparelho aos três de outro, pela mesma ordem. */
const w3 = (w: W, a: Device, ta: Three, b: Device, tb: Three, o?: WireOptions) => ta.forEach((t, k) => w(a, t, b, tb[k]!, o));
const PWR: WireOptions = { section: 2.5, length: 1 };
const MOTOR_CABLE: WireOptions = { section: 2.5, length: 6 };
const CMD: WireOptions = { section: 1.5, length: 1 };
const SIGNAL: WireOptions = { section: 1, length: 1 };

/** Arranque directo com auto-retenção, sinalização de marcha (verde) e de disparo (vermelho). */
export function dolStart(): Project {
  return make('beginner', (P, w) => {
    const G = addDevice(P, 'grid3ph', { x: 40, y: 20 });
    const Q = addDevice(P, 'motorBreaker', { x: 60, y: 160, params: { Ir: 8 } });
    const K = addDevice(P, 'contactor3p', { x: 20, y: 320 });
    const F = addDevice(P, 'thermalRelay', { x: 60, y: 500, params: { Ir: 7.7 } });
    const M = addDevice(P, 'motor3ph', { x: 60, y: 660, params: { Pm: 4, load: 80 } });
    const S0 = addDevice(P, 'buttonNC', { x: 520, y: 160, name: 'S0' });
    const S1 = addDevice(P, 'buttonNO', { x: 520, y: 320, name: 'S1' });
    const H1 = addDevice(P, 'pilotLight', { x: 680, y: 320, params: { color: 'green' } });
    const H2 = addDevice(P, 'pilotLight', { x: 800, y: 320, params: { color: 'red' } });
    w3(w, G, L123, Q, IN3, PWR);
    w3(w, Q, OUT3, K, IN3, PWR);
    w3(w, K, OUT3, F, IN3, PWR);
    w3(w, F, OUT3, M, MOT, MOTOR_CABLE);
    w(G, 'PE', M, 'PE', MOTOR_CABLE);
    w(Q, '2', F, '95', CMD);
    w(F, '96', S0, '11', CMD);
    w(S0, '12', S1, '13', CMD);
    w(S1, '13', K, '13', CMD);
    w(S1, '14', K, '14', CMD);
    w(S1, '14', K, 'A1', CMD);
    w(K, 'A2', G, 'N', CMD);
    w(K, 'A1', H1, 'X1', CMD);
    w(H1, 'X2', G, 'N', CMD);
    w(Q, '2', F, '97', CMD);
    w(F, '98', H2, 'X1', CMD);
    w(H2, 'X2', G, 'N', CMD);
  });
}

/** Inversão de marcha: K1 directo, K2 troca L1 com L3; auto-retenção e encravamento pelos 21-22. */
export function reversing(): Project {
  return make('beginner', (P, w) => {
    const G = addDevice(P, 'grid3ph', { x: 40, y: 20 });
    const Q = addDevice(P, 'motorBreaker', { x: 60, y: 160, params: { Ir: 8 } });
    const K1 = addDevice(P, 'contactor3p', { x: 20, y: 320 });
    const K2 = addDevice(P, 'contactor3p', { x: 300, y: 320 });
    const F = addDevice(P, 'thermalRelay', { x: 60, y: 500, params: { Ir: 7.7 } });
    const M = addDevice(P, 'motor3ph', { x: 60, y: 660, params: { Pm: 4, load: 60 } });
    const S0 = addDevice(P, 'buttonNC', { x: 620, y: 160, name: 'S0' });
    const S1 = addDevice(P, 'buttonNO', { x: 620, y: 320, name: 'S1' });
    const S2 = addDevice(P, 'buttonNO', { x: 760, y: 320, name: 'S2' });
    w3(w, G, L123, Q, IN3, PWR);
    w3(w, Q, OUT3, K1, IN3, PWR);
    w3(w, Q, OUT3, K2, ['5', '3', '1'], PWR);
    w3(w, K1, OUT3, F, IN3, PWR);
    w3(w, K2, OUT3, F, IN3, PWR);
    w3(w, F, OUT3, M, MOT, MOTOR_CABLE);
    w(G, 'PE', M, 'PE', MOTOR_CABLE);
    w(Q, '2', F, '95', CMD);
    w(F, '96', S0, '11', CMD);
    w(S0, '12', S1, '13', CMD);
    w(S1, '13', K1, '13', CMD);
    w(S1, '14', K1, '14', CMD);
    w(S1, '14', K2, '21', CMD);
    w(K2, '22', K1, 'A1', CMD);
    w(K1, 'A2', G, 'N', CMD);
    w(S0, '12', S2, '13', CMD);
    w(S2, '13', K2, '13', CMD);
    w(S2, '14', K2, '14', CMD);
    w(S2, '14', K1, '21', CMD);
    w(K1, '22', K2, 'A1', CMD);
    w(K2, 'A2', G, 'N', CMD);
  });
}

/** Arranque estrela-triângulo com três contactores e um temporizador com atraso à operação. */
export function starDelta(): Project {
  return make('pro', (P, w) => {
    const G = addDevice(P, 'grid3ph', { x: 40, y: 20 });
    const Q = addDevice(P, 'motorBreaker', { x: 60, y: 160, params: { Ir: 15 } });
    const KM1 = addDevice(P, 'contactor3p', { x: 20, y: 320, name: 'KM1', params: { In: 18 } });
    const KM3 = addDevice(P, 'contactor3p', { x: 300, y: 320, name: 'KM3' });
    const KM2 = addDevice(P, 'contactor3p', { x: 300, y: 520, name: 'KM2' });
    const F = addDevice(P, 'thermalRelay', { x: 60, y: 500, params: { Ir: 8.5 } });
    const M = addDevice(P, 'motor3ph', { x: 60, y: 660, params: { Pm: 7.5, Vn: '400/690', connection: 'external', load: 60 } });
    const KT = addDevice(P, 'timerOn', { x: 900, y: 320, name: 'KT', params: { t: 5 } });
    const S0 = addDevice(P, 'buttonNC', { x: 620, y: 160, name: 'S0' });
    const S1 = addDevice(P, 'buttonNO', { x: 620, y: 320, name: 'S1' });
    w3(w, G, L123, Q, IN3, PWR);
    w3(w, Q, OUT3, KM1, IN3, PWR);
    w3(w, KM1, OUT3, F, IN3, PWR);
    w3(w, F, OUT3, M, MOT, MOTOR_CABLE);
    w(G, 'PE', M, 'PE', MOTOR_CABLE);
    // Triângulo: KM3 liga W2, U2 e V2 a L1, L2 e L3.
    w3(w, Q, OUT3, KM3, IN3, PWR);
    w3(w, KM3, OUT3, M, ['W2', 'U2', 'V2'], MOTOR_CABLE);
    // Estrela: KM2 une W2, U2 e V2.
    w3(w, M, ['W2', 'U2', 'V2'], KM2, IN3, MOTOR_CABLE);
    w(KM2, '2', KM2, '4', { section: 2.5, length: 0.2 });
    w(KM2, '4', KM2, '6', { section: 2.5, length: 0.2 });
    w(Q, '2', F, '95', CMD);
    w(F, '96', S0, '11', CMD);
    w(S0, '12', S1, '13', CMD);
    w(S1, '13', KM1, '13', CMD);
    w(S1, '14', KM1, '14', CMD);
    w(S1, '14', KM1, 'A1', CMD);
    w(KM1, 'A2', G, 'N', CMD);
    w(S1, '14', KT, 'A1', CMD);
    w(KT, 'A2', G, 'N', CMD);
    w(S1, '14', KT, '15', CMD);
    w(KT, '16', KM3, '21', CMD);
    w(KM3, '22', KM2, 'A1', CMD);
    w(KM2, 'A2', G, 'N', CMD);
    w(KT, '18', KM2, '21', CMD);
    w(KM2, '22', KM3, 'A1', CMD);
    w(KM3, 'A2', G, 'N', CMD);
  });
}

/** Motor com variador de frequência: selector nas entradas DI1 (direita) e DI2 (esquerda). */
export function vfdMotor(): Project {
  return make('pro', (P, w) => {
    const G = addDevice(P, 'grid3ph', { x: 40, y: 20 });
    const Q = addDevice(P, 'mcb3p', { x: 60, y: 160, params: { In: 16, curve: 'C' } });
    const U = addDevice(P, 'vfd', { x: 60, y: 320, params: { fTarget: 50, tAcc: 5, tDec: 5 } });
    const M = addDevice(P, 'motor3ph', { x: 60, y: 540, params: { Pm: 4, load: 70 } });
    const S = addDevice(P, 'selector012', { x: 400, y: 540 });
    w3(w, G, L123, Q, IN3, PWR);
    w3(w, Q, OUT3, U, L123, PWR);
    w(G, 'PE', U, 'PE', PWR);
    w3(w, U, ['U', 'V', 'W'], M, MOT, MOTOR_CABLE);
    w(G, 'PE', M, 'PE', MOTOR_CABLE);
    w(U, '24V', S, '13', SIGNAL);
    w(S, '14', U, 'DI1', SIGNAL);
    w(U, '24V', S, '23', SIGNAL);
    w(S, '24', U, 'DI2', SIGNAL);
  });
}

/** Bomba comandada pelo autómato: a bóia em nível alto liga a bomba; S0 pára; H1 sinaliza o nível. */
export function plcPump(): Project {
  return make('pro', (P, w) => {
    const G = addDevice(P, 'grid3ph', { x: 40, y: 20 });
    const Q1 = addDevice(P, 'motorBreaker', { x: 60, y: 160, params: { Ir: 3.5 } });
    const K = addDevice(P, 'contactor3p', { x: 20, y: 320 });
    const M = addDevice(P, 'motor3ph', { x: 60, y: 500, params: { Pm: 1.5, load: 80 } });
    const Q2 = addDevice(P, 'mcb1pn', { x: 360, y: 160, params: { In: 6 } });
    const program = {
      rungs: [
        // Q0 = bomba: liga com o nível alto (I0) e pára com S0 (I1).
        { cols: [[{ op: 'I0' }], [{ op: 'I1', nc: true }]], coil: { kind: 'out', op: 'Q0' } },
        // Q1 = sinalização de nível alto.
        { cols: [[{ op: 'I0' }]], coil: { kind: 'out', op: 'Q1' } },
      ],
    };
    const A = addDevice(P, 'plc', { x: 360, y: 320, params: { program: JSON.stringify(program) } });
    const B = addDevice(P, 'floatSwitch', { x: 700, y: 140 });
    const S0 = addDevice(P, 'buttonNO', { x: 860, y: 140, name: 'S0' });
    const H = addDevice(P, 'pilotLight', { x: 560, y: 560, params: { color: 'orange' } });
    w3(w, G, L123, Q1, IN3, PWR);
    w3(w, Q1, OUT3, K, IN3, PWR);
    w3(w, K, OUT3, M, MOT, { section: 2.5, length: 10 });
    w(G, 'PE', M, 'PE', { section: 2.5, length: 10 });
    w(G, 'L1', Q2, '1', CMD);
    w(G, 'N', Q2, '3', CMD);
    w(Q2, '2', A, 'L', CMD);
    w(Q2, '4', A, 'N', CMD);
    w(A, 'L+', B, '13', SIGNAL);
    w(B, '14', A, 'I0', SIGNAL);
    w(A, 'L+', S0, '13', SIGNAL);
    w(S0, '14', A, 'I1', SIGNAL);
    w(Q2, '2', A, '1L', CMD);
    w(A, 'Q0', K, 'A1', CMD);
    w(K, 'A2', Q2, '4', CMD);
    w(A, 'Q1', H, 'X1', CMD);
    w(H, 'X2', Q2, '4', CMD);
  });
}
