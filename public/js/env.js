// Окружение сайта: основной (randomlock.com) или тестовый (randomlock.com/dev/, ветка dev).
// Тестовый живёт отдельно: свои ключи в localStorage, без аналитики и плашки cookies, не индексируется, с меткой DEV.
export const IS_DEV = typeof location !== 'undefined' && /^\/dev(\/|$)/.test(location.pathname);
export const NS = IS_DEV ? 'dev:' : '';

export function markDev() {
  if (!IS_DEV || typeof document === 'undefined') return;
  const m = document.createElement('meta'); m.name = 'robots'; m.content = 'noindex, nofollow'; document.head.appendChild(m);
  document.title = '[DEV] ' + document.title;
  const r = document.createElement('div');
  r.className = 'dev-ribbon'; r.textContent = 'DEV';
  r.title = 'Тестовая версия (ветка dev). Основной сайт — randomlock.com';
  document.body.appendChild(r);
}
