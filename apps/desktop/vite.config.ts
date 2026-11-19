import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Porta fixa: o Tauri abre http://localhost:1420 em desenvolvimento.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  // A vista 3D (Three.js, ~860 kB) é um ficheiro à parte, carregado só ao abrir o separador «Físico 3D».
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1000 },
  worker: { format: 'es' },
});
