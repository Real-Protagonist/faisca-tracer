/** Todos os códigos de diagnóstico e de evento. Um teste garante que têm tradução nos três idiomas. */

export const DIAG_CODES = [
  // Ao montar
  'SOURCE_SHORT',
  'LOAD_NO_RETURN',
  'TERMINAL_UNCONNECTED',
  'SWITCH_ON_NEUTRAL',
  'PE_MISSING',
  'CABLE_UNPROTECTED',
  'WIRE_COLOR',
  // Durante a simulação
  'MCB_MAGNETIC_TRIP',
  'MCB_THERMAL_TRIP',
  'MCB_BREAKING_CAPACITY',
  'FUSE_BLOWN',
  'RCD_TRIP',
  'WRONG_VOLTAGE',
  'VOLTAGE_DROP',
  'CABLE_OVERLOAD',
  'LOOSE_CONNECTION',
  'BODY_CURRENT',
  'BATTERY_EMPTY',
  'CONTROL_UNSTABLE',
  // A pedido («Porque não funciona?»)
  'PATH_OPEN',
  'LOAD_NO_SUPPLY',
  'WIRE_CUT',
  'SOURCE_OFF',
  'LOAD_SWITCHED_OFF',
  'LOW_VOLTAGE',
  'LOAD_OK',
  'NOT_A_LOAD',
] as const;

export const EVENT_CODES = [
  'mcb_magnetic_trip',
  'mcb_thermal_trip',
  'mcb_breaking_capacity',
  'fuse_blown',
  'rcd_trip',
  'overvoltage_damage',
  'battery_empty',
  'impulse_on',
  'impulse_off',
  'motor_running',
  'motor_stalled',
  'body_current',
  'control_unstable',
] as const;
