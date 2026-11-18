# Faísca — prompt de construção

Nov 18, 2026 · @Vidrinne_Digital

## Como usar este prompt

Cole tudo a partir da secção «Papel e objectivo» numa ferramenta de programação com agente (por exemplo, Claude Code) dentro de uma pasta vazia. Peça uma fase de cada vez, pela ordem da secção «Fases de entrega», e teste cada fase antes de avançar.

- Se já tiver o protótipo Faísca, junte os ficheiros `js/core.js`, `js/examples.js`, `js/editor.js` e `js/view3d.js` e diga ao agente para os usar como referência do motor de simulação e da biblioteca.
- Ajuste os nomes, limites e regras ao regulamento que vai seguir (por exemplo, as regras técnicas de instalações eléctricas de Angola ou Portugal). O prompt usa valores indicativos da IEC 60364.
- Tudo o que está em blocos de código deve ser mantido tal como está: são contratos de dados que o agente deve respeitar.

## Papel e objectivo

És um engenheiro de software sénior com formação em engenharia electrotécnica. Vais construir o **Faísca**, uma aplicação de desktop para simular instalações eléctricas, inspirada no Cisco Packet Tracer: o utilizador monta circuitos com equipamentos reais, liga cabos, opera interruptores e protecções, mede grandezas e vê o resultado num esquema 2D e numa vista física 3D.

Público e uso:

- **Alunos** de cursos técnicos e de engenharia, e os seus formadores, em centros de formação, escolas e universidades.
- **Profissionais** (electricistas, técnicos de manutenção, engenheiros) que querem testar um esquema antes de o montar.
- Duas áreas: **electricidade doméstica** (habitação, comércio) e **electricidade industrial** (motores, comando, quadros de potência, automação).
- Três idiomas: português, inglês e francês.

Princípios que não se negociam:

1. **Simples para quem começa, completo para quem sabe.** O mesmo motor serve os dois perfis; a interface mostra mais ou menos.
2. **O cálculo tem de estar certo.** Cada resultado deve poder ser verificado à mão com as fórmulas da electrotecnia. Nenhum valor é inventado para a animação.
3. **Toda a falha é explicada.** Quando algo não funciona ou está perigoso, o utilizador recebe uma mensagem curta: o que aconteceu, onde, porquê e o que fazer.
4. **Funciona sem internet.** Todas as bibliotecas são incluídas na aplicação.
5. **O produto é didáctico, não é uma ferramenta de projecto regulamentar.** Isto aparece no ecrã «Sobre» e nos relatórios.

## Stack técnica e arquitectura

Usa TypeScript em todo o projecto, React para a interface, Three.js para o 3D e Tauri 2 para a aplicação de desktop (Windows, macOS, Linux). O núcleo de simulação é uma biblioteca pura, sem DOM, que corre num Web Worker.

| Camada | Tecnologia | Responsabilidade |
| --- | --- | --- |
| Desktop | Tauri 2 (Electron como alternativa) | Janela, menus nativos, abrir/guardar ficheiros, impressão, actualizações |
| Interface | React 18 + Vite + Zustand | Editor, painéis, assistente de arranque, tour, mensagens |
| Esquema 2D | SVG renderizado por React | Símbolos IEC 60617, cabos ortogonais, animação do fluxo de corrente |
| Vista 3D | Three.js r160+ (via React Three Fiber) | Bancada e quadro gerados a partir do esquema, estados animados |
| Simulação | TypeScript puro em Web Worker | Solver, protecções, lógica de comando, diagnóstico |
| Idiomas | i18next | PT, EN, FR, sem texto escrito directamente nos componentes |
| Testes | Vitest + Playwright | Cálculo contra valores à mão, fluxos de interface |

Estrutura de pastas:

```
faisca/
  src-tauri/                  # aplicação desktop
  packages/
    sim-core/                 # sem DOM: solver, dispositivos, protecções, diagnóstico
      solver/                 # MNA complexo, sobreposição AC/DC, curto-circuito
      devices/                # um ficheiro por família de equipamentos
      diagnostics/            # regras de falha → códigos de erro
      checks/                 # verificação de conformidade
    content/                  # exemplos, exercícios, passos do tour (JSON)
    i18n/                     # pt.json, en.json, fr.json
  apps/desktop/src/
    editor/  view3d/  panels/  onboarding/  tour/  messages/
```

