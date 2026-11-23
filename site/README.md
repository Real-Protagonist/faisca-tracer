# Site público do Faísca Tracer

Página de apresentação de `faiscatracer.com`: o que é o Faísca Tracer, para quem é e as duas formas de o usar (desktop e web).

HTML e CSS estáticos, sem build e sem dependências externas. Para publicar, copie o conteúdo desta pasta para a raiz do alojamento (por exemplo, `public_html` no Hostinger), mantendo as subpastas.

## Idiomas

| Página | Idioma |
| --- | --- |
| `index.html` | Português (raiz) |
| `en/index.html` | Inglês |
| `fr/index.html` | Francês |

As três páginas têm o mesmo conteúdo: uma alteração de texto faz-se nas três. Os ids das secções (`top`, `about`, `audience`, `download`) são iguais nas três, para as âncoras funcionarem em qualquer idioma.

`lang.js` escolhe o idioma na página inicial em português, para quem ainda não escolheu nenhum:

1. Escolha feita no selector PT · EN · FR (fica guardada no navegador).
2. País deduzido do fuso horário do computador (por exemplo, `Africa/Luanda` → português, `Africa/Kinshasa` → francês).
3. País da região do navegador (`pt-AO`, `fr-CM`, ...).
4. Idioma do navegador, se for português, inglês ou francês.
5. Inglês.

Os países com várias línguas (Bélgica, Suíça, Canadá, Ruanda) ficam de fora do passo 2: decide o navegador. Tudo corre no navegador, sem serviços externos. As páginas `/en/` e `/fr/` nunca redireccionam: uma ligação partilhada abre sempre no idioma da ligação.

## Ligações a manter

Estão nas três páginas:

| Ligação | Endereço actual | Quando mudar |
| --- | --- | --- |
| Descarregar para Windows | `https://github.com/Real-Protagonist/faisca-tracer/releases/download/v1.1.0/Faisca.Tracer_1.1.0_x64-setup.exe` | Em cada versão nova (número da versão e tamanho do instalador) |
| Abrir na web (3 sítios por página) | `https://app.faiscatracer.com/?lang=pt` (`en`, `fr`) | Se a aplicação web for publicada noutro endereço |

O instalador só fica disponível depois de publicar a release `v1.1.0` no GitHub com esse ficheiro. O GitHub troca os espaços do nome por pontos.

O parâmetro `?lang=` abre a aplicação web no idioma da página, na primeira visita. Depois vale o idioma escolhido dentro da aplicação.

## Imagens

`img/pt`, `img/en` e `img/fr` têm capturas da aplicação real, com a interface em cada idioma (exemplos «Arranque directo» e «Quadro de habitação»), a 1440 × 900.
