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

## Equipamentos

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

Área industrial (Fase 4), em `devices/industrial/`:

| Família | Tipos |
| --- | --- |
| Fontes | `grid3ph` (400/230 V, TN-S ou TT) |
| Protecção | `mcb3p`, `mcb4p`, `motorBreaker` (disjuntor-motor), `thermalRelay`, `phaseMonitor` |
| Comando | `contactor3p` (13-14 e 21-22), `auxRelay` (2 NA + 2 NF), `timerOn`, `timerOff`, `buttonNO`, `buttonNC`, `emergencyStop`, `selector012`, `plc` |
| Sensores | `limitSwitch`, `floatSwitch`, `pressureSwitch`, `inductiveSensor`, `photocell` (PNP) |
| Cargas | `heater3ph`, `capacitorBank`, `pilotLight` |
| Motores e accionamentos | `motor3ph`, `starDeltaStarter`, `softStarter`, `vfd` |
| Medição | `powerAnalyzer`, `phaseSequenceMeter` |
| Falhas e ensaios | `phaseLoss`, `phaseReversal`; no motor, rotor bloqueado e carga mecânica (0 a 200 %) |

Ainda não implementados da lista do prompt: posto de transformação MT/BT, transformador trifásico Dyn11, gerador trifásico, UPS, comutador de rede (ATS), disjuntor de caixa moldada, seccionador-fusível, relé de mínima tensão, diferencial 4P, relé de nível, sonda PT100, projectores, carga não linear, regulador de FP, motor de dois sentidos, travão electromagnético, contador trifásico, watímetro, megaohmímetro e transformadores de corrente.

Os cabos também têm falhas próprias: `fault.cut` (fio cortado) e `fault.contactResistance` (ligação solta).

### Acrescentar um equipamento

Escreva um `DeviceDef` (ver `devices/types.ts`) e registe-o. O solver e a interface não mudam. O teste `CONTROL_UNSTABLE` em `test/diagnostics.test.ts` faz isto com um relé de teste.

Um equipamento novo também precisa de:

- traduções em `packages/i18n/*.json`: `device.<tipo>.name`, `device.<tipo>.desc`, os parâmetros, as medições e os estados. O teste de cobertura falha se faltar alguma;
- casos «normal», «limite» e «falha» em `test/devices.test.ts` (domésticos) ou `test/devices-industrial.test.ts` (industriais). Um teste falha se o tipo não tiver casos.

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
| Rede trifásica | Três fontes de V/√3 a 0°, −120° e +120° com Zs por fase; neutro à terra por Rb. |
| Motor trifásico | Por enrolamento: magnetização jXm em paralelo com R1 + R2/s + jXl (R1 = R2). Os quatro parâmetros saem da placa: In e FP nominais, arranque a k · In com FP 0,4. O escorregamento vem da velocidade do passo anterior. Binário pelas componentes simétricas: T = T(V1, s) − T(V2, 2 − s). Com uma fase em falta, V1 = V2: parado, não tem binário. A sequência inversa faz rodar ao contrário. Mecânica: dω/dt = (Tm − Tc) / H, com H = 0,8, 2 ou 5 s conforme a inércia e carga 30 % constante + 70 % quadrática. Integração semi-implícita em sub-passos de 5 ms. Aquece com (I/In)² − 1 (constante de 1000 s) e queima a 100 %; queima também acima de 1,3 · Un nos enrolamentos durante 2 s. |
| Relé térmico e disjuntor-motor | t = K / ((I/Ir)² − 1,12²), K = 400 s (classe 10) ou 800 s (classe 20): 7,2 · Ir dispara em 7,9 s ou 15,8 s. Com uma fase abaixo de metade das outras, aquece 15 % mais depressa. O magnético do disjuntor-motor actua a 13 · Ir. |
| Contactor e relés | Actua a 0,75 · Uc e larga abaixo de 0,5 · Uc. Bobina com 8 VA (contactor) ou 4 VA (auxiliar) e FP 0,3. Acima de 1,3 · Uc durante 0,5 s, queima. |
| Temporizadores | Contam o tempo nos passos da simulação (resolução de 10 a 50 ms). |
| Estrela-triângulo | Integrado: estrela durante t, depois triângulo, sem tempo morto. Com contactores: o temporizador comuta 15-16 e 15-18. |
| Arrancador suave | Transformador ideal por fase, com relação de U0 a 100 % durante a rampa; depois liga directo. |
| Variador | V/f constante: fonte trifásica de kf · 400 V à frequência kf · 50 Hz. A frequência propaga-se pelos cabos e contactos fechados até ao motor, que escala as reactâncias e o escorregamento. Entrada resistiva que absorve a potência de saída / 0,97; harmónicos fixos de um rectificador de 6 impulsos (5.º 35 %, 7.º 20 %, 11.º 9 %, 13.º 7 %; THD ≈ 42 %). Sem uma fase à entrada, pára (`VFD_UNDERVOLTAGE`). |
| PLC | Entradas a 24 V DC (4,8 kΩ, activas acima de 15 V), saídas a relé. O programa ladder corre em cada resolução do passo, como os relés. |
| Sensores PNP | Consumo de 10 mA; a saída é um contacto de 1 Ω para o positivo. |
| Cabos | A sobrecarga (`CABLE_OVERLOAD`) usa a corrente eficaz equivalente com constante de 60 s: um arranque de motor não a dispara. |