Regras de arquitectura:

- Cada equipamento é **dados + comportamento** num só módulo: terminais, parâmetros, estado inicial, `stamp()` para o solver, `logic()` para protecções e comando, `info()` para medições, símbolo 2D, modelo 3D, e as chaves de tradução. Acrescentar um equipamento não pode exigir mexer no solver nem na interface.
- Cada equipamento declara `domain: ['domestic' | 'industrial']` e `level: 'beginner' | 'pro'`. A biblioteca filtra por isto.
- O formato do ficheiro de projecto `.faisca` é JSON versionado (`{ app, version, domain, level, lang, frequency, devices, wires }`) com migrações entre versões.

## Assistente de arranque

Ao abrir a aplicação pela primeira vez, e sempre que o utilizador escolhe «Novo projecto», mostra um assistente de três ecrãs em cartões grandes, com ícone, título e uma frase. O utilizador pode voltar atrás em qualquer ecrã.

&#91;embedded content: assistente de arranque · 3 escolhas, 4 saídas\]

1. **Idioma** (só na primeira abertura; depois fica nas Preferências): Português, English, Français. Pré-selecciona o idioma do sistema operativo.
2. **Área:**
   - **Electricidade doméstica** — habitações, escritórios e comércio: iluminação, tomadas, quadros de entrada, diferenciais, terra, solar.
   - **Electricidade industrial** — motores, comando por contactores, arranque estrela-triângulo, variadores, autómatos, quadros de potência, correcção do factor de potência.
3. **Nível:**
   - **Iniciante** — interface simplificada, explicações em cada equipamento, tour guiado no primeiro projecto, mensagens de erro com dica.
   - **Profissional** — todos os parâmetros, fasores, corrente de curto-circuito, curvas de disparo, relatórios e matriz de cálculo.

Depois do nível, oferece três saídas: **Projecto vazio**, **Abrir um exemplo** (filtrado pela área e nível) ou **Começar um exercício**. No nível Iniciante, «Projecto vazio» arranca o tour automaticamente.

O que a área e o nível mudam:

| Escolha | Biblioteca | Rede por omissão | Interface |
| --- | --- | --- | --- |
| Doméstica + Iniciante | Só equipamentos domésticos marcados `beginner` | Monofásica 230 V, TT | Explicações visíveis, parâmetros avançados escondidos, tour |
| Doméstica + Profissional | Todos os domésticos | Monofásica 230 V, TT | Todos os parâmetros, Icc, relatório de conformidade |
| Industrial + Iniciante | Industriais marcados `beginner` + básicos | Trifásica 400 V, TN-S | Explicações, esquemas de potência e comando separados |
| Industrial + Profissional | Todos | Trifásica 400 V, TN-S | Tudo, incluindo selectividade, harmónicos (simplificado) e matriz MNA |

A área e o nível ficam guardados no projecto e podem ser mudados depois no menu Projecto, sem perder trabalho. Mudar de área não apaga equipamentos: só filtra a biblioteca.

## Idiomas: português, inglês, francês

Todo o texto visível sai de ficheiros de tradução (`pt.json`, `en.json`, `fr.json`): menus, nomes e descrições de equipamentos, parâmetros, mensagens de erro e dicas, passos do tour, exercícios, exemplos e relatórios. O idioma muda em tempo real, sem reiniciar, a partir de Preferências ou do selector na barra de título.

- **Português** é a língua de referência. Usa a terminologia técnica de Angola e Portugal (disjuntor, interruptor diferencial, contactor, quadro eléctrico, condutor de protecção).
- **Inglês** e **francês** usam a terminologia IEC nessas línguas (circuit breaker / disjoncteur, RCD / interrupteur différentiel, contactor / contacteur).
- Os símbolos e as designações dos aparelhos (Q1, K1, H1, M1) e as cores dos condutores são iguais nos três idiomas.
- Números, unidades e datas seguem o idioma: `229,8 V` em PT e FR, `229.8 V` em EN.
- As chaves de tradução são estáveis e com nome descritivo (`error.mcb.magnetic_trip.title`). Um teste falha se uma chave existir num idioma e faltar noutro.
- Os nomes que o utilizador escreve (projecto, aparelhos, notas) não são traduzidos.

