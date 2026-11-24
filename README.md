# Faísca Tracer

> Nome com acento na interface; sem acento nos ficheiros, no domínio e nas lojas: «Faisca Tracer», `faisca-tracer`, domínio `faiscatracer.com`, identificador `com.faiscatracer.desktop`. Projectos `.fast` e exercícios `.fast-ex` (os antigos `.faisca` e `.faisca-ex` continuam a abrir). Dados do autor e contas para doações: `apps/desktop/src/brand.ts`.

Simulador didáctico de instalações eléctricas: monte circuitos com equipamentos reais, opere interruptores e protecções, meça grandezas e perceba cada falha.

> O Faísca Tracer é uma ferramenta didáctica. Não substitui o projecto de uma instalação segundo o regulamento.

## Estrutura

| Pasta | Conteúdo |
| --- | --- |
| `packages/sim-core` | Núcleo de simulação em TypeScript puro, sem DOM. Ver o [README](packages/sim-core/README.md). |
| `packages/i18n` | Traduções `pt.json`, `en.json`, `fr.json` |
| `packages/content` | Exemplos (`examples/*.fast`) e tours (`tours/*.json`) em JSON |
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

### Vista física 3D

O separador «Físico 3D» (`apps/desktop/src/view3d`) gera a cena a partir do esquema, com Three.js e React Three Fiber, em dois modos:

- **Bancada didáctica:** painel vertical com cada aparelho na posição do esquema, os modulares em calhas DIN e os cabos pelo mesmo percurso do esquema 2D, com as cores dos condutores.
- **Instalação real:** casa (doméstica) ou nave (industrial). Os aparelhos de protecção e comando ficam num quadro na parede; as lâmpadas no tecto; interruptores, tomadas e botoneiras na parede mais próxima; motores no chão; a fonte e o eléctrodo de terra numa laje exterior. Os cabos aparecem como tubos pelo tecto.

Na bancada, o modo **Ligações** torna os bornes clicáveis: desligar um cabo de um borne (a ponta fica pendurada e o cabo deixa de conduzir, `wire.detached`), voltar a ligá-lo ao mesmo borne ou a outro, e criar cabos novos entre dois bornes. Duplo clique num aparelho aproxima a câmara. As etiquetas dos aparelhos (bornes e calibre, `view3d/decals.ts`) vão todas para uma textura partilhada e uma só malha.

Cada `model3d` do núcleo tem um modelo em `view3d/models.ts`: uma malha fixa com cor por vértice, partilhada entre aparelhos iguais, mais as partes móveis (alavancas que caem no disparo, lâmpadas e sinalizadores que acendem, motores que rodam no sentido certo, contactores com bandeirola, botões que afundam, LED do PLC). Clicar num aparelho selecciona-o e opera-o. Os estados animam-se num só ciclo por fotograma, sem renderizar o React a cada passo da simulação.

Desempenho medido com 100 aparelhos numa AMD Radeon integrada: 60 fps nos dois modos, cerca de 320 chamadas de desenho e 50 mil triângulos, menos de 1 ms de lógica por fotograma. O teste `e2e/phase5-fps.spec.ts` repete a medição com a placa gráfica, sozinho e depois dos outros testes (é saltado numa máquina sem GPU). Na aplicação nativa (WebView2) a medição dá o mesmo: 60 fps.

### Programa do autómato (ladder)

O PLC guarda o programa no parâmetro `program`, em JSON, dentro do próprio `.fast`:

```json
{ "rungs": [{ "cols": [[{ "op": "I0" }, { "op": "Q0" }], [{ "op": "I1", "nc": true }]], "coil": { "kind": "out", "op": "Q0" } }] }
```

