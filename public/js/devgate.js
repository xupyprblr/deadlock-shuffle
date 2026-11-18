// Пароль на тестовый сайт (/dev/). Обычный скрипт в <head> до остальных: пока пароль не введён, страница скрыта.
// В коде только SHA-256 пароля; после верного ввода браузер запоминает доступ (localStorage, ключ dev:gate).
// Это защита от случайных посетителей, а не настоящая: GitHub Pages не умеет закрывать адреса на сервере.
// На основном сайте ничего не делает.
(function () {
  if (!/^\/dev(\/|$)/.test(location.pathname)) return;
  var KEY = 'dev:gate';
  var HASH = 'cf144f30e8202f4faa336e79b0a6cb01707243e44556aeff303df6aadcf9729c';
  try { if (localStorage.getItem(KEY) === HASH) return; } catch (e) {}

  var root = document.documentElement;
  root.classList.add('dev-locked');
  var css = document.createElement('style');
  css.textContent =
    'html.dev-locked body{visibility:hidden;overflow:hidden}' +
    '.dev-gate{visibility:visible;position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:16px;background:#100e0e;color:#f7e9d5;font:500 16px Jost,system-ui,sans-serif}' +
    '.dev-gate form{display:grid;gap:12px;width:min(100%,320px);text-align:center}' +
    '.dev-gate b{font:900 22px Rubik,Arial Black,sans-serif;letter-spacing:.03em}' +
    '.dev-gate b i{font-style:normal;color:#dd6638}' +
    '.dev-gate input{padding:11px 12px;font:500 16px inherit;color:#f7e9d5;background:#1a1716;border:2px solid #f7e9d5}' +
    '.dev-gate button{padding:11px 12px;font:900 14px Rubik,Arial Black,sans-serif;text-transform:uppercase;background:#60cde3;color:#070707;border:2px solid #070707;cursor:pointer}' +
    '.dev-gate small{min-height:1.2em;color:#dd6638}';
  document.head.appendChild(css);

  async function sha256(s) {
    var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  function show() {
    var el = document.createElement('div');
    el.className = 'dev-gate';
    el.innerHTML = '<form autocomplete="off"><b>RANDOM<i>LOCK</i> · DEV</b>' +
      '<span>Тестовая версия. Введи пароль<br><small style="color:inherit;opacity:.6">Test build. Enter the password</small></span>' +
      '<input type="password" name="p" aria-label="Пароль" autofocus required>' +
      '<button>Войти</button><small role="status"></small></form>';
    document.body.appendChild(el);
    var form = el.querySelector('form'), msg = el.querySelector('small[role]');
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var h = await sha256(form.p.value.trim());
      if (h !== HASH) { msg.textContent = 'Неверный пароль'; form.p.select(); return; }
      try { localStorage.setItem(KEY, HASH); } catch (err) {}
      root.classList.remove('dev-locked');
      el.remove();
    });
    form.p.focus();
  }
  if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
})();
