// Настройки сайта. live=true — браузер сам проверяет свежую версию игры в API.
// Ветка dev → https://randomlock.com/dev/ (тестовый сайт). Основной — ветка main → https://randomlock.com/
// Отдельный файл (а не встроенный <script>), чтобы политика безопасности (CSP) запрещала любые встроенные скрипты.
window.DS_CONFIG = { live: true, dataUrl: 'data/' };