## Biblioteca de equipamentos

A biblioteca tem cerca de 90 equipamentos em 10 categorias. Cada um tem símbolo 2D, modelo 3D, parâmetros com valores comerciais reais (calibres, secções, potências normalizadas) e uma descrição didáctica de uma frase nos três idiomas.

| Categoria | Electricidade doméstica | Electricidade industrial (acrescenta) |
| --- | --- | --- |
| Fontes | Rede monofásica 230 V (TT, TN-S), gerador portátil, bateria, painel solar, inversor solar híbrido | Rede trifásica 400/230 V, posto de transformação MT/BT (15 kV/400 V), transformador trifásico Dyn11, gerador trifásico, UPS, comutador automático rede/gerador (ATS) |
| Protecção | Disjuntores 1P e 1P+N (B, C), fusíveis, interruptor diferencial 2P (30 / 300 mA, tipos AC, A), disjuntor diferencial, interruptor geral, descarregador de sobretensões (DPS) | Disjuntores 3P e 4P (B, C, D), disjuntor de caixa moldada com regulação Ir e Im, disjuntor-motor, seccionador-fusível, relé térmico, relé de falta e sequência de fases, relé de mínima tensão, diferencial 4P regulável |
| Comando | Interruptor simples e bipolar, comutador de escada, inversor, comutador de lustre, botão de campainha, telerruptor, temporizador de escada, detector de movimento, interruptor crepuscular | Botoneiras NA/NF, botão de emergência, selector 0-1-2, contactores 3P com auxiliares, contactor auxiliar, temporizadores (atraso à operação e à desoperação), relé de nível, autómato programável (PLC) com entradas e saídas |
| Sensores | Termostato, detector de fumo | Fim de curso, bóia de nível, pressostato, sensor indutivo, fotocélula, sonda PT100 |
| Cargas | Lâmpadas incandescente, LED e fluorescente, tomadas com aparelhos típicos, aquecedor, termoacumulador, fogão, campainha, ar condicionado, ventilador | Projectores LED industriais, resistências de aquecimento trifásicas, bateria de condensadores fixa e automática (regulador de FP), carga não linear (para harmónicos) |
| Motores e accionamentos | Motor monofásico, bomba de água | Motor trifásico de indução (ligação estrela ou triângulo na placa de bornes), arrancador estrela-triângulo, arrancador suave (soft starter), variador de frequência (VFD), motor de dois sentidos, travião electromagnético |
| Medição | Voltímetro, amperímetro, multímetro, pinça amperimétrica, contador de energia monofásico, testador de diferenciais, medidor de terra | Contador trifásico, analisador de rede (P, Q, S, FP, THD por fase), watímetro, megaohmímetro (isolamento), sequencímetro de fases, transformadores de corrente |
| Distribuição e materiais | Cabos H07V-U/R, VV, XV com secção, comprimento e material; ligadores, caixa de derivação, barramento, eléctrodo de terra, barra de terra, quadro de habitação | Barramentos de cobre, calha DIN, régua de bornes, caminho de cabos, cabos armados, quadro de potência e quadro de comando, ligação equipotencial |
| Falhas e ensaios | Curto-circuito, defeito à terra, pessoa em contacto, fio cortado, ligação solta (resistência de contacto) | Falta de fase, inversão de fases, sobretensão e subtensão da rede, rotor bloqueado, sobrecarga mecânica no motor |
| Anotações | Moldura de quadro, nota de texto, cota de comprimento | Moldura de quadro, nota, numeração de fios e de bornes |

Regras da biblioteca:

- Procura por nome, sinónimo e designação («disjuntor», «breaker», «Q») em qualquer dos três idiomas.
- Os nomes automáticos seguem a IEC 81346: G fontes, Q protecção e manobra, F fusíveis e relés de protecção, S comando manual, K contactores e relés, H sinalização e iluminação, M motores, X tomadas e bornes, P medição, E aquecimento.
- O PLC tem um editor de ladder simples (contactos NA/NF, bobinas, temporizadores TON/TOF, contadores) com 8 entradas e 8 saídas. A sua lógica corre no mesmo ciclo que os relés.
- O variador de frequência usa um modelo simplificado V/f: frequência e rampa configuráveis, corrente de entrada com harmónicos típicos de um rectificador de 6 impulsos.

