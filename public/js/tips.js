// Карточка предмета как в игре: название и цена, базовые бонусы, блоки «Пассивное»/«Активное»,
// крупные и мелкие значения. Данные — data/tips.{lang}.json (собирает sync.mjs), грузятся при первом показе.
const cache = {};
export function loadTips(base, lang) {
  if (!cache[lang]) {
    cache[lang] = fetch(`${base}tips.${lang}.json?v=${Math.floor(Date.now() / 36e5)}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return cache[lang];
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// текст из API уже без HTML; **…** — выделение игры
const rich = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
const ROMAN = ['', 'I', 'II', 'III', 'IV'];
const T = {
  ru: { passive: 'Пассивное', active: 'Активное', tier: 'тир', actTag: 'Активный', loading: 'Загружаю описание…', none: 'Описание пока недоступно.' },
  en: { passive: 'Passive', active: 'Active', tier: 'tier', actTag: 'Active', loading: 'Loading description…', none: 'Description is not available yet.' },
};

// item — предмет из снимка (name, cost, tier, cat, active, icon); data — tips-файл; src — функция пути картинки
export function tipCard(item, data, lang, src, fmt) {
  const tx = T[lang] || T.en;
  const tip = data && data.items ? data.items[item.id >>> 0] : null;
  const icon = (k) => (data && k >= 0 && data.icons[k] ? `<img src="${esc(src(data.icons[k]))}" alt="" width="18" height="18">` : '');
  const rows = (list, cls) => list.map(([k, v, l]) => `<div class="${cls}">${icon(k)}<b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('');
  let body = '';
  if (!data) body = `<p class="tc-text tc-muted">${tx.loading}</p>`;
  else if (!tip) body = `<p class="tc-text tc-muted">${tx.none}</p>`;
  else {
    if (tip.innate.length) body += `<div class="tc-innate">${tip.innate.map(([, v, l]) => `<div><b>${esc(v)}</b> ${esc(l)}</div>`).join('')}</div>`;
    for (const sec of tip.sections) {
      body += `<div class="tc-sec">
        <div class="tc-sec-h">${sec.type === 'active' ? tx.active : tx.passive}</div>
        ${sec.text ? `<p class="tc-text">${rich(sec.text)}</p>` : ''}
        ${sec.big.length ? `<div class="tc-big">${rows(sec.big, 'tc-bigcell')}</div>` : ''}
        ${sec.small.length ? `<div class="tc-small">${rows(sec.small, 'tc-smallcell')}</div>` : ''}
      </div>`;
    }
  }
  return `<div class="tipcard ${esc(item.cat)}">
    <div class="tc-head">
      <div class="tc-title">${esc(item.name)}</div>
      <div class="tc-meta"><span class="tc-cost">${esc(fmt(item.cost))}</span><span class="tc-tier">${ROMAN[item.tier] || ''} ${tx.tier}</span>${item.active ? `<span class="tc-act">${tx.actTag}</span>` : ''}</div>
    </div>
    <div class="tc-body">${body}</div>
  </div>`;
}
