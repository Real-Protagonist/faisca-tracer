# Faísca

Simulador didáctico de instalações eléctricas: monte circuitos com equipamentos reais, opere interruptores e protecções, meça grandezas e perceba cada falha.

> O Faísca é uma ferramenta didáctica. Não substitui o projecto de uma instalação segundo o regulamento.

## Estrutura

| Pasta | Conteúdo |
| --- | --- |
| `packages/sim-core` | Núcleo de simulação em TypeScript puro, sem DOM. Ver o [README](packages/sim-core/README.md). |
| `packages/i18n` | Traduções `pt.json`, `en.json`, `fr.json` |
| `packages/content` | Exemplos (`examples/*.faisca`) e tours (`tours/*.json`) em JSON |
| `apps/desktop` | Interface: React 18, Vite, Zustand, i18next |
| `src-tauri` | Aplicação de desktop Tauri 2 |

## Desenvolvimento

Requisitos: Node 20 ou mais recente.

```
npm install
npm run dev        # interface no navegador em http://localhost:1420
npm run check      # tipos e testes unitários (Vitest)
npm run e2e        # testes de interface (Playwright)
```

Os exemplos são gerados a partir de `packages/content/examples.ts` com `npm run content`. Um teste falha se os JSON ficarem desactualizados.

Os tours são JSON editáveis: cada passo tem `{ id, step, targetSelector, textKey, waitFor, mistakes?, showMeAction }`. As condições e as acções disponíveis estão em `packages/content/tour-types.ts`; os textos ficam nas traduções.

Antes do primeiro `npm run e2e`, instale o navegador de testes com `npx playwright install chromium`.

## Aplicação de desktop (Tauri)

Para compilar a aplicação nativa são precisos:

- **Rust**, instalado com o [rustup](https://rustup.rs/).
- **No Windows:** o Visual Studio Build Tools com a carga de trabalho «Desenvolvimento para desktop com C++». O WebView2 já vem no Windows 11.
- **No macOS:** as Xcode Command Line Tools.
- **No Linux:** os pacotes `webkit2gtk-4.1` e `libappindicator` (ver os [pré-requisitos do Tauri](https://tauri.app/start/prerequisites/)).

Comandos:

```
npm run tauri:dev     # janela de desktop com recarga automática
npm run tauri:build   # instaladores em src-tauri/target/release/bundle
```

Em desktop, «Abrir» e «Guardar» usam os diálogos nativos. A cópia de recuperação fica na pasta de dados da aplicação. No navegador, guardar descarrega o ficheiro e a recuperação fica no armazenamento local.
