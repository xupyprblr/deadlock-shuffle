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
const T = {
  ru: { passive: 'Пассивное', active: 'Активное', actTag: 'Активный', loading: 'Загружаю описание…', none: 'Описание пока недоступно.', cond: 'при условии', upTo: 'Улучшается в:', from: 'Собирается из:' },
  en: { passive: 'Passive', active: 'Active', actTag: 'Active', loading: 'Loading description…', none: 'Description is not available yet.', cond: 'Conditional', upTo: 'Upgrades to:', from: 'Built from:' },
};

// item — предмет из снимка (name, cost, tier, cat, active, icon, slug, from); data — tips-файл;
// all — все предметы снимка (для «Улучшается в» / «Собирается из»); src — путь картинки; fmt — формат чисел
export function tipCard(item, data, lang, src, fmt, all = []) {
  const tx = T[lang] || T.en;
  const tip = data && data.items ? data.items[item.id >>> 0] : null;
  const ico = (k, cls = '') => (data && k >= 0 && data.icons[k] ? `<img class="${cls}" src="${esc(src(data.icons[k]))}" alt="" width="18" height="18">` : '');
  const cond = (c) => (c ? `<i class="tc-cond">${esc(c === 1 ? tx.cond : c)}</i>` : '');
  const big = ([k, v, l, c]) => `<div class="tc-cell tc-big">${ico(k)}<b>${esc(v)}</b><span>${esc(l)}</span>${cond(c)}</div>`;
  const small = ([k, v, l, c]) => `<div class="tc-cell tc-small"><span><b>${esc(v)}</b> ${esc(l)}</span>${cond(c)}</div>`;
  let body = '';
  if (!data) body = `<p class="tc-text tc-muted">${tx.loading}</p>`;
  else if (!tip) body = `<p class="tc-text tc-muted">${tx.none}</p>`;
  else {
    if (tip.innate.length) body += `<div class="tc-innate">${tip.innate.map(([, v, l]) => `<div><b>${esc(v)}</b> ${esc(l)}</div>`).join('')}</div>`;
    for (const sec of tip.sections) {
      const cells = [...sec.big.map(big), ...sec.small.map(small)].join('');
      body += `<div class="tc-sec">
        <div class="tc-sec-h"><span>${sec.type === 'active' ? tx.active : tx.passive}</span>${sec.cd ? `<span class="tc-cd">${ico(sec.cd[0])}${esc(sec.cd[1])}</span>` : ''}</div>
        ${sec.text ? `<p class="tc-text">${rich(sec.text)}</p>` : ''}
        ${cells ? `<div class="tc-grid">${cells}</div>` : ''}
      </div>`;
    }
  }
  // связи по дереву предметов
  const bySlug = Object.fromEntries(all.map((i) => [i.slug, i]));
  const ups = all.filter((i) => (i.from || []).includes(item.slug));
  const comps = (item.from || []).map((sl) => bySlug[sl]).filter(Boolean);
  const link = (i) => `<span class="tc-link ${esc(i.cat)}">${i.icon ? `<img src="${esc(src(i.icon))}" alt="" width="24" height="24">` : ''}${esc(i.name)}</span>`;
  const tree = (label, list) => (list.length ? `<div class="tc-tree"><div class="tc-tree-h">${label}</div><div class="tc-links">${list.map(link).join('')}</div></div>` : '');
  return `<div class="tipcard ${esc(item.cat)}">
    <div class="tc-head">
      <div class="tc-title">${esc(item.name)}</div>
      <div class="tc-meta"><span class="tc-cost"><i class="tc-soul" aria-hidden="true"></i>${esc(fmt(item.cost))}</span>${item.active ? `<span class="tc-act">${tx.actTag}</span>` : ''}</div>
    </div>
    <div class="tc-body">${body}</div>
    ${tree(tx.from, comps)}${tree(tx.upTo, ups)}
  </div>`;
}
