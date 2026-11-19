import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

/** A versão mostrada no ecrã de arranque e no «Sobre» vem da configuração do Tauri. */
const version = JSON.parse(readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf-8')).version as string;

// Porta fixa: o Tauri abre http://localhost:1420 em desenvolvimento.
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  // A vista 3D (Three.js, ~860 kB) é um ficheiro à parte, carregado só ao abrir o separador «Físico 3D».
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1000 },
  worker: { format: 'es' },
});