## Diagnóstico

Cada diagnóstico segue o contrato de `diagnostics/types.ts`, com as chaves `diag.<código>.title|cause|hint|learn`. Os valores (`values`) vêm já formatados no idioma do projecto. A lista completa de códigos está em `diagnostics/codes.ts`.

- **Ao montar:** `SOURCE_SHORT`, `LOAD_NO_RETURN`, `TERMINAL_UNCONNECTED`, `SWITCH_ON_NEUTRAL`, `PE_MISSING`, `CABLE_UNPROTECTED`, `WIRE_COLOR`, `LOAD_PHASE_PHASE` (carga de 230 V entre duas fases). A análise propaga a classe de cada condutor (fase, neutro, PE) a partir das fontes, através dos cabos e dos contactos.
- **Em simulação:** disparos, fusão, sobretensão, queda de tensão desde a origem (3 % na iluminação, 5 % nos outros usos), sobrecarga de cabos, ligação solta, corrente no corpo acima de 30 mA, bateria descarregada e comando instável (aponta o relé que oscila). Industriais: `MOTOR_PHASE_LOSS` (fase, terminal e cabo em falta), `MOTOR_NO_HOLD` (o motor pára ao largar o botão de marcha e o contacto 13-14 não está em paralelo), `COIL_VOLTAGE`, `MOTOR_OVERLOAD`, `OVERLOAD_PHASE_LOSS`, `MOTOR_STALLED`, `MOTOR_OVERHEATED` e `VFD_UNDERVOLTAGE`.
- **A pedido:** `whyNotWorking(sim, carga)` procura, da carga até à fonte, o caminho com menos elementos abertos. Depois aponta o primeiro elemento aberto. Se esse elemento tiver um diagnóstico próprio (disparo, fusível fundido), devolve-o. Se for um contactor, segue o circuito da bobina (até 3 níveis) e devolve a causa concreta; senão, `COIL_OFF`. Nos motores trifásicos verifica U1, V1 e W1.

## Testes

- `hand-calc.test.ts`: 63 casos que comparam o motor com o cálculo à mão (8 trifásicos, entre eles o motor de 4 kW = 7,72 A).
- `industrial.test.ts`: aceitação da Fase 4 (arranque directo, inversão, estrela-triângulo, falta de fase e de auto-retenção).
- `devices.test.ts`: casos normal, limite e falha para cada equipamento.
- `diagnostics.test.ts`: cada código no seu cenário. Inclui uma instalação correcta, que tem de dar zero diagnósticos.
- `performance.test.ts`: 300 nós em menos de 5 ms. Corre sozinho, depois dos outros (`scripts/vitest.mjs`), para não medir a carga das outras simulações.
- `project.test.ts`: ficheiros, migração do protótipo, nomes IEC 81346, biblioteca, formatação e worker.
- `packages/i18n/test`: paridade PT/EN/FR, cobertura das chaves, interpolação com i18next e regras de escrita das mensagens.
