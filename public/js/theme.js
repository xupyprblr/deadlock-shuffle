// Тема сайта: тёмная по умолчанию (независимо от настроек системы), светлая — по выбору зрителя.
// Обычный скрипт (не модуль) в <head>: ставит data-theme до первой отрисовки, без вспышки тёмного.
// Встроенные скрипты запрещены CSP, поэтому отдельный файл. На тестовом сайте (/dev/) — свой ключ.
(function () {
  var DEV = /^\/dev(\/|$)/.test(location.pathname);
  var KEY = (DEV ? 'dev:' : '') + 'ds:theme';
  var BAR = { dark: '#100e0e', light: '#efe6d6' };
  var root = document.documentElement;

  function read() { try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch (e) { return 'dark'; } }
  function meta(t) { var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', BAR[t]); }
  function label(t) {
    var ru = (root.lang || 'ru').slice(0, 2) !== 'en';
    return t === 'light' ? (ru ? 'Включить тёмную тему' : 'Switch to dark theme') : (ru ? 'Включить светлую тему' : 'Switch to light theme');
  }
  function sync() {
    var t = root.getAttribute('data-theme') || 'dark';
    var bs = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < bs.length; i++) { bs[i].setAttribute('aria-pressed', String(t === 'light')); bs[i].setAttribute('aria-label', label(t)); bs[i].title = label(t); }
  }
  function apply(t) { root.setAttribute('data-theme', t); meta(t); sync(); }
  function set(t) {
    t = t === 'light' ? 'light' : 'dark';
    try { if (t === 'light') localStorage.setItem(KEY, 'light'); else localStorage.removeItem(KEY); } catch (e) {}
    apply(t);
    try { document.dispatchEvent(new CustomEvent('ds:theme', { detail: t })); } catch (e) {}
  }

  apply(read());

  // Кнопка-переключатель: солнце в тёмной теме, луна — в светлой (иконки меняет CSS)
  var ICON = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
    '<g class="i-sun"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></g>' +
    '<path class="i-moon" d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>';
  function button() { return '<button type="button" class="theme-btn" data-theme-toggle>' + ICON + '</button>'; }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-theme-toggle]');
    if (b) set((root.getAttribute('data-theme') || 'dark') === 'light' ? 'dark' : 'light');
  });
  // Страницы со статичной шапкой (лаборатория, «Мои рандомы», 404): кнопку добавляем сами.
  // Главная рисует шапку в app.js и вставляет кнопку через DS_THEME.button().
  document.addEventListener('DOMContentLoaded', function () {
    if (!document.querySelector('[data-theme-toggle]')) {
      var host = document.querySelector('.top:not(#top) .top-side') || document.querySelector('.top:not(#top)');
      if (host) host.insertAdjacentHTML('beforeend', '<div class="theme-slot">' + button() + '</div>');
    }
    sync();
  });

  window.DS_THEME = { get: function () { return root.getAttribute('data-theme') || 'dark'; }, set: set, button: button, sync: sync };
})();
