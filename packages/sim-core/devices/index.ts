/** Biblioteca de equipamentos: área doméstica (Fase 1) e industrial (Fase 4). */
import { Registry } from './registry';
import { sources } from './sources';
import { protection } from './protection';
import { control } from './control';
import { loads } from './loads';
import { motors } from './motors';
import { measurement } from './measurement';
import { distribution } from './distribution';
import { faults } from './faults';
import { annotations } from './annotations';
import { power3 } from './industrial/power';
import { command3 } from './industrial/command';
import { motor3ph } from './industrial/motor3';
import { drives } from './industrial/drives';
import { plcDevices } from './industrial/plc';
import type { DeviceDef } from './types';

export const BUILTIN_DEVICES: DeviceDef[] = [
  ...sources,
  ...protection,
  ...control,
  ...loads,
  ...motors,
  ...measurement,
  ...distribution,
  ...faults,
  ...annotations,
  ...power3,
  ...command3,
  motor3ph,
  ...drives,
  ...plcDevices,
];

/** Registo com todos os equipamentos incluídos. */
export function createRegistry(): Registry {
  return new Registry().register(...BUILTIN_DEVICES);
}

export const defaultRegistry = createRegistry();
export { Registry };
