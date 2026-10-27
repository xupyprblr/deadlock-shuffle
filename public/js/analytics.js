// Аналитика: Google Analytics 4 и/или Яндекс Метрика. Включается, только если ниже заполнен идентификатор.
//  • GA4 — события и воронки (что крутят, какие режимы, сколько копируют в игру);
//  • Метрика — то же плюс карта кликов и Вебвизор («куда тыкают»).
// Оба счётчика получают одни и те же события через track(name, params).
export const ANALYTICS = {
  ga: '', // идентификатор потока GA4, вида 'G-XXXXXXXXXX'
  ym: 0, // номер счётчика Яндекс Метрики, например 12345678
};

const on = () => !!(ANALYTICS.ga || ANALYTICS.ym);
let started = false;

function addScript(src) {
  const s = document.createElement('script');
  s.async = true; s.src = src;
  document.head.appendChild(s);
}

export function initAnalytics(page) {
  if (started || !on()) return;
  started = true;
  if (ANALYTICS.ga) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', ANALYTICS.ga, { page_title: page });
    addScript('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(ANALYTICS.ga));
  }
  if (ANALYTICS.ym) {
    window.ym = window.ym || function ym() { (window.ym.a = window.ym.a || []).push(arguments); };
    window.ym.l = Date.now();
    addScript('https://mc.yandex.ru/metrika/tag.js');
    window.ym(ANALYTICS.ym, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: true });
  }
  // клики по внешним ссылкам шапки и подвала — одним обработчиком
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[data-track]');
    if (a) track(a.dataset.track, { target: a.dataset.trackV || a.href });
  }, true);
}

// Событие: имя латиницей через «_», параметры — строки и числа
export function track(name, params = {}) {
  if (!on()) return;
  const p = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p[k] = typeof v === 'number' ? v : String(v).slice(0, 100);
  try { if (ANALYTICS.ga && window.gtag) window.gtag('event', name, p); } catch {}
  try { if (ANALYTICS.ym && window.ym) window.ym(ANALYTICS.ym, 'reachGoal', name, p); } catch {}
}
