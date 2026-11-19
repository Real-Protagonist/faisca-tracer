/** Conteúdos do Faísca Tracer: exemplos e tours, em JSON, para formadores poderem criar novos sem programar. */
import index from './examples/index.json';
import lightPoint from './examples/light-point.fast?raw';
import stairLight from './examples/stair-light.fast?raw';
import houseBoard from './examples/house-board.fast?raw';
import ttProtection from './examples/tt-protection.fast?raw';
import dolStart from './examples/dol-start.fast?raw';
import reversing from './examples/reversing.fast?raw';
import starDelta from './examples/star-delta.fast?raw';
import vfdMotor from './examples/vfd-motor.fast?raw';
import plcPump from './examples/plc-pump.fast?raw';
import exerciseIndex from './exercises/index.json';
import domesticFirstLight from './tours/domestic-first-light.json';
import industrialFirstMotor from './tours/industrial-first-motor.json';
import type { ExampleMeta } from './examples';
import type { Tour } from './tour-types';

/** Texto JSON de cada exemplo, por id. */
const TEXT: Record<string, string> = {
  'light-point': lightPoint,
  'stair-light': stairLight,
  'house-board': houseBoard,
  'tt-protection': ttProtection,
  'dol-start': dolStart,
  reversing,
  'star-delta': starDelta,
  'vfd-motor': vfdMotor,
  'plc-pump': plcPump,
};

export const EXAMPLES: (ExampleMeta & { text: string })[] = (index as ExampleMeta[]).map((m) => ({ ...m, text: TEXT[m.id]! }));
export interface ExerciseMeta {
  id: string;
  file: string;
  domain: 'domestic' | 'industrial';
  level: 'beginner' | 'pro';
}

/** Exercícios incluídos (ficheiros `.fast-ex` com selo), pela ordem da tabela. */
const EX_TEXT = import.meta.glob('./exercises/*.fast-ex', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
export const EXERCISES: (ExerciseMeta & { text: string })[] = (exerciseIndex as ExerciseMeta[]).map((m) => ({ ...m, text: EX_TEXT[`./exercises/${m.file}`]! }));

export const TOURS: Record<string, Tour> = {
  [domesticFirstLight.id]: domesticFirstLight as Tour,
  [industrialFirstMotor.id]: industrialFirstMotor as Tour,
};
export type { ExampleMeta, Tour };
export * from './tour-types';