Cada degrau é uma série de colunas; cada coluna é um grupo de contactos em paralelo (`nc: true` = contacto NF). Operandos: `I0`–`I7` (entradas a 24 V DC), `Q0`–`Q7` (saídas a relé, comuns `1L` e `2L`), `M0`–`M15`, `T0`–`T7` e `C0`–`C7`. Bobinas: `out`, `set`, `reset`, `ton` e `tof` (com `preset` em segundos), `ctu` (com `preset` em contagens) e `res` (repõe um temporizador ou contador). O exemplo acima é a auto-retenção marcha/paragem.

### Exercícios

Os 16 exercícios da tabela (4 + 4 domésticos, 3 + 5 industriais) estão em `packages/content/exercises.ts` e são gravados em `packages/content/exercises/*.fast-ex` por `npm run content`. Cada um tem enunciado, projecto inicial (aparelhos colocados, cabos em falta ou parâmetros a corrigir), objectivos, solução e pontuação.

Cada objectivo é uma regra declarativa sobre o estado depois de um cenário de comandos, verificada numa simulação própria a partir do esquema do aluno:

```json
{ "id": "stop", "text": { "key": "exercise.ind-dol.obj.stop" },
  "given": [{ "press": "S1" }, { "run": 3 }],
  "rule": { "type": "then", "first": { "type": "state", "device": "M1", "is": "running" },
            "steps": [{ "press": "S0" }, { "run": 6 }],
            "rule": { "type": "not", "rule": { "type": "state", "device": "M1", "is": "running" } } } }
```

Regras: `state`, `measure`, `deviceState`, `param`, `working`, `noDiag`, `diag`, `toggles`, `compliance`, `then`, `all` e `not`; passos: `op`, `press`, `run` e `set` (ver `packages/sim-core/exercise/exercise.ts`). A verificação corre num segundo Web Worker, 0,7 s depois de cada alteração, sem parar a simulação.

O editor de exercícios (menu Exercícios → Criar exercício) usa o projecto aberto como solução e exporta um `.fast-ex` com selo SHA-256: um ficheiro alterado fora do editor é recusado ao abrir. O selo usa um sal da aplicação; impede alterações à mão, não resiste a quem estude o código.

### Verificação de conformidade e exportações

O separador «Verificação» aplica oito regras indicativas da IEC 60364: Ib ≤ In ≤ Iz, quedas de tensão, diferencial ≤ 30 mA nas tomadas, Ra × IΔn ≤ 50 V em TT, massas ligadas ao PE, cores dos condutores, interruptores na fase e poder de corte. No nível Iniciante mostra só as quatro básicas. Os limites e as referências vêm de um ficheiro de regras JSON (por omissão, os valores IEC); um país ou um formador pode abrir o seu:

```json
{ "id": "pt", "name": "Portugal (indicativo)", "maxDropLighting": 3, "maxDropOther": 5, "maxIdnSockets": 30, "touchVoltage": 50, "references": { "pe": "…" } }
```

O relatório sai em PDF, com cada regra, o resultado, a referência e o aviso de que é uma ferramenta didáctica.

Menu Ficheiro: esquema em PNG e PDF (com a legenda das cores e a lista de material), lista de material em CSV (separador «;» em PT e FR, para o Excel) e impressão (Ctrl+P). Tudo é gerado na aplicação, sem internet.

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

O instalador do Windows inclui o WebView2 (modo `offlineInstaller`): instala-se e funciona sem internet, mesmo num Windows sem WebView2. Por isso tem cerca de 190 MB. A aplicação não faz pedidos à rede (a CSP só permite recursos da própria aplicação).

Os instaladores de macOS (`.dmg`) e Linux (`.deb`, `.rpm`, `.AppImage`) compilam-se no próprio sistema; o workflow `.github/workflows/release.yml` corre os testes e compila os três com o `tauri-action`.

Em desktop, «Abrir» e «Guardar» usam os diálogos nativos. A cópia de recuperação fica na pasta de dados da aplicação. No navegador, guardar descarrega o ficheiro e a recuperação fica no armazenamento local.
