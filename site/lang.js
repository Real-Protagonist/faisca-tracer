/*
 * Idioma do site: português (raiz), inglês (/en/) e francês (/fr/).
 *
 * Na página inicial em português, quem ainda não escolheu um idioma é levado para o idioma do seu
 * país. O país deduz-se do fuso horário do computador e, se este não chegar, da região do navegador
 * (pt-AO, fr-CI, ...). Sem país conhecido, vale o idioma do navegador; sem nenhum dos três, inglês.
 * Tudo corre no navegador: nada é enviado para fora.
 *
 * A escolha feita no selector de idioma fica guardada e passa à frente da detecção.
 */
(function () {
  var KEY = 'faisca.site.lang';
  var LANGS = ['pt', 'en', 'fr'];
  var HOME = { pt: './', en: 'en/', fr: 'fr/' };

  // Fusos horários de países onde o português ou o francês é a língua de ensino.
  // Países com várias línguas (Bélgica, Suíça, Canadá, Ruanda) ficam de fora: decide o navegador.
  var ZONES = {
    pt: [
      'Africa/Luanda', 'Africa/Maputo', 'Africa/Bissau', 'Africa/Sao_Tome', 'Atlantic/Cape_Verde',
      'Europe/Lisbon', 'Atlantic/Madeira', 'Atlantic/Azores', 'Asia/Dili',
      'America/Sao_Paulo', 'America/Araguaina', 'America/Bahia', 'America/Belem', 'America/Boa_Vista',
      'America/Campo_Grande', 'America/Cuiaba', 'America/Eirunepe', 'America/Fortaleza', 'America/Maceio',
      'America/Manaus', 'America/Noronha', 'America/Porto_Velho', 'America/Recife', 'America/Rio_Branco',
      'America/Santarem'
    ],
    fr: [
      'Europe/Paris', 'Europe/Monaco', 'Europe/Luxembourg',
      'Africa/Kinshasa', 'Africa/Lubumbashi', 'Africa/Brazzaville', 'Africa/Libreville', 'Africa/Douala',
      'Africa/Abidjan', 'Africa/Dakar', 'Africa/Bamako', 'Africa/Ouagadougou', 'Africa/Niamey',
      'Africa/Ndjamena', 'Africa/Bangui', 'Africa/Porto-Novo', 'Africa/Lome', 'Africa/Conakry',
      'Africa/Bujumbura', 'Africa/Djibouti', 'Africa/Nouakchott', 'Africa/Algiers', 'Africa/Tunis',
      'Africa/Casablanca', 'Indian/Antananarivo', 'Indian/Comoro', 'Indian/Mayotte', 'Indian/Reunion',
      'America/Port-au-Prince', 'America/Martinique', 'America/Guadeloupe', 'America/Cayenne',
      'America/Miquelon', 'Pacific/Noumea', 'Pacific/Tahiti'
    ]
  };

  // Códigos de país (ISO 3166) com a mesma regra.
  var COUNTRIES = {
    pt: ['AO', 'MZ', 'GW', 'ST', 'CV', 'PT', 'TL', 'BR'],
    fr: [
      'FR', 'MC', 'LU', 'CD', 'CG', 'GA', 'CM', 'CI', 'SN', 'ML', 'BF', 'NE', 'TD', 'CF', 'BJ', 'TG',
      'GN', 'BI', 'DJ', 'MR', 'DZ', 'TN', 'MA', 'MG', 'KM', 'YT', 'RE', 'HT', 'MQ', 'GP', 'GF', 'PM',
      'NC', 'PF'
    ]
  };

  function read() {
    try {
      var v = localStorage.getItem(KEY);
      return LANGS.indexOf(v) >= 0 ? v : null;
    } catch (e) {
      return null;
    }
  }

  function save(lang) {
    try {
      localStorage.setItem(KEY, lang);
    } catch (e) {
      /* sem armazenamento: a escolha vale só para esta visita */
    }
  }

  function byList(table, value) {
    for (var lang in table) if (table[lang].indexOf(value) >= 0) return lang;
    return null;
  }

  function browserTags() {
    var list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
    return Array.prototype.slice.call(list);
  }

  /** Idioma sugerido pela localização da pessoa e, na falta dela, pelo navegador. */
  function detect() {
    var zone = '';
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (e) {
      /* navegador antigo */
    }
    var fromZone = byList(ZONES, zone);
    if (fromZone) return fromZone;

    var tags = browserTags();
    for (var i = 0; i < tags.length; i++) {
      var region = (String(tags[i]).split('-')[1] || '').toUpperCase();
      var fromRegion = region.length === 2 ? byList(COUNTRIES, region) : null;
      if (fromRegion) return fromRegion;
    }
    for (var j = 0; j < tags.length; j++) {
      var base = String(tags[j]).slice(0, 2).toLowerCase();
      if (LANGS.indexOf(base) >= 0) return base;
    }
    return 'en';
  }

  window.faiscaSite = { detect: detect };

  // Selector de idioma: guarda a escolha (funciona antes de a página acabar de carregar).
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a[data-lang]') : null;
    if (a) save(a.getAttribute('data-lang'));
  });

  // Só a página inicial em português redirecciona; as páginas /en/ e /fr/ abrem sempre como pedidas.
  var me = document.currentScript;
  if (!me || !me.hasAttribute('data-home')) return;
  var lang = read() || detect();
  if (lang !== 'pt') {
    window.faiscaRedirecting = true; // site.js não conta esta página: conta a do idioma
    location.replace(HOME[lang] + location.hash);
  }
})();
