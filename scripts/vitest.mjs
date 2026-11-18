// Arranca o Vitest com a letra da unidade em maiúscula (Windows): com `d:\` e `D:\` misturados,
// o Vitest carrega-se duas vezes e os testes falham com «Cannot read properties of undefined».
//
// `run` sem filtros corre duas vezes: primeiro todos os testes, depois o de desempenho sozinho.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const upper = (p) => p.replace(/^([a-z]):/, (_, l) => l.toUpperCase() + ':');
const cwd = upper(process.cwd());
const cli = upper(fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)));
const args = process.argv.slice(2);
const filters = args.slice(1).filter((a) => !a.startsWith('-'));

const vitest = (perf) =>
  spawnSync(process.execPath, [cli, ...args], { cwd, stdio: 'inherit', env: { ...process.env, FAISCA_PERF: perf ? '1' : '' } }).status ?? 1;

let status;
if (args[0] !== 'run') status = vitest(false);
else if (filters.length) status = vitest(filters.some((f) => f.includes('performance')));
else {
  status = vitest(false);
  const perf = vitest(true);
  status = status || perf;
}
process.exit(status);
