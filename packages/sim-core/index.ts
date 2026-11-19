/** @faisca/sim-core — núcleo de simulação, sem DOM. */
export * from './solver/complex';
export * from './solver/mna';
export { SparseComplexSystem } from './solver/sparse';
export { buildNetwork, makeView, CONTACT_R, type BuiltNetwork } from './solver/network';
export * from './project/types';
export * from './project/project';
export * from './devices/types';
export { Registry } from './devices/registry';
export { BUILTIN_DEVICES, createRegistry, defaultRegistry } from './devices';
export * from './devices/common';
export { motor1Rated, START_TIME } from './devices/motors';
export { APPLIANCES, DEFECTS } from './devices/loads';
export { FLOOR } from './devices/faults';
export * from './devices/symbols';
export { motor3Rated, motorModel, torqueAt, MOTOR_H, type MotorModel } from './devices/industrial/motor3';
export { VFD_THD, VFD_HARMONICS } from './devices/industrial/drives';
export { OVERLOAD_K, overloadTripTime } from './devices/industrial/helpers';
export {
  COIL_TARGETS,
  DEFAULT_PROGRAM,
  parseLadder,
  serializeLadder,
  validOperand,
  PLC_INPUTS,
  PLC_OUTPUTS,
  PLC_MEMORY,
  PLC_TIMERS,
  PLC_COUNTERS,
  type CoilKind,
  type LadderCoil,
  type LadderContact,
  type LadderProgram,
  type LadderRung,
} from './devices/industrial/plc';
export * from './diagnostics';
export * from './checks/tables';
export * from './format';
export * from './checks/compliance';
export * from './report/bom';
export * from './exercise/exercise';
export { sha256, canonical, sealOf } from './exercise/seal';
export { Simulator, MAX_ITERATIONS, type SimEvent, type SimOptions, type SolveResult } from './simulator';
export * from './worker';
