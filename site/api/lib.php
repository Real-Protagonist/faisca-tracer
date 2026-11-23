<?php
/**
 * Funções comuns da API do site (opiniões dos visitantes).
 *
 * Os dados ficam numa pasta FORA do public_html, para não poderem ser descarregados:
 * por omissão `faisca-data/` ao lado do public_html, ou a pasta da variável FAISCA_DATA.
 * Lá ficam a base de dados SQLite (feedback.sqlite), o sal dos endereços IP (salt.txt)
 * e a configuração do painel (config.php, criada à mão: ver config.sample.php).
 *
 * Compatível com PHP 7.4 e 8.x. Precisa da extensão pdo_sqlite.
 */

if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === basename(__FILE__)) {
    http_response_code(404);
    exit;
}

const FEEDBACK_KINDS = ['opinion', 'criticism', 'improvement'];
const FEEDBACK_LANGS = ['pt', 'en', 'fr'];
const MESSAGE_MIN = 10;
const MESSAGE_MAX = 3000;
const NAME_MAX = 80;
const EMAIL_MAX = 120;
/** Mensagens aceites por endereço IP numa hora. */
const RATE_PER_HOUR = 5;

function data_dir(): string
{
    $dir = getenv('FAISCA_DATA') ?: dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'faisca-data';
    if (!is_dir($dir)) {
        mkdir($dir, 0750, true);
    }
    // Segurança extra, caso a pasta acabe dentro da raiz pública noutro alojamento.
    $deny = $dir . DIRECTORY_SEPARATOR . '.htaccess';
    if (!is_file($deny)) {
        file_put_contents($deny, "Require all denied\n");
    }
    return $dir;
}

/** Configuração do painel; vazia se ainda não existir config.php. */
function config(): array
{
    static $cfg = null;
    if ($cfg === null) {
        $file = data_dir() . DIRECTORY_SEPARATOR . 'config.php';
        $cfg = is_file($file) ? (array) (include $file) : [];
    }
    return $cfg;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $pdo = new PDO('sqlite:' . data_dir() . DIRECTORY_SEPARATOR . 'feedback.sqlite');
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $pdo->exec('PRAGMA busy_timeout = 3000');
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                kind TEXT NOT NULL,
                message TEXT NOT NULL,
                name TEXT NOT NULL DEFAULT \'\',
                email TEXT NOT NULL DEFAULT \'\',
                lang TEXT NOT NULL DEFAULT \'pt\',
                ip_hash TEXT NOT NULL,
                is_read INTEGER NOT NULL DEFAULT 0
            )'
        );
        $pdo->exec('CREATE INDEX IF NOT EXISTS feedback_ip ON feedback (ip_hash, created_at)');
    }
    return $pdo;
}

function salt(): string
{
    $file = data_dir() . DIRECTORY_SEPARATOR . 'salt.txt';
    if (!is_file($file)) {
        file_put_contents($file, bin2hex(random_bytes(32)));
    }
    return trim((string) file_get_contents($file));
}

function is_public_ip(string $ip): bool
{
    return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) !== false;
}

/**
 * Endereço IP do visitante. Atrás da CDN do Hostinger, REMOTE_ADDR pode ser o da CDN; o do
 * visitante vem nos cabeçalhos do proxy. Ordem: X-Real-IP, True-Client-IP, CF-Connecting-IP,
 * o último IP público de X-Forwarded-For (o que a CDN acrescentou) e, por fim, REMOTE_ADDR.
 * O painel de visitantes mostra estes valores para confirmar no alojamento real.
 */
function client_ip(): string
{
    foreach (['HTTP_X_REAL_IP', 'HTTP_TRUE_CLIENT_IP', 'HTTP_CF_CONNECTING_IP'] as $h) {
        $ip = trim((string) ($_SERVER[$h] ?? ''));
        if ($ip !== '' && is_public_ip($ip)) {
            return $ip;
        }
    }
    $xff = array_reverse(array_map('trim', explode(',', (string) ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? ''))));
    foreach ($xff as $ip) {
        if ($ip !== '' && is_public_ip($ip)) {
            return $ip;
        }
    }
    return (string) ($_SERVER['REMOTE_ADDR'] ?? '');
}

/** Hash do IP com um sal privado: serve para limitar abusos sem guardar o endereço. */
function ip_hash(): string
{
    return hash('sha256', salt() . '|' . client_ip());
}

/* ---------------- Visitas ---------------- */

/** Base de localização por IP (DB-IP City Lite), na pasta de dados. */
function geo_file(): string
{
    return data_dir() . DIRECTORY_SEPARATOR . 'dbip-city.mmdb';
}

/** País (ISO), região e cidade aproximados do IP; vazios se não houver base ou dados. */
function geo_lookup(string $ip): array
{
    static $db = false;
    $none = ['country' => '', 'region' => '', 'city' => ''];
    if (!is_public_ip($ip)) {
        return $none;
    }
    try {
        if ($db === false) {
            require_once __DIR__ . '/mmdb.php';
            $db = is_file(geo_file()) ? new Mmdb(geo_file()) : null;
        }
        $r = $db ? $db->get($ip) : null;
    } catch (Throwable $e) {
        error_log('Faísca Tracer, localização: ' . $e->getMessage());
        return $none;
    }
    if (!is_array($r)) {
        return $none;
    }
    $name = function ($node) {
        $names = is_array($node) ? ($node['names'] ?? []) : [];
        return clean_line($names['en'] ?? (reset($names) ?: ''), 80);
    };
    return [
        'country' => strtoupper(clean_line($r['country']['iso_code'] ?? '', 2)),
        'region' => $name($r['subdivisions'][0] ?? null),
        'city' => $name($r['city'] ?? null),
    ];
}

