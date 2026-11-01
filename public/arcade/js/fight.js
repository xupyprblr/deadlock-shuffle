// «Подвальный бой»: экран выбора, игровой цикл 60 кадров/с, интерфейс поверх холста, звук.
import { CHARS, SPECIALS } from './data.js';
import { Game } from './engine.js';
import { render, makeStage } from './render.js';
import { initInput, readInput, bindTouch, setSolo, KEYCAP } from './input.js';
import { makeAI } from './ai.js';
import { markDev, NS } from '../../js/env.js';

markDev();
const $ = (id) => document.getElementById(id);
const cv = $('cv'), g = cv.getContext('2d');
g.imageSmoothingEnabled = false;
const stage = makeStage();
const ICON = '../icons/images/';
const KEY = NS + 'arcade:fight';

const prefs = (() => { try { return { p1: 'bebop', p2: 'lash', mode: 'cpu', level: 'normal', sound: true, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { p1: 'bebop', p2: 'lash', mode: 'cpu', level: 'normal', sound: true }; } })();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {} };

let G = null, ai = null, paused = false, debug = false, acc = 0, last = 0, screen = 'select';

// ---------- звук: синтез, без файлов ----------
let AC = null, noiseBuf = null;
function audio() {
  if (!prefs.sound) return null;
  if (!AC) {
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
function tone(f0, dur, type = 'square', vol = 0.08, f1 = f0) {
  const a = audio(); if (!a) return;
  const o = a.createOscillator(), v = a.createGain(), t = a.currentTime;
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  v.gain.setValueAtTime(vol, t); v.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(v).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol = 0.2, freq = 1200, type = 'lowpass') {
  const a = audio(); if (!a) return;
  const s = a.createBufferSource(), f = a.createBiquadFilter(), v = a.createGain(), t = a.currentTime;
  s.buffer = noiseBuf; f.type = type; f.frequency.value = freq;
  v.gain.setValueAtTime(vol, t); v.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(v).connect(a.destination); s.start(t); s.stop(t + dur + 0.02);
}
const SFX = {
  swing: () => noise(0.07, 0.07, 2500, 'highpass'),
  special: () => tone(520, 0.07, 'square', 0.04),
  hit: () => { noise(0.08, 0.25, 900); tone(140, 0.08, 'square', 0.06, 70); },
  hitH: () => { noise(0.14, 0.35, 700); tone(100, 0.14, 'square', 0.08, 40); },
  block: () => { tone(900, 0.05, 'square', 0.05, 600); noise(0.04, 0.1, 3000, 'highpass'); },
  jump: () => tone(260, 0.09, 'square', 0.035, 480),
  land: () => noise(0.12, 0.2, 300),
  boom: () => { noise(0.45, 0.4, 500); tone(70, 0.35, 'sine', 0.2, 30); },
  whip: () => { noise(0.12, 0.15, 4500, 'highpass'); tone(1800, 0.08, 'sawtooth', 0.03, 400); },
  whoosh: () => noise(0.25, 0.15, 1200, 'bandpass'),
  chain: () => tone(700, 0.18, 'sawtooth', 0.04, 220),
  throw: () => tone(420, 0.1, 'triangle', 0.08, 260),
  stick: () => tone(1300, 0.05, 'square', 0.05),
  charge: () => tone(180, 0.55, 'sawtooth', 0.05, 1400),
  beam: () => { noise(1.2, 0.2, 1600, 'bandpass'); tone(110, 1.2, 'sawtooth', 0.06, 90); },
  grab: () => tone(160, 0.12, 'square', 0.08, 90),
  slam: () => { noise(0.25, 0.45, 260); tone(55, 0.25, 'sine', 0.25, 30); },
  ko: () => tone(240, 0.7, 'square', 0.1, 50),
};

// ---------- экран выбора ----------
function heroBtns(side) {
  return Object.entries(CHARS).map(([id, c]) => `<button class="hero" data-side="${side}" data-hero="${id}" aria-pressed="${prefs['p' + (side + 1)] === id}"><img src="${ICON}heroes/${c.card}" alt=""><span>${c.name}</span></button>`).join('');
}
const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-set="${key}" data-v="${v}" aria-pressed="${prefs[key] === v}">${l}</button>`).join('')}</div>`;
function showSelect() {
  screen = 'select'; G = null; attract = null; $('hud').hidden = true; msg('');
  menu(`<div class="panel"><h2>Подвальный бой</h2>
    <div class="picks"><div class="pick"><h3>Игрок 1</h3><div class="heroes">${heroBtns(0)}</div></div>
    <div class="pick"><h3>${prefs.mode === 'cpu' ? 'Компьютер' : 'Игрок 2'}</h3><div class="heroes">${heroBtns(1)}</div></div></div>
    <div class="opts">${seg('mode', [['cpu', 'Против компьютера'], ['pvp', 'Два игрока']])}${prefs.mode === 'cpu' ? seg('level', [['easy', 'Легко'], ['normal', 'Нормально'], ['hard', 'Сложно']]) : ''}</div>
    <button class="btn" data-act="start">В бой</button>
    <div class="hint">${prefs.mode === 'pvp' ? 'Игрок 2: стрелки, <kbd>,</kbd> <kbd>;</kbd> рука, <kbd>.</kbd> <kbd>\'</kbd> нога, <kbd>/</kbd> блок — или второй геймпад.' : 'Enter — начать. Одинаковые герои — второй в другой раскраске.'}</div></div>`);
  renderMoves();
}
function menu(html) { const m = $('menu'); m.innerHTML = html; m.classList.toggle('on', !!html); }
$('menu').addEventListener('click', (e) => {
  const h = e.target.closest('[data-hero]');
  if (h) { prefs['p' + (+h.dataset.side + 1)] = h.dataset.hero; save(); showSelect(); return; }
  const s = e.target.closest('[data-set]');
  if (s) { prefs[s.dataset.set] = s.dataset.v; save(); showSelect(); return; }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  audio();
  ({ start, rematch: start, resume: () => pause(false), select: showSelect })[a.dataset.act]?.();
});

// ---------- бой ----------
function start() {
  screen = 'fight'; menu(''); paused = false;
  G = new Game(prefs.p1, prefs.p2);
  ai = prefs.mode === 'cpu' ? makeAI(prefs.level) : null;
  setSolo(prefs.mode === 'cpu');
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
  paused = on;
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
const plural = (n) => n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'удара' : 'ударов';
function combo(side, html) { const c = $('cb' + side); c.classList.remove('show'); void c.offsetWidth; c.innerHTML = html; c.classList.add('show'); }

function handle(e) {
  switch (e.type) {
    case 'sfx': SFX[e.s]?.(); break;
    case 'round': $('rl').textContent = 'Раунд ' + e.n; msg('Раунд ' + e.n, '', 1100); break;
    case 'fight': msg('Бой!', '', 700); break;
    case 'ko': msg('Нокаут', '', 1500); break;
    case 'timeup': msg('Время!', '', 1500); break;
    case 'result': msg(e.side === null ? 'Ничья' : G.f[e.side].ch.name + ' побеждает', e.flawless ? 'Без единой царапины' : '', 1700); break;
    case 'combo': combo(e.side, `<em>${e.n}</em> ${plural(e.n)}`); break;
    case 'special': combo(e.side, e.name); break;
    case 'ult': msg(e.name, '', 900); break;
    case 'match':
      setTimeout(() => {
        const w = G.f[e.side];
        msg('');
        menu(`<div class="panel stack"><h2>${w.ch.name} — победа</h2><p class="hint">${prefs.mode === 'cpu' ? (e.side === 0 ? 'Компьютер повержен.' : 'Компьютер оказался сильнее.') : `Игрок ${e.side + 1} выиграл матч.`}</p><button class="btn" data-act="rematch">Реванш</button><button class="btn ghost" data-act="select">Сменить бойцов</button></div>`);
      }, 1400);
      break;
  }
}

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
  if ($('timer').textContent !== t) $('timer').textContent = t;
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
    if (attract) render(g, attract, stage);
    return;
  }
  attract = null;
  if (G && !paused) {
    acc += dt;
    while (acc >= STEP) {
      const inputs = [readInput(0), ai ? ai(G, G.f[1]) : readInput(1)];
      G.update(inputs);
      for (const e of G.events) handle(e);
      G.events.length = 0;
      acc -= STEP;
    }
  } else acc = 0;
  if (G) { render(g, G, stage, { debug }); hud(); }
}

// ---------- список приёмов ----------
const ARROW = { F: '→', B: '←', D: '↓', U: '↑' };
const BTN_NAME = { lp: 'Н. рука', hp: 'В. рука', lk: 'Н. нога', hk: 'В. нога' };
function keyFor(b) { return `<kbd>${KEYCAP[0][b]}</kbd>`; }
function renderMoves() {
  const ids = [...new Set([prefs.p1, prefs.p2])];
  const base = `<div class="mcol"><h3>Базовые удары</h3><dl class="base">
    <dt>${keyFor('lp')} ${keyFor('hp')}</dt><dd>Нижний и верхний удар рукой. Верхний проходит над присевшим.</dd>
    <dt>${keyFor('lk')} ${keyFor('hk')}</dt><dd>Нижний и верхний удар ногой.</dd>
    <dt>↓ + ${keyFor('hp')}</dt><dd>Апперкот — сбивает с ног.</dd>
    <dt>↓ + ${keyFor('lp')} / ${keyFor('lk')} / ${keyFor('hk')}</dt><dd>Удары из приседа. Ногами — низкие, их держит только блок в приседе.</dd>
    <dt>← + ${keyFor('lk')}</dt><dd>Подсечка.</dd>
    <dt>← + ${keyFor('hk')}</dt><dd>Удар с разворота — сбивает с ног.</dd>
    <dt>В прыжке</dt><dd>Рука или нога сверху — держит только стоячий блок.</dd>
    <dt>${keyFor('blk')}</dt><dd>Блок; с ↓ — блок в приседе. Спецприёмы через блок снимают немного здоровья.</dd>
    </dl><p class="hint">→ — к сопернику, ← — от него. Шкала под здоровьем копится от ударов; полная открывает ульту.</p></div>`;
  const col = (id) => `<div class="mcol"><h3><img src="${ICON}heroes/${CHARS[id].small}" alt="">${CHARS[id].name}</h3>${SPECIALS[id].map((s) => `
    <div class="mrow"><img src="${ICON}abilities/${s.icon}" alt=""><b>${s.name}${s.ult ? '<span class="ult">ульта</span>' : ''}<small>${s.desc}</small></b>
    <span class="in">${s.hold ? 'прыжок, ↓' : s.seq.map((k) => ARROW[k]).join(' ')} + ${keyFor(s.btn)}</span></div>`).join('')}</div>`;
  $('moves').innerHTML = base + ids.map(col).join('');
}

// ---------- кнопки и клавиши ----------
initInput();
bindTouch($('touch'));
$('snd').textContent = 'Звук: ' + (prefs.sound ? 'вкл' : 'выкл');
$('snd').addEventListener('click', () => { prefs.sound = !prefs.sound; save(); $('snd').textContent = 'Звук: ' + (prefs.sound ? 'вкл' : 'выкл'); });
$('dbg').addEventListener('click', () => { debug = !debug; $('dbg').classList.toggle('on', debug); });
window.addEventListener('keydown', (e) => {
  audio();
  if (e.code === 'Escape' || e.code === 'KeyP') { if (screen === 'fight' && G?.phase !== 'over') pause(!paused); }
  if (e.code === 'Enter') {
    if (screen === 'select') start();
    else if (G?.phase === 'over' && $('menu').classList.contains('on')) start();
  }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && screen === 'fight') pause(true); });
showSelect();
requestAnimationFrame(loop);