## Motor de simulação

O motor resolve o circuito por Análise Nodal Modificada (MNA) com números complexos, em regime fasorial a 50 ou 60 Hz, e avança no tempo em passos de 10 a 50 ms para as protecções e o comando.

Cálculo eléctrico:

- Cada terminal é um nó; cada cabo é uma resistência R = ρ · L / S (cobre 0,0225 e alumínio 0,036 Ω·mm²/m a 70 °C) e, no perfil Profissional, uma reatância de 0,08 mΩ/m.
- Elementos básicos: impedância R+jX, fonte de tensão com fase, transformador ideal com perdas, fonte de corrente controlada (para variadores e inversores).
- Corrente contínua resolvida em separado e somada por sobreposição, para circuitos mistos (solar com inversor, carregadores).
- Uma condutância mínima de 10⁻⁹ S em cada nó evita matrizes singulares quando há partes abertas.
- Matriz esparsa com eliminação de Gauss com pivotagem parcial (ou LU esparsa). Meta: menos de 5 ms por passo com 300 nós.

Tempo, protecções e comando, em cada passo:

1. Resolver o circuito.
2. Correr a lógica de cada equipamento: protecções, bobinas, temporizadores, PLC, motores.
3. Se algum estado discreto mudou (um contacto abriu, uma bobina actuou), resolver outra vez sem avançar o tempo, até estabilizar (máximo 12 iterações; se não estabilizar, gerar o erro «comando instável»).
4. Calcular medições e correr o diagnóstico.

Modelos de comportamento:

| Equipamento | Modelo |
| --- | --- |
| Disjuntor | Térmico por integração de I²t a partir de 1,13 · In (dispara antes de 1,45 · In em 1 h); magnético instantâneo a 5 (B), 10 (C) ou 20 (D) × In; poder de corte Icn verificado |
| Fusível gG | Curva tempo-corrente tabelada por calibre; tem de ser substituído |
| Diferencial | Soma fasorial das correntes dos pólos; dispara acima de IΔn em 20 a 40 ms; botão de teste |
| Relé térmico | Classe 10 ou 20, contacto 95-96, rearme manual ou automático |
| Contactor | Actua acima de 0,75 · Uc e larga abaixo de 0,5 · Uc; contactos principais e auxiliares |
| Motor de indução | Impedância equivalente por fase dependente do escorregamento; arranque com 6 a 8 × In durante 0,3 a 2 s conforme a inércia; sentido pela sequência de fases; falta de fase impede o arranque e sobreaquece |
| Estrela-triângulo | Corrente de arranque reduzida a 1/3; comutação pelo temporizador |
| Variador | Rampa de frequência, V/f constante, corrente de entrada com harmónicos |
| Bateria | Tensão em função do estado de carga; carga e descarga em Ah |
| Pessoa | Resistência do corpo 1000 Ω + contacto com o chão; efeito pelas zonas da IEC 60479-1 |

Cálculos de engenharia disponíveis no perfil Profissional: corrente de curto-circuito presumida em qualquer ponto (fase-neutro, fase-terra, trifásico), queda de tensão acumulada desde a origem, balanço de potências por fase, selectividade entre protecções em série (sobreposição das curvas), e a matriz MNA completa para fins de ensino.

Testes obrigatórios do motor: pelo menos 40 casos que comparam o resultado com o cálculo à mão (por exemplo, lâmpada de 60 W a 230 V = 0,261 A; motor de 4 kW, FP 0,85, rendimento 0,88 a 400 V = 7,72 A).

## Detecção de falhas e mensagens de erro

O sistema detecta cada falha, assinala o sítio exacto no esquema e explica-a numa mensagem curta com três partes: **o que aconteceu**, **porquê** e **o que fazer**. Uma falha nunca é só um código ou um valor.

O diagnóstico corre em três momentos:

