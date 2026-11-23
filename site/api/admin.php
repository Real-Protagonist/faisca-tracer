<?php
/**
 * Painel privado do site, com dois separadores:
 *   - Opiniões: lista, filtra, marca como lida e apaga as mensagens dos visitantes;
 *   - Visitantes: visitas e visitantes por período, com filtros por país, região e cidade.
 *
 * Entra-se com a palavra-passe cujo hash está em faisca-data/config.php (ver config.sample.php).
 * Sem esse ficheiro, o painel fica fechado e explica como o criar.
 */
require __DIR__ . '/lib.php';

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header('Cache-Control: no-store');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");

$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
session_name('faisca_admin');
session_set_cookie_params(['lifetime' => 0, 'path' => dirname($_SERVER['SCRIPT_NAME']) . '/', 'secure' => $https, 'httponly' => true, 'samesite' => 'Strict']);
session_start();

$hash = (string) (config()['admin_password_hash'] ?? '');
date_default_timezone_set(local_timezone());

const KIND_LABEL = ['opinion' => 'Opinião', 'criticism' => 'Crítica', 'improvement' => 'Melhoria'];
const PERIODS = ['1' => 'Hoje', '7' => '7 dias', '30' => '30 dias', '365' => '12 meses', 'all' => 'Tudo'];
const LANG_LABEL = ['pt' => 'Português', 'en' => 'Inglês', 'fr' => 'Francês'];
/** Valor dos filtros para «localização desconhecida». */
const UNKNOWN = '-';

function page(string $title, string $body): void
{
    echo '<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
        . '<meta name="robots" content="noindex, nofollow"><title>' . h($title) . '</title><style>'
        . 'body{margin:0;font:15px/1.5 system-ui,"Segoe UI",Roboto,Arial,sans-serif;background:#f3f5f9;color:#1b2130}'
        . '.wrap{max-width:1080px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 16px}h2{font-size:17px;margin:0 0 12px}'
        . '.top{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-bottom:20px}.top h1{margin:0}.top .right{margin-left:auto}'
        . '.views{display:flex;gap:4px;padding:4px;border-radius:10px;background:#e3e7ef}.views a{padding:6px 14px;border-radius:7px;text-decoration:none;color:#4b5468;font-weight:600}'
        . '.views a.on{background:#fff;color:#1b2130;box-shadow:0 1px 2px rgba(0,0,0,.08)}'
        . '.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:16px}.bar a{padding:6px 12px;border-radius:8px;background:#fff;border:1px solid #dfe3ec;text-decoration:none;color:inherit}'
        . '.bar a.on{background:#1f2430;color:#fff;border-color:#1f2430}'
        . '.card{background:#fff;border:1px solid #dfe3ec;border-radius:12px;padding:16px;margin-bottom:12px}.card.new{border-left:4px solid #ffb020}'
        . '.meta{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13px;color:#4b5468;margin-bottom:8px}.tag{font-weight:700;color:#1b2130}'
        . '.msg{white-space:pre-wrap;overflow-wrap:anywhere}.acts{display:flex;gap:8px;margin-top:12px}'
        . 'button,select{font:inherit;padding:6px 12px;border-radius:8px;border:1px solid #dfe3ec;background:#fff;color:inherit}button{cursor:pointer}button.del{color:#b42318}'
        . 'button.main{background:#1f2430;color:#fff;border-color:#1f2430}'
        . 'input[type=password]{font:inherit;padding:8px 10px;border-radius:8px;border:1px solid #dfe3ec;width:100%;max-width:320px}'
        . '.login{max-width:360px;margin:12vh auto}.err{color:#b42318}.okmsg{color:#1a7f45}code{background:#eef1f7;padding:1px 5px;border-radius:4px}'
        . '.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:12px}.kpi{background:#fff;border:1px solid #dfe3ec;border-radius:12px;padding:14px 16px}'
        . '.kpi b{display:block;font-size:28px;line-height:1.2;font-variant-numeric:tabular-nums}.kpi span{font-size:13px;color:#4b5468}'
        . '.chart{display:flex;align-items:flex-end;gap:2px;height:160px;padding-top:8px}.chart div{flex:1;min-width:2px;background:#ffb020;border-radius:3px 3px 0 0;position:relative}'
        . '.chart div:hover{background:#e09400}.axis{display:flex;justify-content:space-between;font-size:12px;color:#4b5468;margin-top:6px}'
        . '.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}'
        . 'table{width:100%;border-collapse:collapse;font-size:14px}td,th{padding:6px 4px;text-align:left;border-bottom:1px solid #eef1f7;vertical-align:middle}'
        . 'th{font-size:12px;color:#4b5468;font-weight:600}td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;width:1%}'
        . 'td a{color:inherit;text-decoration:none}td a:hover{text-decoration:underline}.pct{height:4px;background:#ffb020;border-radius:2px;margin-top:3px}'
        . '.filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.filters select{max-width:220px}.muted{color:#4b5468;font-size:13px}'
        . '.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.chips a{font-size:13px;padding:3px 10px;border-radius:999px;background:#1f2430;color:#fff;text-decoration:none}'
        . '</style></head><body><div class="wrap">' . $body . '</div></body></html>';
    exit;
}

