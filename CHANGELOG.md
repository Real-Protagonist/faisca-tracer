# Alterações

## Por publicar

- Esquema: cabos que seguiam pelo mesmo caminho passam a faixas paralelas lado a lado (como num caminho de cabos), em vez de parecerem um só cabo. A ordem das faixas é a que provoca menos cruzamentos; as saídas dos terminais ficam no sítio. Vale também para a exportação PNG/PDF e para a vista 3D. Só muda o desenho: o comprimento dos cabos para o cálculo não muda.
- Biblioteca e painéis de baixo com altura ajustável: arraste a barra do topo, use as setas, Home e End, ou duplo clique para repor. A altura fica guardada.
- Versão web: `?lang=pt|en|fr` no endereço escolhe o idioma na primeira abertura.
- Vista 3D mais real: cada aparelho tem os números dos bornes impressos junto aos parafusos e o calibre na frente («C16 · 6 kA», «30 mA · 40 A», «230 V · 12 A»); os cabos chegam aos bornes com ponteira metálica.
- Vista 3D: duplo clique num aparelho aproxima a câmara para ver os detalhes (sem o operar); «Ver tudo» volta à cena inteira.
- Vista 3D, modo «Ligações» (bancada): clicar num borne mostra os cabos ligados, para desligar um ou começar um cabo novo; a ponta desligada fica pendurada, com o cobre à vista; clicar nela e num borne volta a ligá-la (ao mesmo borne ou a outro). Tudo se desfaz com Ctrl+Z.
- Cabos com pontas desligadas: não conduzem, aparecem no esquema 2D afastados do terminal, com um círculo, e o painel do cabo tem «Ligar»/«Desligar» para cada ponta. Novo diagnóstico «cabo desligado do borne» em «Porque não funciona?».

## 1.1.0

- Novo nome: **Faísca Tracer** (sem acento nos ficheiros, no domínio e nas lojas: «Faisca Tracer», `faisca-tracer`, `faiscatracer.com`, identificador `com.faiscatracer.desktop`).
- Projectos em `.fast` e exercícios em `.fast-ex`; os ficheiros antigos `.faisca` e `.faisca-ex` continuam a abrir.
- Ecrã de arranque com o logótipo, o nome e a barra de progresso; no desktop, também a versão.
- Relógio da simulação em formato de hora (`00:02:35`; com décimas no modo passo a passo).
- Menu Ajuda → Doações: transferência internacional (IBAN e SWIFT/BIC), conta bancária angolana e Bitcoin.
- «Sobre»: © 2023 Mesaque M. Txangala.

Como o identificador mudou, o Faísca Tracer instala-se ao lado de uma versão anterior «Faísca», sem a substituir, e começa com as preferências de origem.

## 1.0.0

- Seis fases do prompt de construção: núcleo de simulação, editor 2D e desktop, assistente e tour, área industrial, vista física 3D, exercícios, verificação de conformidade, exportações e instaladores.
