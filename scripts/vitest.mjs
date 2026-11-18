// Arranca o Vitest com a letra da unidade em maiúscula (Windows): com `d:\` e `D:\` misturados,
// o Vitest carrega-se duas vezes e os testes falham com «Cannot read properties of undefined».
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const upper = (p) => p.replace(/^([a-z]):/, (_, l) => l.toUpperCase() + ':');
const cwd = upper(process.cwd());
const cli = upper(fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)));
const r = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { cwd, stdio: 'inherit' });
process.exit(r.status ?? 1);