function n($v): string
{
    return number_format((float) $v, 0, ',', ' ');
}

if ($hash === '') {
    page('Painel fechado', '<h1>Painel fechado</h1><p>Falta a palavra-passe. Crie o ficheiro <code>config.php</code> na pasta de dados '
        . '(<code>faisca-data</code>, fora do <code>public_html</code>) a partir de <code>api/config.sample.php</code>.</p>');
}

if (empty($_SESSION['csrf'])) {
    $_SESSION['csrf'] = bin2hex(random_bytes(16));
}
$csrf = $_SESSION['csrf'];
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = (string) ($_POST['action'] ?? '');
$view = ($_GET['v'] ?? '') === 'visitas' ? 'visitas' : 'opinioes';

// Entrar.
if ($method === 'POST' && $action === 'login') {
    if (password_verify((string) ($_POST['password'] ?? ''), $hash)) {
        session_regenerate_id(true);
        $_SESSION['admin'] = true;
        header('Location: admin.php', true, 303);
        exit;
    }
    sleep(1);
    $loginError = true;
}

if (empty($_SESSION['admin'])) {
    page('Painel: entrar', '<form class="login card" method="post"><h1>Painel do Faísca Tracer</h1>'
        . (!empty($loginError) ? '<p class="err">Palavra-passe errada.</p>' : '')
        . '<p><input type="password" name="password" placeholder="Palavra-passe" autocomplete="current-password" required autofocus></p>'
        . '<input type="hidden" name="action" value="login"><button>Entrar</button></form>');
}

// Acções (sempre por POST, com o código anti-CSRF da sessão).
if ($method === 'POST') {
    if (!hash_equals($csrf, (string) ($_POST['csrf'] ?? ''))) {
        http_response_code(400);
        page('Pedido inválido', '<p class="err">Pedido inválido. Volte ao <a href="admin.php">painel</a>.</p>');
    }
    $id = (int) ($_POST['id'] ?? 0);
    if ($action === 'logout') {
        $_SESSION = [];
        session_destroy();
        header('Location: admin.php', true, 303);
        exit;
    }
    if ($action === 'read') {
        db()->prepare('UPDATE feedback SET is_read = 1 - is_read WHERE id = ?')->execute([$id]);
    } elseif ($action === 'delete') {
        db()->prepare('DELETE FROM feedback WHERE id = ?')->execute([$id]);
    } elseif ($action === 'geo_update') {
        $_SESSION['flash'] = geo_update();
    }
    header('Location: admin.php?' . $_SERVER['QUERY_STRING'], true, 303);
    exit;
}

$flash = (string) ($_SESSION['flash'] ?? '');
unset($_SESSION['flash']);

/** Formulário de uma acção, com o código anti-CSRF. */
$form = function (string $action, int $id, string $label, string $cls = '') use ($csrf): string {
    return '<form method="post" action="admin.php?' . h($_SERVER['QUERY_STRING'] ?? '') . '"><input type="hidden" name="csrf" value="' . h($csrf) . '">'
        . '<input type="hidden" name="action" value="' . h($action) . '"><input type="hidden" name="id" value="' . $id . '">'
        . '<button' . ($cls ? ' class="' . $cls . '"' : '') . ($action === 'delete' ? ' title="Apagar definitivamente"' : '') . '>' . h($label) . '</button></form>';
};

