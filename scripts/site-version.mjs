// Marca as folhas de estilo e os scripts do site público com o hash do conteúdo
// (styles.css?v=3f2a9c1b0d), nas três páginas.
//
// Porquê: o Hostinger guarda o CSS e o JS durante 7 dias, no navegador e na CDN, e a CDN pode
// continuar a servir uma cópia antiga mesmo depois de o ficheiro mudar no servidor. Com o hash
// no endereço, cada versão nova tem um endereço novo e nenhuma cache serve a antiga.
//
// Uso: npm run site:version (depois de alterar styles.css, site.js ou lang.js, antes de publicar).
//      npm run site:version -- --check (só verifica; sai com erro se algum hash estiver desactualizado).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = join(fileURLToPath(new URL('..', import.meta.url)), 'site');
const ASSETS = ['styles.css', 'site.js', 'lang.js'];
const PAGES = ['index.html', 'en/index.html', 'fr/index.html'];
const check = process.argv.includes('--check');

const hash = Object.fromEntries(
  ASSETS.map((a) => [a, createHash('sha256').update(readFileSync(join(SITE, a))).digest('hex').slice(0, 10)]),
);

let stale = 0;
for (const page of PAGES) {
  const file = join(SITE, page);
  const before = readFileSync(file, 'utf8');
  let found = 0;
  const after = before.replace(/(href|src)="((?:\.\.\/)?)(styles\.css|site\.js|lang\.js)(?:\?v=[0-9a-f]*)?"/g, (_, attr, up, name) => {
    found++;
    return `${attr}="${up}${name}?v=${hash[name]}"`;
  });
  if (found !== ASSETS.length) throw new Error(`${page}: esperava ${ASSETS.length} referências, encontrei ${found}`);
  if (after !== before) {
    stale++;
    if (!check) writeFileSync(file, after);
    console.log(`${check ? 'desactualizado' : 'actualizado'}: site/${page}`);
  }
}
console.log(Object.entries(hash).map(([a, h]) => `${a}?v=${h}`).join('  '));
if (check && stale) process.exit(1);
