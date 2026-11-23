<?php
/**
 * Recebe uma opinião, crítica ou sugestão de melhoria do formulário do site.
 *
 * POST, em JSON (pedido do script do site) ou como formulário normal (navegador sem JavaScript).
 * Campos: kind (opinion | criticism | improvement), message, name (opcional), email (opcional),
 * lang (pt | en | fr), elapsed (ms desde que o formulário apareceu) e website (armadilha para robôs:
 * tem de vir vazio).
 *
 * Respostas JSON: 200 {ok:true}; 400 {ok:false,error:"invalid",fields:[...]}; 405; 429 {error:"rate"};
 * 500 {error:"server"}. Sem JavaScript, redirecciona para a página do idioma com ?opiniao=ok|erro.
 */
require __DIR__ . '/lib.php';

header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

$isJson = stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== false;

function reply(bool $json, int $status, array $body, string $lang): void
{
    if ($json) {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($body, JSON_UNESCAPED_UNICODE);
    } else {
        $page = $lang === 'pt' ? '../' : "../$lang/";
        header('Location: ' . $page . '?opiniao=' . ($status === 200 ? 'ok' : 'erro') . '#feedback', true, 303);
    }
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    reply(true, 405, ['ok' => false, 'error' => 'method'], 'pt');
}

$raw = $isJson ? json_decode((string) file_get_contents('php://input'), true) : $_POST;
$in = is_array($raw) ? $raw : [];
$lang = in_array($in['lang'] ?? '', FEEDBACK_LANGS, true) ? $in['lang'] : 'pt';

// Robôs: o campo escondido vem preenchido ou o envio foi instantâneo. Responde-se «ok» sem guardar.
$elapsed = isset($in['elapsed']) ? (int) $in['elapsed'] : null;
if (trim((string) ($in['website'] ?? '')) !== '' || ($elapsed !== null && $elapsed < 2500)) {
    reply($isJson, 200, ['ok' => true], $lang);
}

foreach (['kind', 'message', 'name', 'email'] as $k) {
    if (isset($in[$k]) && (!is_string($in[$k]) || !mb_check_encoding($in[$k], 'UTF-8'))) {
        reply($isJson, 400, ['ok' => false, 'error' => 'invalid', 'fields' => [$k]], $lang);
    }
}

$kind = (string) ($in['kind'] ?? '');
$message = clean_text($in['message'] ?? '');
$name = clean_line($in['name'] ?? '', NAME_MAX);
$email = clean_line($in['email'] ?? '', EMAIL_MAX);

$bad = [];
if (!in_array($kind, FEEDBACK_KINDS, true)) {
    $bad[] = 'kind';
}
$len = mb_strlen($message);
if ($len < MESSAGE_MIN || $len > MESSAGE_MAX) {
    $bad[] = 'message';
}
if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    $bad[] = 'email';
}
if ($bad) {
    reply($isJson, 400, ['ok' => false, 'error' => 'invalid', 'fields' => $bad], $lang);
}

try {
    $pdo = db();
    $ip = ip_hash();
    $since = gmdate('Y-m-d\TH:i:s\Z', time() - 3600);
    $q = $pdo->prepare('SELECT COUNT(*) FROM feedback WHERE ip_hash = ? AND created_at > ?');
    $q->execute([$ip, $since]);
    if ((int) $q->fetchColumn() >= RATE_PER_HOUR) {
        reply($isJson, 429, ['ok' => false, 'error' => 'rate'], $lang);
    }
    $pdo->prepare('INSERT INTO feedback (created_at, kind, message, name, email, lang, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?)')
        ->execute([now_utc(), $kind, $message, $name, $email, $lang, $ip]);
} catch (Throwable $e) {
    error_log('Faísca Tracer, opiniões: ' . $e->getMessage());
    reply($isJson, 500, ['ok' => false, 'error' => 'server'], $lang);
}

reply($isJson, 200, ['ok' => true], $lang);