$html = '<div class="top"><h1>Painel</h1><nav class="views">'
    . '<a href="admin.php"' . ($view === 'opinioes' ? ' class="on"' : '') . '>Opiniões</a>'
    . '<a href="admin.php?v=visitas"' . ($view === 'visitas' ? ' class="on"' : '') . '>Visitantes</a></nav>'
    . '<span class="right">' . $form('logout', 0, 'Sair') . '</span></div>';
if ($flash !== '') {
    $html .= '<p class="card ' . (strpos($flash, 'actualizada') !== false ? 'okmsg' : 'err') . '">' . h($flash) . '</p>';
}

if ($view === 'opinioes') {
    // ---------------- Opiniões ----------------
    $filter = (string) ($_GET['f'] ?? '');
    $where = '';
    $args = [];
    if (isset(KIND_LABEL[$filter])) {
        $where = 'WHERE kind = ?';
        $args[] = $filter;
    } elseif ($filter === 'new') {
        $where = 'WHERE is_read = 0';
    }
    $q = db()->prepare("SELECT * FROM feedback $where ORDER BY id DESC LIMIT 500");
    $q->execute($args);
    $rows = $q->fetchAll();
    $total = 0;
    $unread = 0;
    $byKind = [];
    foreach (db()->query('SELECT kind, COUNT(*) n, SUM(is_read = 0) unread FROM feedback GROUP BY kind')->fetchAll() as $c) {
        $byKind[$c['kind']] = (int) $c['n'];
        $total += (int) $c['n'];
        $unread += (int) $c['unread'];
    }
    $tab = function (string $f, string $label, int $count) use ($filter): string {
        return '<a href="?f=' . h($f) . '"' . ($filter === $f ? ' class="on"' : '') . '>' . h($label) . ' (' . $count . ')</a>';
    };
    $html .= '<div class="bar">' . $tab('', 'Todas', $total) . $tab('new', 'Por ler', $unread);
    foreach (KIND_LABEL as $k => $label) {
        $html .= $tab($k, $label, $byKind[$k] ?? 0);
    }
    $html .= '</div>';
    if (!$rows) {
        $html .= '<p>Ainda não há mensagens aqui.</p>';
    }
    foreach ($rows as $r) {
        $when = date('d/m/Y H:i', strtotime($r['created_at']));
        $who = $r['name'] !== '' ? h($r['name']) : 'Anónimo';
        $mail = $r['email'] !== '' ? ' · <a href="mailto:' . h($r['email']) . '">' . h($r['email']) . '</a>' : '';
        $html .= '<article class="card' . ($r['is_read'] ? '' : ' new') . '"><div class="meta"><span class="tag">' . h(KIND_LABEL[$r['kind']] ?? $r['kind']) . '</span>'
            . '<span>' . $when . '</span><span>' . strtoupper(h($r['lang'])) . '</span><span>' . $who . $mail . '</span></div>'
            . '<div class="msg">' . h($r['message']) . '</div><div class="acts">'
            . $form('read', (int) $r['id'], $r['is_read'] ? 'Marcar como por ler' : 'Marcar como lida')
            . $form('delete', (int) $r['id'], 'Apagar', 'del') . '</div></article>';
    }
    page('Painel: opiniões', $html);
}

// ---------------- Visitantes ----------------
$p = isset(PERIODS[$_GET['p'] ?? '']) ? (string) $_GET['p'] : '30';
$fc = clean_line($_GET['c'] ?? '', 2);
$fr = clean_line($_GET['r'] ?? '', 80);
$fci = clean_line($_GET['ci'] ?? '', 80);
if ($fc === '') {
    $fr = $fci = '';
}
$from = $p === 'all' ? '0000-00-00' : date('Y-m-d', strtotime('-' . ((int) $p - 1) . ' days'));
$today = date('Y-m-d');

