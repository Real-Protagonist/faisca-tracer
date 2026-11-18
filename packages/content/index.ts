/** Conteúdos do Faísca: exemplos e tours, em JSON, para formadores poderem criar novos sem programar. */
import index from './examples/index.json';
import lightPoint from './examples/light-point.faisca?raw';
import stairLight from './examples/stair-light.faisca?raw';
import houseBoard from './examples/house-board.faisca?raw';
import ttProtection from './examples/tt-protection.faisca?raw';
import domesticFirstLight from './tours/domestic-first-light.json';
import type { ExampleMeta } from './examples';
import type { Tour } from './tour-types';

/** Texto JSON de cada exemplo, por id. */
const TEXT: Record<string, string> = {
  'light-point': lightPoint,
  'stair-light': stairLight,
  'house-board': houseBoard,
  'tt-protection': ttProtection,
};

export const EXAMPLES: (ExampleMeta & { text: string })[] = (index as ExampleMeta[]).map((m) => ({ ...m, text: TEXT[m.id]! }));
export const TOURS: Record<string, Tour> = { [domesticFirstLight.id]: domesticFirstLight as Tour };
export type { ExampleMeta, Tour };
export * from './tour-types';
