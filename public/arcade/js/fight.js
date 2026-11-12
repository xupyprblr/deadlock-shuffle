// «Подвальный бой»: экран выбора, игровой цикл 60 кадров/с, интерфейс поверх холста, звук.
import { CHARS, SPECIALS } from './data.js';
import { Game } from './engine.js';
import { render, loadArt } from './render.js';
import { initInput, readInput, endFrame, bindTouch, setSolo, KEYCAP } from './input.js';
import { makeAI } from './ai.js';
import { sfx, music, duck, say, setSound, unlock } from './sound.js';
import { markDev, NS } from '../../js/env.js';

markDev();
const $ = (id) => document.getElementById(id);
const cv = $('cv'), g = cv.getContext('2d');
g.imageSmoothingEnabled = false;
loadArt().catch((e) => console.error('arcade art', e));
const ICON = '../icons/images/';
const KEY = NS + 'arcade:fight';

const DEF = { p1: 'bebop', p2: 'lash', mode: 'cpu', level: 'normal', sound: true, music: true, voice: true, dummy: 'stand', immortal: true, meter: false };
const prefs = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEF }; } })();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {} };

let G = null, ai = null, paused = false, debug = false, acc = 0, last = 0, screen = 'select';

// ---------- звук ----------
const audio = unlock; // первое нажатие будит звук
const applySound = () => setSound({ sound: prefs.sound, music: prefs.music, voice: prefs.voice });
const SAY_NAME = { bebop: 'Бибоп', lash: 'Лэш' }; // как диктору произносить имена
const ROUND_WORD = ['один', 'два', 'три', 'четыре', 'пять'];

// ---------- экран выбора ----------
function heroBtns(side) {
  return Object.entries(CHARS).map(([id, c]) => `<button class="hero" data-side="${side}" data-hero="${id}" aria-pressed="${prefs['p' + (side + 1)] === id}"><img src="${ICON}heroes/${c.card}" alt=""><span>${c.name}</span></button>`).join('');
}
const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-set="${key}" data-v="${v}" aria-pressed="${prefs[key] === v}">${l}</button>`).join('')}</div>`;
function showSelect() {
  music('menu'); duck(false);
  screen = 'select'; G = null; attract = null; $('hud').hidden = true; msg('');
  $('trainbar').hidden = true; $('tinfo').hidden = true;
  menu(`<div class="panel"><h2>Подвальный бой</h2>
    <div class="picks"><div class="pick"><h3>Игрок 1</h3><div class="heroes">${heroBtns(0)}</div></div>
    <div class="pick"><h3>${{ cpu: 'Компьютер', pvp: 'Игрок 2', train: 'Манекен' }[prefs.mode]}</h3><div class="heroes">${heroBtns(1)}</div></div></div>
    <div class="opts">${seg('mode', [['cpu', 'Против компьютера'], ['pvp', 'Два игрока'], ['train', 'Тренировка']])}${prefs.mode === 'cpu' ? seg('level', [['easy', 'Легко'], ['normal', 'Нормально'], ['hard', 'Сложно']]) : ''}</div>
    <button class="btn" data-act="start">${prefs.mode === 'train' ? 'На тренировку' : 'В бой'}</button>
    <div class="hint">${prefs.mode === 'train' ? 'Манекен не атакует, таймер стоит, здоровье восстанавливается. Настройки — под экраном.' : prefs.mode === 'pvp' ? 'Игрок 2: стрелки, <kbd>,</kbd> рука, <kbd>.</kbd> нога, <kbd>/</kbd> блок — или второй геймпад.' : 'Enter — начать. Одинаковые герои — второй в другой раскраске.'}</div></div>`);
  renderMoves();
}
function menu(html) { const m = $('menu'); m.innerHTML = html; m.classList.toggle('on', !!html); }
$('menu').addEventListener('click', (e) => {
  const h = e.target.closest('[data-hero]');
  audio();
  if (h) { prefs['p' + (+h.dataset.side + 1)] = h.dataset.hero; save(); showSelect(); sfx('ui'); return; }
  const s = e.target.closest('[data-set]');
  if (s) { prefs[s.dataset.set] = s.dataset.v; save(); showSelect(); sfx('ui'); return; }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  sfx(a.dataset.act === 'start' || a.dataset.act === 'rematch' ? 'uiGo' : 'ui');
  ({ start, rematch: start, resume: () => pause(false), select: showSelect })[a.dataset.act]?.();
});

