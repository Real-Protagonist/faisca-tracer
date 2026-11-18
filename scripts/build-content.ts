/**
 * Gera os exemplos em packages/content/examples/*.faisca e o índice.
 * Uso: npx tsx scripts/build-content.ts   (o teste de conteúdos falha se os JSON estiverem desactualizados)
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildExamples } from '../packages/content/examples';

const dir = join(import.meta.dirname, '../packages/content/examples');
const index = buildExamples().map(({ meta, project }) => {
  writeFileSync(join(dir, `${meta.id}.faisca`), JSON.stringify(project, null, 2) + '\n');
  return meta;
});
writeFileSync(join(dir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`${index.length} exemplos`);