/** Cláusula WHERE com o período e os filtros pedidos (até ao nível indicado). */
$whereFor = function (int $levels) use ($from, $fc, $fr, $fci): array {
    $w = ['day >= ?'];
    $a = [$from];
    foreach ([[$fc, 'country'], [$fr, 'region'], [$fci, 'city']] as $i => [$val, $col]) {
        if ($i < $levels && $val !== '') {
            $w[] = "$col = ?";
            $a[] = $val === UNKNOWN ? '' : $val;
        }
    }
    return ['WHERE ' . implode(' AND ', $w), $a];
};
$query = function (string $sql, array $args): array {
    $q = visits_db()->prepare($sql);
    $q->execute($args);
    return $q->fetchAll();
};
$url = function (array $set) use ($p, $fc, $fr, $fci): string {
    $params = array_merge(['v' => 'visitas', 'p' => $p, 'c' => $fc, 'r' => $fr, 'ci' => $fci], $set);
    return 'admin.php?' . http_build_query(array_filter($params, function ($v) {
        return $v !== '';
    }));
};
$placeName = function (string $iso, string $region = '', string $city = ''): string {
    $parts = array_filter([$city, $region], 'strlen');
    $country = trim(country_flag($iso) . ' ' . country_name($iso));
    return h($parts ? implode(', ', $parts) . ' · ' . $country : $country);
};

[$where, $args] = $whereFor(3);
$k = $query("SELECT COUNT(*) v, COUNT(DISTINCT visitor) u, COUNT(DISTINCT NULLIF(country, '')) pc, COUNT(DISTINCT NULLIF(city, '')) cc FROM visits $where", $args)[0];

// Período e filtros.
$html .= '<div class="bar">';
foreach (PERIODS as $key => $label) {
    $html .= '<a href="' . h($url(['p' => (string) $key])) . '"' . ($p === (string) $key ? ' class="on"' : '') . '>' . h($label) . '</a>';
}
$html .= '</div>';

[$w1, $a1] = $whereFor(0);
$countries = $query("SELECT country, COUNT(*) v FROM visits $w1 GROUP BY country ORDER BY v DESC", $a1);
$opts = function (array $rows, string $col, string $current, string $all, callable $label): string {
    $o = '<option value="">' . h($all) . '</option>';
    foreach ($rows as $r) {
        $val = $r[$col] === '' ? UNKNOWN : $r[$col];
        $o .= '<option value="' . h($val) . '"' . ($val === $current ? ' selected' : '') . '>' . h($label($r[$col])) . ' (' . n($r['v']) . ')</option>';
    }
    return $o;
};
$html .= '<form class="card filters" method="get" action="admin.php"><input type="hidden" name="v" value="visitas"><input type="hidden" name="p" value="' . h($p) . '">'
    . '<select name="c" aria-label="País">' . $opts($countries, 'country', $fc, 'Todos os países', function ($c) {
        return trim(country_flag($c) . ' ' . country_name($c));
    }) . '</select>';
if ($fc !== '') {
    [$w2, $a2] = $whereFor(1);
    $regions = $query("SELECT region, COUNT(*) v FROM visits $w2 GROUP BY region ORDER BY v DESC", $a2);
    $html .= '<select name="r" aria-label="Região">' . $opts($regions, 'region', $fr, 'Todas as regiões', function ($r) {
        return $r === '' ? 'Desconhecida' : $r;
    }) . '</select>';
    [$w3, $a3] = $whereFor(2);
    $cities = $query("SELECT city, COUNT(*) v FROM visits $w3 GROUP BY city ORDER BY v DESC", $a3);
    $html .= '<select name="ci" aria-label="Cidade">' . $opts($cities, 'city', $fci, 'Todas as cidades', function ($c) {
        return $c === '' ? 'Desconhecida' : $c;
    }) . '</select>';
}
$html .= '<button class="main">Filtrar</button>';
if ($fc !== '') {
    $html .= '<a class="muted" href="' . h($url(['c' => '', 'r' => '', 'ci' => ''])) . '">Limpar filtros</a>';
}
$html .= '<span class="muted">Escolha o país e carregue em Filtrar para ver as regiões e cidades.</span></form>';