// ---------- бой ----------
function start() {
  screen = 'fight'; menu(''); paused = false; music('fight', true); duck(false);
  const train = prefs.mode === 'train';
  G = new Game(prefs.p1, prefs.p2, { training: train, immortal: prefs.immortal, meter: prefs.meter });
  ai = prefs.mode === 'cpu' ? makeAI(prefs.level) : train ? dummy : null;
  setSolo(prefs.mode !== 'pvp');
  $('trainbar').hidden = !train; $('tinfo').hidden = !train; resetInfo(); trainBar();
  $('hud').hidden = false;
  for (const f of G.f) {
    $('ava' + f.side).style.backgroundImage = `url("${ICON}heroes/${f.ch.small}")`;
    $('ava' + f.side).style.filter = f.col === f.ch.alt ? 'hue-rotate(180deg)' : '';
    $('nm' + f.side).textContent = f.ch.name;
  }
  renderMoves();
}
function pause(on) {
  if (screen !== 'fight' || !G || G.phase === 'over') return;
  paused = on; duck(on);
  menu(on ? `<div class="panel stack"><h2>Пауза</h2><button class="btn" data-act="resume">Продолжить</button><button class="btn ghost" data-act="rematch">Заново</button><button class="btn ghost" data-act="select">Сменить бойцов</button></div>` : '');
}