1. **Ao montar** (análise do esquema, sem simular): terminais livres que deviam estar ligados, carga sem caminho de retorno, fonte em curto, interruptor no neutro, massa sem terra, cor do condutor errada, cabo subdimensionado, tensão nominal incompatível (carga de 230 V entre duas fases), bobina com tensão diferente da do comando.
2. **Durante a simulação** (eventos): disparo de protecção, fusível fundido, sobrecarga, queda de tensão excessiva, motor que não arranca, falta de fase, contactor que não se mantém, corrente perigosa numa pessoa, bateria descarregada, comando instável.
3. **A pedido**: um botão «Porque não funciona?» em cada carga (lâmpada, motor, tomada). O sistema percorre o caminho da carga até à fonte, pela fase e pelo neutro, e aponta o primeiro elemento que corta o circuito ou a primeira ligação em falta.

Contrato de cada diagnóstico:

```json
{
  "code": "MCB_MAGNETIC_TRIP",
  "severity": "error",
  "targets": [{ "kind": "device", "id": "d12" }, { "kind": "wire", "id": "w31" }],
  "titleKey": "diag.mcb_magnetic_trip.title",
  "causeKey": "diag.mcb_magnetic_trip.cause",
  "hintKey": "diag.mcb_magnetic_trip.hint",
  "learnKey": "diag.mcb_magnetic_trip.learn",
  "values": { "device": "Q2", "current": "771 A", "ratio": "77" },
  "fix": { "action": "select", "id": "d40" }
}
```

`severity` é `error` (o circuito não funciona ou é perigoso), `warning` (funciona mas viola uma regra) ou `info`. `fix` é opcional e, quando existe, o botão «Mostrar» leva o utilizador ao equipamento a corrigir.

Como a mensagem aparece:

- Um cartão no canto do esquema, com ícone de gravidade, título de uma linha, causa numa frase e dica numa frase. O cartão fica até o utilizador o fechar ou a falha desaparecer.
- O equipamento e os cabos envolvidos ficam contornados a vermelho (erro) ou âmbar (aviso) e piscam duas vezes.
- Botões: **Mostrar** (centra e selecciona), **Como corrigir** (abre a dica completa) e, no nível Iniciante, **Saber mais** (explicação didáctica com uma figura).
- No perfil Profissional, a mensagem acrescenta os valores técnicos (corrente, razão I/In, tensão, tempo).
- Todas as mensagens ficam também no painel «Problemas», agrupadas por gravidade, como uma lista de erros de compilador.

Regras de escrita das mensagens: frases com menos de 15 palavras, sem jargão no nível Iniciante, sempre com o nome do aparelho («Q2», «H1»), nunca culpar o utilizador, e a dica começa por um verbo («Ligue», «Aumente», «Troque»).

Exemplos que têm de existir (lista mínima, alargar para cobrir todos os equipamentos):