/** Nome do país em português (extensão intl) ou o código ISO. */
function country_name(string $iso): string
{
    if ($iso === '') {
        return 'Desconhecido';
    }
    if (class_exists('Locale')) {
        $n = Locale::getDisplayRegion('-' . $iso, 'pt_PT');
        if ($n !== '' && $n !== $iso) {
            return $n;
        }
    }
    return $iso;
}

/** Bandeira do país em emoji (letras regionais). */
function country_flag(string $iso): string
{
    if (!preg_match('/^[A-Z]{2}$/', $iso)) {
        return '';
    }
    return mb_chr(0x1F1E6 + ord($iso[0]) - 65) . mb_chr(0x1F1E6 + ord($iso[1]) - 65);
}

function visits_db(): PDO
{
    static $ready = false;
    $pdo = db();
    if (!$ready) {
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS visits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                day TEXT NOT NULL,
                lang TEXT NOT NULL,
                visitor TEXT NOT NULL,
                country TEXT NOT NULL DEFAULT \'\',
                region TEXT NOT NULL DEFAULT \'\',
                city TEXT NOT NULL DEFAULT \'\'
            )'
        );
        $pdo->exec('CREATE INDEX IF NOT EXISTS visits_day ON visits (day)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS visits_visitor ON visits (visitor, created_at)');
        $ready = true;
    }
    return $pdo;
}

/**
 * Descarrega a base DB-IP City Lite do mês (ou do mês anterior, se a do mês ainda não saiu),
 * descomprime-a e só substitui a actual depois de confirmar que funciona.
 * Devolve uma mensagem para o painel. A DB-IP publica uma base nova no início de cada mês.
 */
function geo_update(): string
{
    @set_time_limit(600);
    $dir = data_dir() . DIRECTORY_SEPARATOR;
    $gz = $dir . 'dbip-city.mmdb.gz.part';
    $tmp = $dir . 'dbip-city.mmdb.part';
    $got = '';
    foreach ([date('Y-m'), date('Y-m', strtotime('first day of last month'))] as $month) {
        $url = "https://download.db-ip.com/free/dbip-city-lite-$month.mmdb.gz";
        if (download_to($url, $gz)) {
            $got = $month;
            break;
        }
    }
    if ($got === '') {
        @unlink($gz);
        return 'Não foi possível descarregar a base da DB-IP. Tente mais tarde.';
    }
    $in = gzopen($gz, 'rb');
    $out = fopen($tmp, 'wb');
    if (!$in || !$out) {
        return 'Não foi possível descomprimir a base.';
    }
    while (!gzeof($in)) {
        fwrite($out, (string) gzread($in, 1 << 20));
    }
    gzclose($in);
    fclose($out);
    @unlink($gz);
    try {
        require_once __DIR__ . '/mmdb.php';
        $test = (new Mmdb($tmp))->get('8.8.8.8');
        if (($test['country']['iso_code'] ?? '') !== 'US') {
            throw new RuntimeException('teste de consulta falhou');
        }
    } catch (Throwable $e) {
        @unlink($tmp);
        return 'A base descarregada não é válida (' . $e->getMessage() . ').';
    }
    if (is_file(geo_file()) && !@unlink(geo_file())) {
        @unlink($tmp);
        return 'Não foi possível substituir a base actual.';
    }
    rename($tmp, geo_file());
    return "Base de localização actualizada (DB-IP City Lite, $got).";
}

function download_to(string $url, string $file): bool
{
    $fh = fopen($file, 'wb');
    if (!$fh) {
        return false;
    }
    $ok = false;
    if (function_exists('curl_init')) {
        $c = curl_init($url);
        curl_setopt_array($c, [CURLOPT_FILE => $fh, CURLOPT_FOLLOWLOCATION => true, CURLOPT_FAILONERROR => true,
            CURLOPT_CONNECTTIMEOUT => 20, CURLOPT_TIMEOUT => 540, CURLOPT_USERAGENT => 'FaiscaTracer-site']);
        $ok = curl_exec($c) !== false && curl_getinfo($c, CURLINFO_HTTP_CODE) === 200;
        curl_close($c);
    } elseif (ini_get('allow_url_fopen')) {
        $src = @fopen($url, 'rb');
        if ($src) {
            $ok = stream_copy_to_stream($src, $fh) > 0;
            fclose($src);
        }
    }
    fclose($fh);
    if (!$ok || filesize($file) < 1000000) {
        @unlink($file);
        return false;
    }
    return true;
}

/** Fuso horário do painel e dos dias das estatísticas. */
function local_timezone(): string
{
    $tz = (string) (config()['timezone'] ?? 'Africa/Luanda');
    return in_array($tz, timezone_identifiers_list(), true) ? $tz : 'Africa/Luanda';
}

function now_utc(): string
{
    return gmdate('Y-m-d\TH:i:s\Z');
}

/** Texto de uma linha, sem caracteres de controlo e com espaços normalizados. */
function clean_line($value, int $max): string
{
    $s = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', (string) $value);
    $s = trim(preg_replace('/\s+/u', ' ', (string) $s));
    return mb_substr($s, 0, $max);
}

/** Texto de várias linhas: mantém as mudanças de linha, retira os outros caracteres de controlo. */
function clean_text($value): string
{
    $s = str_replace(["\r\n", "\r"], "\n", (string) $value);
    $s = preg_replace('/[\x00-\x09\x0B-\x1F\x7F]+/u', ' ', $s);
    $s = preg_replace("/\n{3,}/", "\n\n", (string) $s);
    return trim((string) $s);
}

function h($s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}