// Números.
$html .= '<div class="kpis">'
    . '<div class="kpi"><b>' . n($k['v']) . '</b><span>Visitas</span></div>'
    . '<div class="kpi"><b>' . n($k['u']) . '</b><span>Visitantes (únicos por dia)</span></div>'
    . '<div class="kpi"><b>' . n($k['pc']) . '</b><span>Países</span></div>'
    . '<div class="kpi"><b>' . n($k['cc']) . '</b><span>Cidades</span></div></div>';

// Gráfico: por hora (hoje), por dia (7 e 30 dias) ou por mês.
$buckets = [];
if ($p === '1') {
    for ($hr = 0; $hr < 24; $hr++) {
        $buckets[sprintf('%02d', $hr)] = 0;
    }
    foreach ($query("SELECT created_at FROM visits $where", $args) as $r) {
        $buckets[date('H', strtotime($r['created_at']))]++;
    }
    $axis = ['00h', '12h', '23h'];
    $tip = function ($key, $v) {
        return "$key h: " . n($v) . ' visitas';
    };
} elseif ($p === '7' || $p === '30') {
    for ($d = (int) $p - 1; $d >= 0; $d--) {
        $buckets[date('Y-m-d', strtotime("-$d days"))] = 0;
    }
    foreach ($query("SELECT day, COUNT(*) v FROM visits $where GROUP BY day", $args) as $r) {
        if (isset($buckets[$r['day']])) {
            $buckets[$r['day']] = (int) $r['v'];
        }
    }
    $keys = array_keys($buckets);
    $axis = [date('d/m', strtotime($keys[0])), date('d/m', strtotime($keys[(int) (count($keys) / 2)])), 'hoje'];
    $tip = function ($key, $v) {
        return date('d/m/Y', strtotime($key)) . ': ' . n($v) . ' visitas';
    };
} else {
    foreach ($query("SELECT substr(day, 1, 7) m, COUNT(*) v FROM visits $where GROUP BY m ORDER BY m", $args) as $r) {
        $buckets[$r['m']] = (int) $r['v'];
    }
    if ($p === '365') {
        $full = [];
        for ($m = 11; $m >= 0; $m--) {
            $key = date('Y-m', strtotime("first day of -$m months"));
            $full[$key] = $buckets[$key] ?? 0;
        }
        $buckets = $full;
    }
    $keys = array_keys($buckets);
    $axis = $keys ? [$keys[0], '', end($keys)] : ['', '', ''];
    $tip = function ($key, $v) {
        return "$key: " . n($v) . ' visitas';
    };
}
$max = max(1, max($buckets ?: [0]));
$html .= '<section class="card"><h2>Visitas ' . ($p === '1' ? 'por hora' : (($p === '7' || $p === '30') ? 'por dia' : 'por mês')) . '</h2>';
if ($k['v'] == 0) {
    $html .= '<p class="muted">Ainda não há visitas neste período.</p>';
} else {
    $html .= '<div class="chart">';
    foreach ($buckets as $key => $v) {
        $html .= '<div style="height:' . round($v / $max * 100, 1) . '%" title="' . h($tip($key, $v)) . '"></div>';
    }
    $html .= '</div><div class="axis"><span>' . h($axis[0]) . '</span><span>' . h($axis[1]) . '</span><span>' . h($axis[2]) . '</span></div>';
}
$html .= '</section>';

// Tabelas.
$table = function (string $title, array $rows, callable $label, callable $link) use ($k): string {
    $t = '<section class="card"><h2>' . h($title) . '</h2>';
    if (!$rows) {
        return $t . '<p class="muted">Sem dados.</p></section>';
    }
    $t .= '<table><tr><th></th><th class="n">Visitas</th><th class="n">Visitantes</th></tr>';
    foreach ($rows as $r) {
        $pct = $k['v'] ? round($r['v'] / $k['v'] * 100, 1) : 0;
        $t .= '<tr><td><a href="' . h($link($r)) . '">' . $label($r) . '</a><div class="pct" style="width:' . $pct . '%"></div></td>'
            . '<td class="n">' . n($r['v']) . '</td><td class="n">' . n($r['u']) . '</td></tr>';
    }
    return $t . '</table></section>';
};
$enc = function ($v) {
    return $v === '' ? UNKNOWN : $v;
};