| Código | O que aconteceu | Porquê | O que fazer |
| --- | --- | --- | --- |
| `LOAD_NO_RETURN` | A lâmpada H1 não acende | O terminal N de H1 não está ligado: a corrente não tem caminho de volta | Ligue o terminal N de H1 ao neutro (cabo azul) |
| `PATH_OPEN` | A lâmpada H1 não acende | O disjuntor Q2 está desligado e corta a fase | Ligue Q2 com a ferramenta Operar |
| `SWITCH_ON_NEUTRAL` | O interruptor S1 está no neutro | Com S1 desligado, a lâmpada continua sob tensão: perigo ao trocar a lâmpada | Ligue S1 no condutor de fase (castanho) |
| `MCB_MAGNETIC_TRIP` | O disjuntor Q2 disparou | Curto-circuito: passaram 771 A, 77 vezes a sua corrente nominal | Procure o curto entre fase e neutro e retire-o antes de rearmar |
| `MCB_THERMAL_TRIP` | O disjuntor Q3 disparou por sobrecarga | Os aparelhos ligados pedem 19 A e Q3 é de 16 A | Divida as cargas por dois circuitos ou reduza a potência |
| `RCD_TRIP` | O diferencial Q1 disparou | Há 46 mA a fugir para a terra na tomada X2 | Desligue o aparelho de X2 e verifique o isolamento |
| `CABLE_UNPROTECTED` | O cabo de Q4 para E1 não está protegido | Q4 é de 25 A e o cabo de 2,5 mm² só aguenta 24 A | Use cabo de 4 mm² ou um disjuntor de 20 A |
| `PE_MISSING` | A carcaça do aquecedor E1 não tem terra | Num defeito, a carcaça fica sob tensão | Ligue o terminal PE de E1 à barra de terra (verde-amarelo) |
| `MOTOR_PHASE_LOSS` | O motor M1 não arranca | Falta a fase L3 no terminal W | Verifique o cabo de F1-6 para M1-W |
| `MOTOR_NO_HOLD` | O motor M1 pára quando larga o botão S1 | Falta a auto-retenção: o contacto 13-14 de K1 não está em paralelo com S1 | Ligue K1-13 e K1-14 aos terminais de S1 |
| `COIL_VOLTAGE` | A bobina de K1 não actua | K1 tem bobina de 24 V e recebe 230 V (ou o contrário) | Troque a bobina ou alimente o comando pelo transformador |
| `WRONG_VOLTAGE` | A lâmpada H3 fundiu | Está ligada entre duas fases (400 V) e é de 230 V | Ligue H3 entre uma fase e o neutro |
| `VOLTAGE_DROP` | Queda de tensão de 6,2 % em H4 | O cabo de 1,5 mm² tem 60 m | Aumente a secção para 2,5 mm² ou aproxime o quadro |
| `BODY_CURRENT` | Corrente perigosa na pessoa: 65 mA | A carcaça de X1 tem defeito e não há diferencial de 30 mA | Instale um diferencial de 30 mA e ligue a terra |
| `CONTROL_UNSTABLE` | O circuito de comando oscila | Um contacto NF de K1 alimenta a própria bobina | Reveja o contacto 21-22 de K1 |

## Tour guiado para iniciantes

No nível Iniciante, o primeiro projecto vazio começa um tour que ensina a montar um circuito básico **fazendo**, não lendo. Cada passo destaca uma zona do ecrã, escurece o resto, explica numa ou duas frases e **espera que o utilizador faça a acção**. Só avança quando a acção está certa.

Tour da electricidade doméstica, «O meu primeiro ponto de luz»:

1. **Conheça o ecrã.** Destaca a biblioteca, o esquema, o painel de propriedades e a barra de simulação, um de cada vez.
2. **Coloque a fonte.** «Arraste a Rede monofásica para o esquema.» Valida: existe uma rede.
3. **Coloque a protecção.** «O disjuntor protege o cabo. Arraste um Disjuntor 1P+N para baixo da rede.» Valida: existe um disjuntor.
4. **Ligue a fase.** Anima o cursor do terminal L da rede até ao terminal L do disjuntor. Valida: esse cabo existe e é castanho.
5. **Ligue o neutro.** O mesmo para N. Valida: cabo azul entre os dois N.
6. **Coloque o interruptor e a lâmpada.** Valida: existem os dois.
7. **Faça o caminho da fase.** «A fase passa pelo interruptor antes da lâmpada.» Valida: disjuntor → interruptor → lâmpada L.
8. **Feche o circuito pelo neutro.** Valida: disjuntor N → lâmpada N.
9. **Ligue o interruptor.** Mostra a ferramenta Operar. Valida: a lâmpada acende. Celebra com o fluxo de corrente animado.
10. **Meça a tensão.** Mostra a sonda nos dois terminais da lâmpada. Valida: o multímetro mostra cerca de 230 V.
11. **Veja em 3D.** Abre a vista física com a lâmpada acesa.
12. **Provoque uma falha.** «Coloque um Curto-circuito entre fase e neutro e active-o.» O disjuntor dispara e aparece a primeira mensagem de erro com dica. Valida: o utilizador clica «Como corrigir» e rearma o disjuntor.

Se o utilizador errar, o tour não avança e usa o mesmo motor de diagnóstico para explicar (por exemplo, «Ligou o interruptor ao neutro. A fase é o cabo castanho.»), com um botão «Mostrar-me» que faz o passo pelo utilizador.

