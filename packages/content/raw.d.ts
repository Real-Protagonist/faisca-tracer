/** Ficheiros importados como texto pelo Vite (`?raw`). */
declare module '*?raw' {
  const text: string;
  export default text;
}

/** `import.meta.glob` do Vite (o pacote de conteúdos é sempre lido pelo Vite ou pelo Vitest). */
interface ImportMeta {
  glob(pattern: string, options?: { query?: string; import?: string; eager?: boolean }): Record<string, unknown>;
}
