# @faisca/sim-core

Núcleo de simulação do Faísca. É TypeScript puro, sem DOM, e corre num Web Worker na aplicação ou em Node nos testes.

> O Faísca é uma ferramenta didáctica. Não substitui o projecto de uma instalação segundo o regulamento.

## Estrutura

| Pasta | Conteúdo |
| --- | --- |
| `solver/` | Números complexos, sistema linear esparso, MNA fasorial, construção da rede a partir do projecto |
| `devices/` | Um ficheiro por família de equipamentos e o registo (`Registry`) |
| `diagnostics/` | Topologia, regras de montagem, regras em simulação, «Porque não funciona?» e lista de códigos |
| `checks/` | Tabelas da IEC 60364 (Iz, resistividade, limites) e zonas da IEC 60479-1 |
| `project/` | Modelo do ficheiro `.faisca`, edição, abertura com migrações |
| `simulator.ts` | Passo no tempo, iteração até estabilizar, eventos, Icc presumida, matriz MNA |
| `worker.ts` | Protocolo de mensagens do Web Worker (puro, testável em Node) |
| `format.ts` | Números e unidades no formato de cada idioma |

## Comandos

Na raiz do repositório:

```
npm test            # todos os testes (Vitest)
npm run typecheck   # tipos do núcleo (sem lib DOM) e dos testes
npm run check       # os dois
```