$html .= '<div class="grid2">';
$html .= $table('Países', $query("SELECT country, COUNT(*) v, COUNT(DISTINCT visitor) u FROM visits $where GROUP BY country ORDER BY v DESC LIMIT 50", $args),
    function ($r) use ($placeName) {
        return $placeName($r['country']);
    },
    function ($r) use ($url, $enc) {
        return $url(['c' => $enc($r['country']), 'r' => '', 'ci' => '']);
    });
$html .= $table('Regiões', $query("SELECT country, region, COUNT(*) v, COUNT(DISTINCT visitor) u FROM visits $where GROUP BY country, region ORDER BY v DESC LIMIT 50", $args),
    function ($r) use ($placeName) {
        return $placeName($r['country'], $r['region'] === '' ? 'Região desconhecida' : $r['region']);
    },
    function ($r) use ($url, $enc) {
        return $url(['c' => $enc($r['country']), 'r' => $enc($r['region']), 'ci' => '']);
    });
$html .= $table('Cidades', $query("SELECT country, region, city, COUNT(*) v, COUNT(DISTINCT visitor) u FROM visits $where GROUP BY country, region, city ORDER BY v DESC LIMIT 50", $args),
    function ($r) use ($placeName) {
        return $placeName($r['country'], $r['region'], $r['city'] === '' ? 'Cidade desconhecida' : $r['city']);
    },
    function ($r) use ($url, $enc) {
        return $url(['c' => $enc($r['country']), 'r' => $enc($r['region']), 'ci' => $enc($r['city'])]);
    });
$html .= $table('Idioma da página', $query("SELECT lang, COUNT(*) v, COUNT(DISTINCT visitor) u FROM visits $where GROUP BY lang ORDER BY v DESC", $args),
    function ($r) {
        return h(LANG_LABEL[$r['lang']] ?? $r['lang']);
    },
    function ($r) use ($url) {
        return $url([]);
    });
$html .= '</div>';

// Base de localização e diagnóstico do IP.
$geo = '<section class="card"><h2>Localização por IP</h2>';
if (is_file(geo_file())) {
    try {
        require_once __DIR__ . '/mmdb.php';
        $meta = (new Mmdb(geo_file()))->metadata;
        $geo .= '<p>Base: ' . h($meta['database_type'] ?? 'MMDB') . ', de ' . date('d/m/Y', (int) ($meta['build_epoch'] ?? 0))
            . ' (' . n(filesize(geo_file()) / 1048576) . ' MB). A DB-IP publica uma base nova no início de cada mês.</p>';
    } catch (Throwable $e) {
        $geo .= '<p class="err">A base de localização está danificada: ' . h($e->getMessage()) . '. Actualize-a.</p>';
    }
} else {
    $geo .= '<p class="err">Ainda não há base de localização: as visitas ficam com país «Desconhecido». Carregue em «Actualizar» (descarrega cerca de 60 MB).</p>';
}
$geo .= $form('geo_update', 0, 'Actualizar base de localização');
$mine = geo_lookup(client_ip());
$geo .= '<p class="muted" style="margin-top:14px">O seu acesso: IP detectado <code>' . h(client_ip()) . '</code> → '
    . ($mine['country'] !== '' ? $placeName($mine['country'], $mine['region'], $mine['city']) : 'localização desconhecida')
    . '. Cabeçalhos: REMOTE_ADDR <code>' . h($_SERVER['REMOTE_ADDR'] ?? '') . '</code>, X-Forwarded-For <code>' . h($_SERVER['HTTP_X_FORWARDED_FOR'] ?? '—')
    . '</code>, X-Real-IP <code>' . h($_SERVER['HTTP_X_REAL_IP'] ?? '—') . '</code>. Se o IP detectado não for o seu, a localização das visitas sai errada.</p>';
$geo .= '<p class="muted">Os endereços IP não são guardados: só o país, a região e a cidade aproximados. Um visitante é contado uma vez por dia. '
    . 'Localização por IP: <a href="https://db-ip.com" rel="noreferrer">IP Geolocation by DB-IP</a> (CC BY 4.0).</p></section>';
$html .= $geo;

page('Painel: visitantes', $html);
