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

Os tours são JSON editáveis: cada passo tem `{ id, step, targetSelector, textKey, waitFor, mistakes?, showMeAction }`. As condições e as acções disponíveis estão em `packages/content/tour-types.ts`; os textos ficam nas traduções. Há um tour por área: `domestic-first-light` (12 passos) e `industrial-first-motor` (10 passos).

Condições (`waitFor.type`): `next`, `deviceExists`, `wire`, `chain`, `loadState`, `probe`, `tab`, `event`, `flag`, `deviceState`, `param` (parâmetro entre `min` e `max`), `diag` (código presente ou ausente), `wireCut` (cabo cortado ou inteiro) e `all`. Acções de «Mostrar-me»: `place`, `wire`, `operate`, `press` (premir e largar), `probe`, `tab`, `flag`, `param`, `wireCut` e `sequence`.

### Programa do autómato (ladder)

O PLC guarda o programa no parâmetro `program`, em JSON, dentro do próprio `.faisca`:

```json
{ "rungs": [{ "cols": [[{ "op": "I0" }, { "op": "Q0" }], [{ "op": "I1", "nc": true }]], "coil": { "kind": "out", "op": "Q0" } }] }
```

Cada degrau é uma série de colunas; cada coluna é um grupo de contactos em paralelo (`nc: true` = contacto NF). Operandos: `I0`–`I7` (entradas a 24 V DC), `Q0`–`Q7` (saídas a relé, comuns `1L` e `2L`), `M0`–`M15`, `T0`–`T7` e `C0`–`C7`. Bobinas: `out`, `set`, `reset`, `ton` e `tof` (com `preset` em segundos), `ctu` (com `preset` em contagens) e `res` (repõe um temporizador ou contador). O exemplo acima é a auto-retenção marcha/paragem.

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