O tour industrial, «O meu primeiro arranque de motor», segue o mesmo modelo em 10 passos: rede trifásica, disjuntor-motor, contactor, motor, circuito de comando com botões de marcha e paragem, auto-retenção, relé térmico e um ensaio de falta de fase.

Regras do tour:

- Os passos são dados em JSON (`{ id, targetSelector, textKey, waitFor: { type, params }, showMeAction }`) para que formadores possam criar tours novos sem programar.
- O utilizador pode sair a qualquer momento e retomar no mesmo passo. O tour volta a abrir pelo menu Ajuda.
- Uma barra de progresso mostra «Passo 4 de 12».
- No fim, o tour propõe o primeiro exercício do mesmo tema.

## Interface estilo Packet Tracer

O ecrã principal tem cinco zonas fixas, como no Packet Tracer: barra de menus, barra de ferramentas, área de trabalho ao centro, painel de propriedades à direita e doca inferior com a biblioteca e os painéis de simulação.

| Zona | Conteúdo |
| --- | --- |
| Barra de menus | Ficheiro, Editar, Ver, Simulação, Exercícios, Ferramentas, Ajuda; selector de idioma; indicador da área e do nível do projecto |
| Barra de ferramentas | Seleccionar (V), Operar (H), Ligar cabo (W), Sonda/multímetro (M), Pinça, Apagar; desfazer/refazer; rodar; condutor e secção do próximo cabo; zoom; separadores «Esquema lógico» e «Físico 3D»; Tempo real / Passo a passo, iniciar, avançar, velocidade (×0,1 a ×50), relógio da simulação |
| Área de trabalho 2D | Grelha de 20 px, símbolos IEC com terminais coloridos, cabos ortogonais desenhados automaticamente (com pontos de curva arrastáveis), fluxo de corrente animado, contorno das falhas |
| Vista física 3D | Quadro eléctrico e bancada gerados a partir do esquema; aparelhos modulares em calha DIN, lâmpadas que acendem, motores que rodam, alavancas que caem no disparo; clicar num aparelho opera-o; alternância entre «bancada didáctica» e «instalação real» (planta de uma casa ou nave industrial com o quadro na parede) |
| Painel de propriedades | Nome, comandos (ligar, premir, rearmar, testar), parâmetros, medições em tempo real, ligações, botão «Porque não funciona?»; projecto quando nada está seleccionado |
| Doca inferior | Categorias e azulejos da biblioteca com pesquisa; separadores Eventos, Problemas, Verificação, Exercício e Matriz MNA (só Profissional) |

Comportamentos que têm de existir:

- Colocar equipamentos arrastando da biblioteca ou clicando e depois clicando no esquema.
- Ligar cabos arrastando de terminal a terminal ou com dois cliques. A cor sai do tipo de terminal; o comprimento é estimado pelo desenho (40 px = 1 m) e editável.
- Multi-selecção com rectângulo, copiar/colar com os cabos internos, alinhar, agrupar num quadro.
- Desfazer e refazer sem limite prático; guardar automático a cada 30 s num ficheiro de recuperação.
- Multímetro flutuante com ponta vermelha e preta; pinça amperimétrica sobre um cabo.
- Modo Passo a passo como o «Simulation mode» do Packet Tracer: o tempo pára, «⏭» avança 0,1 s, a lista de eventos mostra cada mudança e clicar num evento selecciona o aparelho.
- Atalhos de teclado visíveis nos menus; tema escuro para a interface e claro para a área de trabalho; acessível por teclado; contraste WCAG AA.
- Ecrãs a partir de 1366 × 768.

## Exercícios, ficheiros e verificação

**Exercícios.** Como as actividades do Packet Tracer: um enunciado, um projecto inicial (equipamentos colocados, cabos em falta), objectivos verificados automaticamente pelo simulador, barra de progresso, solução opcional e pontuação. Cada objectivo é uma regra declarativa sobre o estado («H1 acesa com S1 ligado», «M1 em marcha com S1 libertado», «Q1 dispara com o defeito activo»), não código escrito à mão. Inclui um editor de exercícios para formadores, que exporta um ficheiro `.faisca-ex` protegido contra alteração.