No Windows, os testes arrancam por `scripts/vitest.mjs`. O script põe a letra da unidade em maiúscula: com `d:\` e `D:\` misturados, o Vitest carrega-se duas vezes e nenhum teste corre.

## Motor de simulação

- Cada terminal é um nó. Os ligadores e barramentos juntam terminais no mesmo nó.
- Cada cabo é uma resistência R = ρ · L / S, com ρ = 0,0225 (cobre) ou 0,036 (alumínio) Ω·mm²/m a 70 °C. No perfil Profissional, cada cabo tem também uma reactância de 0,08 mΩ/m.
- Elementos do solver: impedância R + jωL + 1/(jωC), fonte de tensão com fase, fonte de corrente, transformador ideal.
- AC e DC são resolvidos em separado e somados por sobreposição. Em DC, os condensadores ficam abertos e os enrolamentos dos transformadores conduzem.
- Cada nó tem uma condutância de 10⁻⁹ S para a terra (GMIN). Isto evita matrizes singulares quando há partes abertas. O erro que introduz é de cerca de 10⁻⁶ em valor relativo.
- O sistema esparso usa eliminação de Gauss com escolha de pivô de Markowitz e pivotagem parcial com limiar. Com 307 nós, a resolução demora cerca de 1,8 ms (meta: menos de 5 ms).

Em cada passo (10 a 50 ms):

1. Resolver o circuito.
2. Correr a lógica de cada equipamento.
3. Se um estado discreto mudou, resolver de novo sem avançar o tempo, até 12 vezes. Se não estabilizar, gera o evento e o diagnóstico `CONTROL_UNSTABLE`.
4. Medições e diagnóstico, calculados a pedido sobre o último resultado.

## Equipamentos (Fase 1: área doméstica)

| Família | Tipos |
| --- | --- |
| Fontes | `grid1ph`, `battery`, `solarPanel`, `transformer1ph` |
| Protecção | `mcb1p`, `mcb1pn`, `fuseGG`, `rcd2p`, `rcbo`, `mainSwitch2p` |
| Comando | `switch1`, `switch2p`, `stairSwitch`, `intermediateSwitch`, `pushButton`, `impulseRelay` |
| Cargas | `lampIncandescent`, `lampLed`, `lampFluorescent`, `socket`, `heater`, `bell` |
| Motores | `motor1ph` |
| Medição | `voltmeter`, `ammeter`, `energyMeter1ph` |
| Distribuição | `junction`, `busbar`, `earthElectrode` |
| Falhas e ensaios | `shortCircuit`, `earthFault`, `person` |

Os cabos também têm falhas próprias: `fault.cut` (fio cortado) e `fault.contactResistance` (ligação solta).

### Acrescentar um equipamento

Escreva um `DeviceDef` (ver `devices/types.ts`) e registe-o. O solver e a interface não mudam. O teste `CONTROL_UNSTABLE` em `test/diagnostics.test.ts` faz isto com um relé de teste.

Um equipamento novo também precisa de:

- traduções em `packages/i18n/*.json`: `device.<tipo>.name`, `device.<tipo>.desc`, os parâmetros, as medições e os estados. O teste de cobertura falha se faltar alguma;
- casos «normal», «limite» e «falha» em `test/devices.test.ts`. Um teste falha se o tipo não tiver casos.

## Modelos e simplificações

Os textos estão nas traduções, nas chaves `simpl.*`, para o ecrã «Sobre».

| Equipamento | Modelo |
| --- | --- |
| Rede | Fonte ideal com Zs resistiva por condutor. O neutro liga à terra por Rb. Em TN-S, o PE sai do neutro na origem. |
| Disjuntor | Térmico por I²t a partir de 1,13 · In: t = 150 / ((I/In)² − 1,13²) s. Dá 182 s a 1,45 · In e 29 s a 2,55 · In. Arrefece com a mesma lei. O magnético actua acima de 5, 10 ou 20 × In (curvas B, C, D). Se a corrente de disparo passar o Icn, gera `MCB_BREAKING_CAPACITY`. |
| Fusível gG | Tabela tempo-corrente média, interpolada em log-log. Pontos: 1,6·In → 1 h, 5·In → 2 s, 10·In → 0,1 s. Abaixo de 16 A, a curva desloca-se para 1,9·In; abaixo de 4 A, para 2,1·In. Os danos acumulam-se pela regra de Miner. |
| Diferencial | Soma fasorial das correntes dos pólos. Dispara acima de IΔn: em 40 ms até 5·IΔn e em 20 ms acima. Os tipos AC e A comportam-se da mesma forma, porque só se mede a componente alternada. O botão de teste injecta 1,5·IΔn. |
| Lâmpadas | Resistência constante. A lâmpada funde se U²/Un² passar 1,75 durante mais de 0,5 s. O LED é resistivo, com o brilho limitado pelo driver. A fluorescente é R + jX com FP 0,5. |
| Motor monofásico | Dois estados. No arranque, Z/k com FP 0,4 durante 0,3, 0,8 ou 2 s, conforme a inércia. Em marcha, a impedância vem de P, η e FP. Abaixo de 0,7 · Un o rotor fica bloqueado. |
| Bateria | f.e.m. = Un · (0,98 + 0,08 · SOC) e resistência interna. O estado de carga desce com ∫I dt / Ah. |
| Painel solar | Fonte Voc · (0,88 + 0,12 · irr) com resistência Voc / (Isc · irr). Não modela a curva I-V nem o MPPT. |
| Transformador | Ideal, com uk de 5 % resistivo (metade em cada enrolamento) e 2 % de perdas no ferro. Não modela a saturação. |
| Pessoa | Corpo de 1000 Ω mais o contacto com o chão (0, 1 kΩ ou 100 kΩ). As zonas AC-1 a AC-4 vêm de uma aproximação das curvas b e c1 da IEC 60479-1. |

## Diagnóstico

Cada diagnóstico segue o contrato de `diagnostics/types.ts`, com as chaves `diag.<código>.title|cause|hint|learn`. Os valores (`values`) vêm já formatados no idioma do projecto. A lista completa de códigos está em `diagnostics/codes.ts`.

- **Ao montar:** `SOURCE_SHORT`, `LOAD_NO_RETURN`, `TERMINAL_UNCONNECTED`, `SWITCH_ON_NEUTRAL`, `PE_MISSING`, `CABLE_UNPROTECTED`, `WIRE_COLOR`. A análise propaga a classe de cada condutor (fase, neutro, PE) a partir das fontes, através dos cabos e dos contactos.
- **Em simulação:** disparos, fusão, sobretensão, queda de tensão desde a origem (3 % na iluminação, 5 % nos outros usos), sobrecarga de cabos, ligação solta, corrente no corpo acima de 30 mA, bateria descarregada e comando instável.
- **A pedido:** `whyNotWorking(sim, carga)` procura, da carga até à fonte, o caminho com menos elementos abertos. Depois aponta o primeiro elemento aberto. Se esse elemento tiver um diagnóstico próprio (disparo, fusível fundido), devolve-o.

## Testes

- `hand-calc.test.ts`: 55 casos que comparam o motor com o cálculo à mão.
- `devices.test.ts`: casos normal, limite e falha para cada equipamento.
- `diagnostics.test.ts`: cada código no seu cenário. Inclui uma instalação correcta, que tem de dar zero diagnósticos.
- `performance.test.ts`: 300 nós em menos de 5 ms.
- `project.test.ts`: ficheiros, migração do protótipo, nomes IEC 81346, biblioteca, formatação e worker.
- `packages/i18n/test`: paridade PT/EN/FR, cobertura das chaves, interpolação com i18next e regras de escrita das mensagens.
