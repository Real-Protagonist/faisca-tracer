/*
 * Contador de downloads e formulário de opiniões. Os textos vêm da própria página
 * (atributos data-*), para o mesmo script servir as três línguas.
 */
(function () {
  'use strict';

  var lang = document.documentElement.lang || 'pt';
  var script = document.currentScript;

  /* ---------------- Visita ----------------
   * Uma por página aberta, para as estatísticas do painel (país, região e cidade aproximados).
   * Não usa cookies nem guarda nada no navegador. Não conta se a página inicial vai
   * redireccionar para outro idioma (conta só a página final) nem com Global Privacy Control.
   */
  if (!window.faiscaRedirecting && !navigator.globalPrivacyControl && navigator.sendBeacon && window.URL) {
    try {
      var visitUrl = new URL('api/visit.php', script ? script.src : location.href).href;
      navigator.sendBeacon(visitUrl, new Blob([JSON.stringify({ lang: lang })], { type: 'text/plain' }));
    } catch (e) {
      /* sem estatísticas nesta visita */
    }
  }
  // Português de Portugal e Angola: milhares separados por espaço (12 500), não por ponto.
  var fmt = window.Intl ? new Intl.NumberFormat(lang === 'pt' ? 'pt-PT' : lang) : { format: String };

  /* ---------------- Contador de downloads ----------------
   * Soma os downloads dos instaladores de todas as versões publicadas no GitHub Releases.
   * Os ficheiros de actualização automática (.sig, latest.json) não contam.
   * A API pública permite 60 pedidos por hora e por visitante; com cache: 'no-cache' o navegador
   * revalida com ETag e as respostas 304 não gastam esse limite.
   */
  var API = 'https://api.github.com/repos/Real-Protagonist/faisca-tracer/releases?per_page=100';
  var INSTALLER = /\.(exe|msi|dmg|appimage|deb|rpm)$/i;
  var EVERY = 60 * 1000;
  var BACKOFF = 5 * 60 * 1000;
  var counters = document.querySelectorAll('[data-downloads]');
  var last = null;
  var lastLoad = 0;
  var timer = null;

  function show(total) {
    for (var i = 0; i < counters.length; i++) {
      var el = counters[i];
      var num = el.querySelector('[data-count]');
      if (num) num.textContent = fmt.format(total);
      el.hidden = false;
      if (last !== null && total !== last) {
        el.classList.remove('bump');
        void el.offsetWidth; // reinicia a animação
        el.classList.add('bump');
      }
    }
    last = total;
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(load, ms);
  }

  function load() {
    if (document.hidden) return; // retoma quando a aba voltar a estar visível
    lastLoad = Date.now();
    fetch(API, { cache: 'no-cache', headers: { Accept: 'application/vnd.github+json' } })
      .then(function (r) {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then(function (releases) {
        var total = 0;
        for (var i = 0; i < releases.length; i++) {
          var assets = releases[i].assets || [];
          for (var j = 0; j < assets.length; j++) {
            if (INSTALLER.test(assets[j].name)) total += assets[j].download_count || 0;
          }
        }
        show(total);
        schedule(EVERY);
      })
      .catch(function () {
        // Sem rede ou limite da API atingido: mantém o último número e tenta mais tarde.
        schedule(BACKOFF);
      });
  }

  if (counters.length && window.fetch) {
    load();
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && Date.now() - lastLoad > EVERY / 2) load();
    });
  }

  /* ---------------- Formulário de opiniões ---------------- */
  var form = document.querySelector('form[data-feedback]');
  if (!form) return;

  var shownAt = Date.now();
  var status = form.querySelector('[data-status]');
  var button = form.querySelector('button[type="submit"]');
  var message = form.querySelector('textarea[name="message"]');
  var chars = form.querySelector('[data-chars]');

  function say(key, kind) {
    status.textContent = form.getAttribute('data-msg-' + key) || '';
    status.className = 'form-status' + (kind ? ' ' + kind : '');
  }

  function updateChars() {
    if (chars) chars.textContent = fmt.format(message.value.length) + ' / ' + fmt.format(Number(message.maxLength));
  }
  if (message) {
    message.addEventListener('input', updateChars);
    updateChars();
  }

  // Volta de um envio sem JavaScript (?opiniao=ok|erro).
  var back = /[?&]opiniao=(ok|erro)/.exec(location.search);
  if (back) say(back[1] === 'ok' ? 'ok' : 'error', back[1] === 'ok' ? 'good' : 'bad');

  form.addEventListener('submit', function (ev) {
    if (!window.fetch || !window.JSON) return; // envio normal do formulário
    ev.preventDefault();
    if (!form.reportValidity()) return;

    var data = {};
    var fields = form.elements;
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (!f.name || ((f.type === 'radio' || f.type === 'checkbox') && !f.checked)) continue;
      data[f.name] = f.value;
    }
    data.elapsed = Date.now() - shownAt;

    button.disabled = true;
    say('sending', '');
    fetch(form.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(data)
    })
      .then(function (r) {
        if (r.ok) {
          form.reset();
          updateChars();
          say('ok', 'good');
        } else if (r.status === 429) {
          say('rate', 'bad');
        } else if (r.status === 400) {
          say('invalid', 'bad');
        } else {
          say('error', 'bad');
        }
      })
      .catch(function () {
        say('error', 'bad');
      })
      .then(function () {
        button.disabled = false;
      });
  });
})();
