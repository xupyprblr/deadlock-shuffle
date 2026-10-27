// Аналитика: Google Analytics 4 и/или Яндекс Метрика. Включается, только если ниже заполнен идентификатор.
//  • GA4 — события и воронки (что крутят, какие режимы, сколько копируют в игру);
//  • Метрика — то же плюс карта кликов и Вебвизор («куда тыкают»).
// Оба счётчика получают одни и те же события через track(name, params).
//
// Согласие на cookies (плашка внизу, только на основном сайте):
//  • до выбора и после «Отказаться» GA работает в Consent Mode без cookies (обезличенные пинги);
//  • после «Принять» — полноценно; Метрика (если подключена) запускается только после «Принять».
// На тестовом сайте (/dev/) аналитика выключена целиком.
import { IS_DEV } from './env.js';

export const ANALYTICS = {
  ga: 'G-THC8ZRB51Z', // идентификатор потока GA4 «Randomlock» (https://randomlock.com)
  ym: 0, // номер счётчика Яндекс Метрики, например 12345678
};

const CONSENT_KEY = 'ds:consent'; // 'granted' | 'denied'
const on = () => !IS_DEV && !!(ANALYTICS.ga || ANALYTICS.ym);
let started = false;
let ymStarted = false;

const getConsent = () => { try { return localStorage.getItem(CONSENT_KEY); } catch { return null; } };
const setConsent = (v) => { try { localStorage.setItem(CONSENT_KEY, v); } catch {} };

function addScript(src) {
  const s = document.createElement('script');
  s.async = true; s.src = src;
  document.head.appendChild(s);
}

function startYm() {
  if (ymStarted || !ANALYTICS.ym) return;
  ymStarted = true;
  window.ym = window.ym || function ym() { (window.ym.a = window.ym.a || []).push(arguments); };
  window.ym.l = Date.now();
  addScript('https://mc.yandex.ru/metrika/tag.js');
  window.ym(ANALYTICS.ym, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: true });
}

function applyConsent(v) {
  setConsent(v);
  if (ANALYTICS.ga && window.gtag) window.gtag('consent', 'update', { analytics_storage: v === 'granted' ? 'granted' : 'denied' });
  if (v === 'granted') startYm();
}

export function initAnalytics(page) {
  if (started || !on()) return;
  started = true;
  const consent = getConsent();
  if (ANALYTICS.ga) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() { window.dataLayer.push(arguments); };
    // рекламные данные не нужны никогда; аналитика — по согласию
    window.gtag('consent', 'default', {
      analytics_storage: consent === 'granted' ? 'granted' : 'denied',
      ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
    });
    window.gtag('js', new Date());
    window.gtag('config', ANALYTICS.ga, { page_title: page });
    addScript('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(ANALYTICS.ga));
  }
  if (consent === 'granted') startYm();
  if (!consent) setTimeout(showBanner, 1200); // после первой отрисовки: язык страницы уже выбран
  // клики по внешним ссылкам шапки и подвала — одним обработчиком
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[data-track]');
    if (a) track(a.dataset.track, { target: a.dataset.trackV || a.href });
  }, true);
}

const TEXT = {
  ru: { msg: 'Мы используем cookies аналитики (Google Analytics), чтобы понимать, как пользуются сайтом, и делать его лучше. Если откажешься, сайт будет работать так же.', yes: 'Принять', no: 'Отказаться' },
  en: { msg: 'We use analytics cookies (Google Analytics) to understand how the site is used and make it better. If you decline, the site works just the same.', yes: 'Accept', no: 'Decline' },
};
function showBanner() {
  const lang = (document.documentElement.lang || 'ru').startsWith('ru') ? 'ru' : 'en';
  const tx = TEXT[lang];
  const el = document.createElement('div');
  el.className = 'cookie-bar'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Cookies');
  el.innerHTML = `<p>${tx.msg}</p><div class="cookie-btns"><button class="btn" data-consent="denied">${tx.no}</button><button class="btn btn-game" data-consent="granted">${tx.yes}</button></div>`;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-consent]');
    if (!b) return;
    applyConsent(b.dataset.consent);
    track('consent', { value: b.dataset.consent });
    el.classList.add('hide');
    setTimeout(() => el.remove(), 300);
  });
  document.body.appendChild(el);
}

// Событие: имя латиницей через «_», параметры — строки и числа
export function track(name, params = {}) {
  if (!on()) return;
  const p = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p[k] = typeof v === 'number' ? v : String(v).slice(0, 100);
  try { if (ANALYTICS.ga && window.gtag) window.gtag('event', name, p); } catch {}
  try { if (ANALYTICS.ym && window.ym && ymStarted) window.ym(ANALYTICS.ym, 'reachGoal', name, p); } catch {}
}
