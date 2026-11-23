<?php
/**
 * Modelo da configuração do painel de opiniões (api/admin.php).
 *
 * Copie para faisca-data/config.php, FORA do public_html (no Hostinger, ao lado da pasta
 * public_html do domínio), e troque o hash pelo da sua palavra-passe. Para o gerar:
 *
 *   php -r "echo password_hash('a sua palavra-passe', PASSWORD_DEFAULT), PHP_EOL;"
 *
 * Este modelo não é lido pelo site; só o config.php da pasta de dados conta.
 */
return [
    'admin_password_hash' => '$2y$10$substitua.este.texto.pelo.hash.da.sua.palavra.passe......',
    // Fuso horário das datas no painel.
    'timezone' => 'Africa/Luanda',
];