Exercícios mínimos:

| Área | Iniciante | Profissional |
| --- | --- | --- |
| Doméstica | Ponto de luz simples; comando de escada; tomadas com terra; campainha com transformador | Quadro de habitação com 6 circuitos e diferencial; protecção de pessoas em TT; dimensionamento de cabos e quedas de tensão; sistema solar com bateria |
| Industrial | Arranque directo com auto-retenção; sinalização de marcha e disparo; inversão de marcha com encravamento | Arranque estrela-triângulo; correcção do factor de potência; selectividade entre disjuntores; bomba com bóia de nível por PLC; motor com variador |

**Exemplos.** Pelo menos dois por célula da tabela acima, completos e a funcionar, abertos pelo assistente de arranque.

**Ficheiros.** Abrir e guardar `.faisca` com diálogos nativos; projectos recentes; exportar o esquema para PDF e PNG (com legenda e lista de material); exportar a lista de material (aparelhos, calibres, metros de cabo por secção e cor) para CSV/Excel; imprimir.

**Verificação de conformidade** (perfil Profissional, e simplificada no Iniciante). Regras indicativas da IEC 60364, configuráveis por país num ficheiro de regras:

- Ib ≤ In ≤ Iz em cada circuito, com correntes admissíveis por secção, material e modo de instalação.
- Queda de tensão máxima: 3 % na iluminação e 5 % nos outros usos.
- Diferencial ≤ 30 mA nos circuitos de tomadas e casas de banho; Ra × IΔn ≤ 50 V no esquema TT.
- Todas as massas de classe I ligadas ao PE; código de cores; interruptores na fase.
- Poder de corte de cada protecção maior que a corrente de curto-circuito presumida.
- Gera um relatório em PDF com cada regra, o resultado e a referência, e o aviso de que é uma ferramenta didáctica.

## Fases de entrega e critérios de aceitação

Entrega em seis fases. Em cada uma, mostra o que mudou, corre os testes e espera aprovação antes da seguinte. Não avances com testes a falhar.

1. **Núcleo de simulação.** Solver, 20 equipamentos domésticos, protecções, diagnóstico básico. *Aceite quando:* os 40 casos de cálculo à mão passam e 300 nós resolvem em menos de 5 ms.
2. **Editor 2D e aplicação desktop.** Tauri, editor, biblioteca, propriedades, simulação em tempo real e passo a passo, abrir/guardar. *Aceite quando:* um ponto de luz se monta só com o rato em menos de 2 minutos e o ficheiro reabre igual.
3. **Assistente, idiomas, mensagens e tour.** Assistente de arranque, PT/EN/FR completos, cartões de erro com dica, «Porque não funciona?», tour doméstico. *Aceite quando:* os 15 códigos de erro da tabela aparecem nos cenários descritos nos três idiomas, e um utilizador novo completa o tour sem ajuda.
4. **Industrial.** Rede trifásica, motores, contactores, relés, estrela-triângulo, variador, PLC com ladder, sensores, tour industrial. *Aceite quando:* o arranque directo, a inversão de marcha e o estrela-triângulo funcionam e as falhas de fase e de auto-retenção são explicadas.
5. **Vista 3D.** Bancada e instalação real, estados animados, operação por clique. *Aceite quando:* todos os equipamentos têm modelo e a vista mantém 60 fps com 100 aparelhos num portátil comum.
6. **Exercícios, relatórios e acabamento.** Exercícios e editor de exercícios, exemplos, verificação de conformidade, exportações, instaladores para Windows, macOS e Linux. *Aceite quando:* todos os exercícios da tabela podem ser completados e o instalador funciona sem internet.

Regras de qualidade em todas as fases:

- Testes unitários para cada equipamento (comportamento normal, limite e falha) e testes de interface com Playwright para os fluxos principais.
- Nenhum texto visível fora dos ficheiros de tradução; um teste verifica que PT, EN e FR têm as mesmas chaves.
- Quando um modelo físico for simplificado, regista a simplificação no ecrã «Sobre» e na documentação do equipamento.
- Se uma decisão não estiver neste prompt, escolhe a opção mais simples que respeite os cinco princípios e explica-a no resumo da fase.
