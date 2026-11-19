/**
 * Gera os exemplos (packages/content/examples/*.faisca) e os exercícios com selo
 * (packages/content/exercises/*.faisca-ex), com os respectivos índices.
 * Uso: npx tsx scripts/build-content.ts   (o teste de conteúdos falha se os ficheiros estiverem desactualizados)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildExamples } from '../packages/content/examples';
import { buildExercises } from '../packages/content/exercises';
import { serializeExercise } from '../packages/sim-core/index';

const NL = '\n';

const dir = join(import.meta.dirname, '../packages/content/examples');
const index = buildExamples().map(({ meta, project }) => {
  writeFileSync(join(dir, `${meta.id}.faisca`), JSON.stringify(project, null, 2) + NL);
  return meta;
});
writeFileSync(join(dir, 'index.json'), JSON.stringify(index, null, 2) + NL);
console.log(`${index.length} exemplos`);

const exDir = join(import.meta.dirname, '../packages/content/exercises');
mkdirSync(exDir, { recursive: true });
const exIndex = buildExercises().map((ex) => {
  writeFileSync(join(exDir, `${ex.id}.faisca-ex`), serializeExercise(ex) + NL);
  return { id: ex.id, file: `${ex.id}.faisca-ex`, domain: ex.domain, level: ex.level };
});
writeFileSync(join(exDir, 'index.json'), JSON.stringify(exIndex, null, 2) + NL);
console.log(`${exIndex.length} exercícios`);
