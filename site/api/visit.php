<?php
/**
 * Regista uma visita ao site (chamado por site.js com navigator.sendBeacon, uma vez por página).
 *
 * Guarda: data, dia, idioma da página, país, região e cidade aproximados (pela base DB-IP) e um
 * identificador anónimo do visitante: hash(sal privado + dia + IP + navegador). O endereço IP
 * não é guardado, e o identificador muda todos os dias, por isso não permite seguir ninguém.
 *
 * Não conta: robôs conhecidos, a mesma página recarregada pelo mesmo visitante em 30 minutos e
 * mais de 200 visitas do mesmo visitante num dia. Responde sempre 204 (sem conteúdo).
 */
require __DIR__ . '/lib.php';

header('Cache-Control: no-store');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    http_response_code(405);
    exit;
}
http_response_code(204);

const BOT_UA = '/bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|whatsapp|telegram|curl|wget|python|java\/|go-http|monitor|uptime/i';

$ua = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
if ($ua === '' || preg_match(BOT_UA, $ua)) {
    exit;
}

$in = json_decode((string) file_get_contents('php://input', false, null, 0, 2048), true);
$lang = is_array($in) && in_array($in['lang'] ?? '', FEEDBACK_LANGS, true) ? $in['lang'] : 'pt';

try {
    date_default_timezone_set(local_timezone());
    $day = date('Y-m-d');
    $ip = client_ip();
    $visitor = hash('sha256', salt() . '|' . $day . '|' . $ip . '|' . $ua);
    $pdo = visits_db();

    $q = $pdo->prepare('SELECT COUNT(*) FROM visits WHERE visitor = ? AND lang = ? AND created_at > ?');
    $q->execute([$visitor, $lang, gmdate('Y-m-d\TH:i:s\Z', time() - 1800)]);
    if ((int) $q->fetchColumn() > 0) {
        exit;
    }
    $q = $pdo->prepare('SELECT COUNT(*) FROM visits WHERE visitor = ?');
    $q->execute([$visitor]);
    if ((int) $q->fetchColumn() >= 200) {
        exit;
    }

    $geo = geo_lookup($ip);
    $pdo->prepare('INSERT INTO visits (created_at, day, lang, visitor, country, region, city) VALUES (?, ?, ?, ?, ?, ?, ?)')
        ->execute([now_utc(), $day, $lang, $visitor, $geo['country'], $geo['region'], $geo['city']]);
} catch (Throwable $e) {
    error_log('Faísca Tracer, visitas: ' . $e->getMessage());
}
