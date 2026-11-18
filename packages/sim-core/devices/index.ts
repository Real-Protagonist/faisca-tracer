/** Biblioteca de equipamentos (Fase 1: área doméstica). */
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
];

/** Registo com todos os equipamentos incluídos. */
export function createRegistry(): Registry {
  return new Registry().register(...BUILTIN_DEVICES);
}

export const defaultRegistry = createRegistry();
export { Registry };
