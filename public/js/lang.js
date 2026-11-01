// Язык сайта — общий для рандомайзера и лаборатории.
// Выбор зрителя хранится в localStorage (ключ ds:lang, на /dev/ — с префиксом), иначе — по языку браузера:
// русский для RU и соседних языков (часто знают русский), для всех остальных — английский.
import { NS } from './env.js';

const RU_LIKE = ['ru', 'uk', 'be', 'kk', 'ky', 'uz', 'tg', 'hy', 'az', 'ka', 'tk', 'mo'];
export function browserLang() {
  let list = [];
  try { list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || '']; } catch {}
  for (const l of list) {
    const code = String(l || '').toLowerCase().split('-')[0];
    if (RU_LIKE.includes(code)) return 'ru';
    if (code === 'en') return 'en';
  }
  return 'en';
}
export function getLang() {
  try { const v = JSON.parse(localStorage.getItem(NS + 'ds:lang') || 'null'); if (v === 'ru' || v === 'en') return v; } catch {}
  return browserLang();
}
export function setLang(l) {
  try { localStorage.setItem(NS + 'ds:lang', JSON.stringify(l === 'en' ? 'en' : 'ru')); } catch {}
}
