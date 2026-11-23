# Site público do Faísca Tracer

Página de apresentação de `faiscatracer.com`: o que é o Faísca Tracer, para quem é e as duas formas de o usar (desktop e web).

HTML, CSS e JavaScript estáticos, sem build e sem dependências externas, mais uma pequena API em PHP para as opiniões dos visitantes (`api/`). Para publicar, copie o conteúdo desta pasta para a raiz de um alojamento com PHP 7.4 ou mais recente e a extensão `pdo_sqlite` (por exemplo, `public_html` no Hostinger), mantendo as subpastas.

## Antes de publicar

Depois de alterar `styles.css`, `site.js` ou `lang.js`, corra na raiz do repositório:

```
npm run site:version
```

O script põe o hash do conteúdo no endereço de cada ficheiro, nas três páginas (`styles.css?v=6f73f8e735`). O Hostinger guarda o CSS e o JS durante 7 dias, no navegador e na CDN, e a CDN pode continuar a servir uma cópia antiga depois de o ficheiro mudar. Com o hash, cada versão tem um endereço novo. `npm run site:version -- --check` só verifica e falha se algum hash estiver desactualizado.

## Idiomas

| Página | Idioma |
| --- | --- |
| `index.html` | Português (raiz) |
| `en/index.html` | Inglês |
| `fr/index.html` | Francês |

As três páginas têm o mesmo conteúdo: uma alteração de texto faz-se nas três. Os ids das secções (`top`, `about`, `audience`, `download`, `feedback`) são iguais nas três, para as âncoras funcionarem em qualquer idioma.

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

## Contador de downloads

`site.js` soma os downloads dos instaladores (`.exe`, `.msi`, `.dmg`, `.AppImage`, `.deb`, `.rpm`) de todas as versões publicadas no GitHub Releases e mostra o total na abertura e no cartão do desktop. Os ficheiros de actualização automática (`.sig`, `latest.json`) não contam.

- Lê a API pública do GitHub no navegador de cada visitante e actualiza o número a cada minuto, enquanto a aba está visível. O próprio GitHub actualiza a contagem com alguns minutos de atraso.
- Os rascunhos de release não contam; só as releases publicadas.
- Se a API não responder (sem rede ou limite de 60 pedidos por hora atingido), o contador fica escondido ou mantém o último número, e volta a tentar 5 minutos depois.

## Opiniões dos visitantes

O formulário da secção «A sua opinião» envia para `api/feedback.php`, que guarda cada mensagem numa base SQLite.

| Ficheiro | Função |
| --- | --- |
| `api/feedback.php` | Recebe e valida a mensagem (tipo, 10 a 3000 caracteres, nome e e-mail opcionais) |
| `api/admin.php` | Painel privado: lista, filtra, marca como lida e apaga |
| `api/lib.php` | Funções comuns (não abre directamente) |
| `api/config.sample.php` | Modelo da configuração do painel |

Os dados ficam fora da pasta pública, em `faisca-data/` ao lado do `public_html` (no Hostinger: `domains/faiscatracer.com/faisca-data/`). A pasta é criada no primeiro envio, com:

- `feedback.sqlite`: as mensagens;
- `salt.txt`: sal aleatório para o hash do endereço IP;
- `config.php`: palavra-passe do painel (criada à mão, ver abaixo).

Protecção contra abusos: campo escondido para robôs, envios em menos de 2,5 s ignorados e no máximo 5 mensagens por hora e por endereço IP. O endereço IP não é guardado, só um hash com sal privado. As mensagens não são publicadas no site.

### Abrir o painel

1. Gere o hash da palavra-passe num computador com PHP:

   ```
   php -r "echo password_hash('a sua palavra-passe', PASSWORD_DEFAULT), PHP_EOL;"
   ```

2. No Gestor de Ficheiros do Hostinger, crie `domains/faiscatracer.com/faisca-data/config.php`, com o conteúdo de `api/config.sample.php` e o hash no lugar do texto de exemplo.
3. Abra `https://faiscatracer.com/api/admin.php` e entre com a palavra-passe.

Sem `config.php`, o painel fica fechado e o formulário continua a guardar as mensagens.

## Visitantes

Cada página aberta envia uma visita para `api/visit.php` (por `navigator.sendBeacon`, em `site.js`). O separador «Visitantes» do painel mostra visitas, visitantes, países e cidades por período (hoje, 7 dias, 30 dias, 12 meses, tudo), com um gráfico e filtros encadeados: país, depois região, depois cidade.

| Ficheiro | Função |
| --- | --- |
| `api/visit.php` | Regista a visita: dia, idioma da página, país, região e cidade aproximados |
| `api/mmdb.php` | Leitor da base de localização por IP (formato MaxMind DB, PHP puro) |

O que se guarda e o que não se guarda:

- **Não se guarda o endereço IP.** Serve só para consultar a localização no momento da visita.
- O visitante é identificado por `hash(sal privado + dia + IP + navegador)`. O hash muda todos os dias, por isso um visitante conta uma vez por dia e não pode ser seguido de um dia para o outro. Os «visitantes» de um período são a soma dos visitantes únicos de cada dia.
- Não contam: robôs conhecidos, a mesma página recarregada em 30 minutos, mais de 200 visitas do mesmo visitante num dia, e navegadores com Global Privacy Control.
- A página inicial que redirecciona para `/en/` ou `/fr/` conta só uma visita, a da página final.
- Sem cookies nem armazenamento no navegador. O rodapé das três páginas avisa: «Estatísticas de visitas anónimas, sem cookies.»

### Base de localização

A localização vem da base gratuita **DB-IP City Lite** (licença CC BY 4.0, com a atribuição no painel), guardada em `faisca-data/dbip-city.mmdb` (cerca de 120 MB). Sem ela, as visitas contam na mesma, com país «Desconhecido».

- No painel, separador «Visitantes», o botão **Actualizar base de localização** descarrega a base do mês (cerca de 60 MB), descomprime-a, confirma que funciona e só depois substitui a anterior. A DB-IP publica uma base nova no início de cada mês.
- Se o botão esgotar o tempo do alojamento, descarregue `dbip-city-lite-AAAA-MM.mmdb.gz` em https://db-ip.com/db/download/ip-to-city-lite, descomprima-o e envie-o pelo Gestor de Ficheiros como `faisca-data/dbip-city.mmdb`.

### IP do visitante atrás da CDN

A CDN do Hostinger fica entre o visitante e o servidor. `lib.php` (`client_ip()`) usa, por esta ordem: `X-Real-IP`, `True-Client-IP`, `CF-Connecting-IP`, o último IP público de `X-Forwarded-For` e `REMOTE_ADDR`. O fim do separador «Visitantes» mostra o IP detectado no seu próprio acesso e estes cabeçalhos. Se o IP detectado não for o seu (por exemplo, sair sempre África do Sul, onde está a CDN), a localização das visitas está errada e é preciso ajustar `client_ip()`. O mesmo IP serve o limite de mensagens do formulário de opiniões.

## Imagens

`img/pt`, `img/en` e `img/fr` têm capturas da aplicação real, com a interface em cada idioma (exemplos «Arranque directo» e «Quadro de habitação»), a 1440 × 900.