let msgT = 0;
function msg(text, sub = '', ms = 1200) {
  const m = $('msg'); clearTimeout(msgT);
  m.classList.remove('show'); void m.offsetWidth;
  if (!text) { m.innerHTML = ''; return; }
  m.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`; m.classList.add('show');
  if (ms) msgT = setTimeout(() => m.classList.remove('show'), ms);
}
const plural = (n) => n % 10 === 1 && n % 100 !== 11 ? 'удар' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'удара' : 'ударов';
function combo(side, html) { const c = $('cb' + side); c.classList.remove('show'); void c.offsetWidth; c.innerHTML = html; c.classList.add('show'); }

function handle(e) {
  switch (e.type) {
    case 'sfx': sfx(e.s, e); break;
    case 'round': $('rl').textContent = 'Раунд ' + e.n; msg('Раунд ' + e.n, '', 1100); duck(false); if (!G.opts.training) { sfx('gong'); say('v_round' + e.n, 'Раунд ' + (ROUND_WORD[e.n - 1] || e.n)); } break;
    case 'fight': msg('Бой!', '', 700); if (!G.opts.training) { sfx('go'); say('v_fight', 'Бой!'); } break;
    case 'ko': msg('Нокаут', '', 1500); duck(true); say('v_ko', 'Нокаут!'); break;
    case 'timeup': msg('Время!', '', 1500); duck(true); sfx('gong'); say('v_time', 'Время!'); break;
    case 'result': msg(e.side === null ? 'Ничья' : G.f[e.side].ch.name + ' побеждает', e.flawless ? 'Без единой царапины' : '', 1700);
      if (e.side === null) say('v_draw', 'Ничья'); else say(e.flawless ? 'v_flawless' : 'v_win_' + G.f[e.side].id, SAY_NAME[G.f[e.side].id] + ' побеждает' + (e.flawless ? '. Безупречно!' : '')); break;
    case 'combo': combo(e.side, `<em>${e.n}</em> ${plural(e.n)}`); sfx('combo', e); break;
    case 'special': combo(e.side, e.name); break;
    case 'ult': msg(e.name, '', 900); sfx('ult'); break;
    case 'heal': sfx('heal'); break;
    case 'match':
      music(null); sfx(prefs.mode === 'cpu' && e.side === 1 ? 'lose' : 'win');
      setTimeout(() => {
        const w = G.f[e.side];
        msg('');
        menu(`<div class="panel stack"><h2>${w.ch.name} — победа</h2><p class="hint">${prefs.mode === 'cpu' ? (e.side === 0 ? 'Компьютер повержен.' : 'Компьютер оказался сильнее.') : `Игрок ${e.side + 1} выиграл матч.`}</p><button class="btn" data-act="rematch">Реванш</button><button class="btn ghost" data-act="select">Сменить бойцов</button></div>`);
      }, 1400);
      break;
  }
}

// ---------- тренировка ----------
// Манекен: стоит, блокирует, сидит или прыгает — сам не атакует.
const DUMMY = { stand: {}, block: { blk: true }, cblock: { blk: true, d: true }, crouch: { d: true }, jump: { u: true } };
let jumpT = 0;
function dummy() {
  if (prefs.dummy !== 'jump') return { ...DUMMY[prefs.dummy] };
  jumpT = (jumpT + 1) % 50; return jumpT < 3 ? { u: true } : {};
}
const T = { last: 0, total: 0, hits: 0, at: -999, move: '' };
function resetInfo() { Object.assign(T, { last: 0, total: 0, hits: 0, at: -999, move: '' }); }
const MOVE_NAMES = { p: 'Рука', k: 'Нога', fp: 'Выпад', fk: 'Низкий удар с шагом', up: 'Апперкот', sweep: 'Подсечка', round: 'Удар с разворота', jp: 'Рука в прыжке', jk: 'Нога в прыжке' };
function moveName(n) { return MOVE_NAMES[n] || Object.values(SPECIALS).flat().find((s) => s.id === n)?.name || n; }
const fmt = (n) => (Math.round(n * 10) / 10).toString().replace('.', ',');
function trainEvent(e) {
  if (!G?.opts.training) return;
  if (e.type === 'dmg' && e.side === 1) {
    if (G.frame - T.at > 60) { T.total = 0; T.hits = 0; }
    T.last = e.n; T.total += e.n; T.hits++; T.at = G.frame;
  }
  if (e.type === 'move' && e.side === 0) T.move = `${moveName(e.name)}: замах ${e.s} · удар ${e.a} · возврат ${e.r} кадров${e.dmg ? ` · урон ${fmt(e.dmg)}` : ''}`;
  $('tinfo').innerHTML = `<b>Урон</b> ${fmt(T.last)} · <b>серия</b> ${T.hits} ${plural(T.hits)}, ${fmt(T.total)} урона<br>${T.move || 'Нажмите удар — здесь появятся тайминги'}`;
}
const TSEG = (key, opts) => `<span class="seg">${opts.map(([v, l]) => `<button data-tset="${key}" data-v="${v}" aria-pressed="${String(prefs[key]) === v}">${l}</button>`).join('')}</span>`;
function trainBar() {
  $('trainbar').innerHTML = `<label>Манекен ${TSEG('dummy', [['stand', 'Стоит'], ['block', 'Блок'], ['cblock', 'Блок снизу'], ['crouch', 'Сидит'], ['jump', 'Прыгает']])}</label>
    <label>Смерть ${TSEG('immortal', [['true', 'Выкл'], ['false', 'Вкл']])}</label>
    <label>Шкала ульты ${TSEG('meter', [['false', 'Обычная'], ['true', 'Всегда полная']])}</label>
    <button class="tool" data-tact="reset">Сброс позиций <kbd>R</kbd></button>`;
}
$('trainbar').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  b.blur(); // иначе Пробел (блок) нажмёт кнопку
  if (b.dataset.tact === 'reset') { resetPositions(); return; }
  const k = b.dataset.tset; if (!k) return;
  const v = b.dataset.v; prefs[k] = v === 'true' ? true : v === 'false' ? false : v; save();
  if (G) { G.opts.immortal = prefs.immortal; G.opts.meter = prefs.meter; }
  trainBar();
});
function resetPositions() { if (G?.opts.training) { G.newRound(); resetInfo(); trainEvent({}); } }

function hud() {
  if (!G) return;
  for (const f of G.f) {
    $('hp' + f.side).style.width = f.hp + '%';
    $('lag' + f.side).style.width = f.lagHp + '%';
    $('mb' + f.side).style.width = f.meter + '%';
    $('mt' + f.side).classList.toggle('full', f.meter >= 100);
    const pips = $('pip' + f.side), want = '<span' + (f.wins > 0 ? ' class="on"' : '') + '></span><span' + (f.wins > 1 ? ' class="on"' : '') + '></span>';
    if (pips.innerHTML !== want) pips.innerHTML = want;
  }
  const t = String(Math.ceil(G.timer / 60));
  const tt = G.opts.training ? '∞' : t;
  if ($('timer').textContent !== tt) { $('timer').textContent = tt; if (+tt <= 10 && +tt > 0 && G.phase === 'fight') sfx('tick'); } // последние 10 секунд тикают
}

// ---------- цикл ----------
const STEP = 1000 / 60;
let attract = null;
function loop(ts) {
  requestAnimationFrame(loop);
  const dt = Math.min(100, ts - last); last = ts;
  if (screen === 'select') {
    // на экране выбора за меню идёт демо-бой компьютеров
    if (!attract) { attract = new Game(prefs.p1, prefs.p2); attract.ais = [makeAI('normal'), makeAI('normal')]; attract.phase = 'fight'; }
    acc += dt;
    while (acc >= STEP) { attract.update([attract.ais[0](attract, attract.f[0]), attract.ais[1](attract, attract.f[1])]); attract.events.length = 0; acc -= STEP; if (attract.phase === 'over') attract = null; if (!attract) break; }
    if (attract) render(g, attract);
    return;
  }
  attract = null;
  if (G && !paused) {
    acc += dt;
    while (acc >= STEP) {
      const inputs = [readInput(0), ai ? ai(G, G.f[1]) : readInput(1)];
      const frozen = G.stop > 0; // во время паузы от удара движок ввод не читает — короткое нажатие придержим до её конца
      G.update(inputs);
      if (!frozen) endFrame();
      for (const e of G.events) { handle(e); trainEvent(e); }
      G.events.length = 0;
      acc -= STEP;
    }
  } else acc = 0;
  if (G) { render(g, G, { debug }); hud(); }
}

// ---------- список приёмов ----------
const ARROW = { F: '→', B: '←', D: '↓', U: '↑' };
// На сенсорном экране клавиш нет — в списке приёмов показываем названия кнопок.
const TOUCH = window.matchMedia?.('(pointer: coarse)').matches;
const BTN_NAME = { p: 'Рука', k: 'Нога', blk: 'Блок' };
function keyFor(b) { return `<kbd>${TOUCH ? BTN_NAME[b] : KEYCAP[0][b]}</kbd>`; }
const named = (b) => (TOUCH ? keyFor(b) : `${keyFor(b)} ${BTN_NAME[b]}`);
function renderMoves() {
  const ids = [...new Set([prefs.p1, prefs.p2])];
  const base = `<div class="mcol"><h3>Базовые удары</h3><dl class="base">
    <dt>${named('p')}</dt><dd>Быстрый удар рукой.</dd>
    <dt>${named('k')}</dt><dd>Удар ногой: медленнее, но достаёт дальше.</dd>
    <dt>→ + ${keyFor('p')}</dt><dd>Выпад: удар рукой с шагом вперёд — так сближаются.</dd>
    <dt>→ + ${keyFor('k')}</dt><dd>Низкий удар с шагом вперёд. Держит только блок в приседе.</dd>
    <dt>↓ + ${keyFor('p')}</dt><dd>Апперкот — сбивает с ног.</dd>
    <dt>↓ + ${keyFor('k')}</dt><dd>Подсечка — низкая, сбивает с ног.</dd>
    <dt>← + ${keyFor('k')}</dt><dd>Удар с разворота — медленный и сильный, сбивает с ног.</dd>
    <dt>В прыжке</dt><dd>Рука или нога сверху — держит только стоячий блок.</dd>
    <dt>Серия</dt><dd>Удар попал — сразу жми следующий, более тяжёлый: ${keyFor('p')} → ${keyFor('k')} → удар с направлением → спецприём. Каждый следующий удар серии слабее.</dd>
    <dt>→ → / ← ←</dt><dd>Двойное нажатие: рывок к сопернику или отскок назад (в начале отскока неуязвим). Из рывка можно сразу ударить.</dd>
    <dt>${named('blk')}</dt><dd>С ↓ — блок в приседе. Спецприёмы через блок снимают немного здоровья.</dd>
    </dl><p class="hint">→ — к сопернику, ← — от него. Шкала под здоровьем копится от ударов; полная открывает ульту.</p></div>`;
  const col = (id) => `<div class="mcol"><h3><img src="${ICON}heroes/${CHARS[id].small}" alt="">${CHARS[id].name}</h3>${SPECIALS[id].map((s) => `
    <div class="mrow"><img src="${ICON}abilities/${s.icon}" alt=""><b>${s.name}${s.ult ? '<span class="ult">ульта</span>' : ''}<small>${s.desc}</small></b>
    <span class="in">${s.hold ? 'в прыжке ↓' : s.seq.map((k) => ARROW[k]).join(' ')} + ${keyFor(s.btn)}</span></div>`).join('')}</div>`;
  $('moves').innerHTML = base + ids.map(col).join('');
}

// ---------- кнопки и клавиши ----------
initInput();
bindTouch($('touch'));
// переключатели звука: всё, музыка, диктор
for (const [id, key, label] of [['snd', 'sound', 'Звук'], ['mus', 'music', 'Музыка'], ['voc', 'voice', 'Диктор']]) {
  const show = () => { $(id).textContent = `${label}: ${prefs[key] ? 'вкл' : 'выкл'}`; };
  show();
  $(id).addEventListener('click', () => { prefs[key] = !prefs[key]; save(); show(); audio(); applySound(); sfx('ui'); });
}
applySound();
window.addEventListener('pointerdown', audio, { once: true });
$('dbg').addEventListener('click', () => { debug = !debug; $('dbg').classList.toggle('on', debug); });
window.addEventListener('keydown', (e) => {
  audio();
  if (e.code === 'Escape' || e.code === 'KeyP') { if (screen === 'fight' && G?.phase !== 'over') pause(!paused); }
  if (e.code === 'KeyR' && screen === 'fight' && !paused) resetPositions();
  if (e.code === 'Enter') {
    if (screen === 'select') start();
    else if (G?.phase === 'over' && $('menu').classList.contains('on')) start();
  }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && screen === 'fight') pause(true); });
showSelect();
requestAnimationFrame(loop);
