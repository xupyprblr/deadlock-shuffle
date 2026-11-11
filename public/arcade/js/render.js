// Отрисовка: нарисованные части бойцов (ref2game) по костям движка, фон слоями, эффекты.
// Логические координаты — 384×216; холст в SC раз больше, пиксели арта не сглаживаются.
import { W, H, FLOOR, HB } from './data.js';
import { RIGS } from './rigs.js';
import { HOOK_EXT } from './engine.js';

export const SC = 3;
// Камера: приближение и слежение за бойцами, как в аркадных файтингах.
export const ZOOM = 1.3;
const VW = W / ZOOM, VH = H / ZOOM;
const cams = new WeakMap();
const TAU = Math.PI * 2, D2R = Math.PI / 180;
const FAR = [0.62, 0.62, 0.72];
const STAGE = ['bg_sky', 'bg_alley', 'bg_floor', 'bg_fg'];
// Тёплые огни на фоне (фонари, окна) и свечи на переднем плане: x, y, сила — из разметки фона.
const LAMPS = [[331, 7, 25], [324, 10, 23], [45, 57, 101], [53, 57, 70], [271, 55, 60], [240, 51, 31], [351, 89, 41], [343, 116, 135], [367, 120, 152], [301, 116, 116], [327, 120, 106], [204, 120, 221], [263, 52, 41], [117, 56, 49], [170, 64, 47], [279, 74, 38], [204, 83, 37], [330, 85, 39], [241, 85, 43], [146, 87, 40]];
const CANDLES = [[18, 180, 153], [373, 186, 156], [362, 185, 11], [32, 186, 10], [362, 192, 63], [35, 199, 147], [348, 201, 102], [22, 202, 36], [69, 201, 35], [338, 202, 43]];

// ---------- загрузка арта ----------
const IMG = {};
const ART = {}; // варианты частей: обычная, дальняя (темнее), альтернативная раскраска
let stageCanvas = null;
export let artReady = false;

function load(src) {
  return new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
}
function variant(img, tint, alt) {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  if (!tint && !alt) return c;
  const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    let r = p[i], gg = p[i + 1], b = p[i + 2];
    if (alt === 'swap' || (alt === 'blue' && b > r + 20)) [r, b] = [b, r];
    if (tint) { r *= tint[0]; gg *= tint[1]; b *= tint[2]; }
    p[i] = r; p[i + 1] = gg; p[i + 2] = b;
  }
  g.putImageData(d, 0, 0);
  return c;
}
// Альтернативная раскраска для зеркального матча: Bebop — синий, у Lash красная майка.
const ALT = { bebop: 'swap', lash: 'blue' };

export async function loadArt(base = '') {
  const jobs = [];
  for (const [id, R] of Object.entries(RIGS)) for (const [name, p] of Object.entries(R.parts)) {
    jobs.push(load(base + p.file).then((i) => { IMG[id + ':' + name] = i; }));
  }
  for (const n of STAGE) jobs.push(load(base + 'img/stage/' + n + '.png').then((i) => { IMG[n] = i; }));
  await Promise.all(jobs);
  for (const id of Object.keys(RIGS)) for (const name of Object.keys(RIGS[id].parts)) {
    const i = IMG[id + ':' + name];
    ART[`${id}:${name}:0:0`] = variant(i);
    ART[`${id}:${name}:0:1`] = variant(i, FAR);
    ART[`${id}:${name}:1:0`] = variant(i, null, ALT[id]);
    ART[`${id}:${name}:1:1`] = variant(i, FAR, ALT[id]);
  }
  stageCanvas = document.createElement('canvas'); stageCanvas.width = W; stageCanvas.height = H;
  const g = stageCanvas.getContext('2d');
  g.drawImage(IMG.bg_sky, 0, 0); g.drawImage(IMG.bg_alley, 0, 0); g.drawImage(IMG.bg_floor, 0, FLOOR);
  artReady = true;
}

// ---------- бойцы ----------
function drawFighter(g, f, t) {
  const R = RIGS[f.id], j = f.rig, P = f.pose, r = P.rot || 0, alt = f.col === f.ch.alt ? 1 : 0;
  // тень, сжимается с высотой
  const air = Math.max(0, FLOOR - f.y);
  g.fillStyle = `rgba(0,0,0,${0.45 * (1 - Math.min(0.7, air / 70))})`;
  g.beginPath(); g.ellipse(f.x, FLOOR + 1, (14 + (Math.abs(r) > 40 ? 12 : 0)) * (1 - Math.min(0.6, air / 90)), 2.4, 0, 0, TAU); g.fill();
  g.save();
  g.translate(f.x, 0); g.scale(f.face, 1);
  if (f.inv > 0 && (t >> 1) % 2) g.globalAlpha = 0.55;
  const lx = (q) => (q.x - f.x) * f.face;
  const img = (name, far) => ART[`${f.id}:${name}:${alt}:${far ? 1 : 0}`];
  const part = (name, J, theta, far) => {
    const p = R.parts[name], im = img(name, far); if (!im) return;
    g.save(); g.translate(lx(J), J.y); g.rotate(theta * D2R); g.drawImage(im, -p.pivot[0], -p.pivot[1]); g.restore();
  };
  // круглый сустав: диск из текстуры верхнего сегмента вокруг его конца, если сустав заметно согнут
  const cap = (upper, J, theta, rad, far) => {
    const p = R.parts[upper], im = img(upper, far); if (!im || !rad) return;
    g.save(); g.translate(lx(J), J.y); g.rotate(theta * D2R);
    g.beginPath(); g.arc(0, 0, rad, 0, TAU); g.clip(); g.drawImage(im, -p.end[0], -p.end[1]); g.restore();
  };
  const limbT = (name, a) => (R.parts[name].rest || 0) - a;
  const jc = R.jointCaps;
  for (const n of R.drawOrder) {
    const side = n.slice(-1), far = side === 'B';
    switch (n) {
      case 'farmB': case 'farmF': part(n, j['e' + side], limbT(n, P['f' + side] - r), far); break;
      case 'uarmB': case 'uarmF': {
        const th = limbT(n, P['a' + side] - r);
        part(n, side === 'F' ? j.sh : j.shB, th, far);
        if (Math.abs(P['f' + side] - P['a' + side]) > 15) cap(n, j['e' + side], th, jc['elbow' + side], far);
        if (n === 'uarmB' && f.id === 'bebop') drawClaw(g, f, j, lx, part);
        break;
      }
      case 'footB': case 'footF': part('foot', j['an' + side], (R.parts.foot.rest || 0) - j['foot' + side], far); break;
      case 'shinB': case 'shinF': part('shin', j['k' + side], limbT('shin', P['s' + side] - r), far); break;
      case 'thighB': case 'thighF': {
        const th = limbT('thigh', P['t' + side] - r);
        part('thigh', j['hip' + side], th, far);
        if (Math.abs(P['t' + side] - P['s' + side]) > 15) cap('thigh', j['k' + side], th, jc.knee, far);
        break;
      }
      case 'torso': part('torso', j.hip, j.la); break;
      case 'pauldF': { // наплечник сидит на корпусе и лишь слегка идёт за рукой
        const q = R.pauld, p = R.parts.pauldF, im = img(n, false); if (!im) break;
        g.save(); g.translate(lx(j.hip), j.hip.y); g.rotate(j.la * D2R); g.translate(q.at[0], q.at[1]);
        g.rotate((q.tilt - q.follow * (Math.max(-40, Math.min(180, P.aF)) - q.ref)) * D2R); g.drawImage(im, -p.pivot[0], -p.pivot[1]); g.restore();
        break;
      }
      case 'head': part('head', j.neck, j.ha); break;
    }
  }
  g.restore();
  if (f.whip) drawWhip(g, f);
  if (f.beam) drawBeam(g, f, t);
  if (f.st === 'dizzy' && f.stun < 900) for (let i = 0; i < 3; i++) { const a = t / 8 + i * TAU / 3; dot(g, { x: j.hd.x + Math.cos(a) * 9, y: j.hd.y - 10 + Math.sin(a) * 3 }, 1.5, '#ffe14d'); }
}

// Рука-захват Bebop: клешня вылетает с дальней руки на тросе (в координатах бойца, лицом вправо).
function drawClaw(g, f, j, lx, part) {
  if (f.st !== 'atk' || f.mn !== 'hook') return;
  const m = f.mv, k = f.mf - m.s, hand = { x: j.hnB.x, y: j.hnB.y };
  const reach = Math.max(0, f.reach || 0);
  if (reach > 1) {
    g.fillStyle = '#1a1210'; g.fillRect(lx(hand), hand.y - 0.5, reach, 1);
  }
  const at = { x: f.x + (lx(hand) + reach) * f.face, y: hand.y };
  part(k >= 0 && k < HOOK_EXT ? 'claw_open' : 'claw_closed', at, 0, false);
}

function drawWhip(g, f) {
  const h = f.rig.hnF;
  g.strokeStyle = '#3a2412'; g.lineWidth = 1.6; g.lineCap = 'round';
  g.beginPath(); g.moveTo(h.x, h.y);
  g.quadraticCurveTo((h.x + f.whip.tx) / 2, Math.min(h.y, f.whip.ty) - 16, f.whip.tx, f.whip.ty); g.stroke();
  g.strokeStyle = '#7a5230'; g.lineWidth = 0.6; g.stroke();
}

function drawBeam(g, f, t) {
  const h = f.rig.hnF, x0 = h.x, y = h.y, x1 = f.face > 0 ? W + 10 : -10;
  const w = 16 + Math.sin(t) * 3, xa = Math.min(x0, x1), len = Math.abs(x1 - x0);
  g.save(); g.globalCompositeOperation = 'lighter';
  g.fillStyle = 'rgba(60,170,200,.35)'; g.fillRect(xa, y - w / 2 - 5, len, w + 10);
  g.fillStyle = 'rgba(140,235,255,.75)'; g.fillRect(xa, y - w / 2, len, w);
  g.restore();
  g.fillStyle = '#f4ffff'; g.fillRect(xa, y - 3, len, 6);
  dot(g, { x: x0, y }, 11 + Math.sin(t * 1.3) * 2, 'rgba(220,255,255,.9)');
}

function dot(g, p, r, c) { g.fillStyle = c; g.beginPath(); g.arc(p.x, p.y, r, 0, TAU); g.fill(); }
function glow(g, x, y, r, rgb, a) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
}

// ---------- кадр ----------
export function render(g, G, opts = {}) {
  const t = G.frame;
  g.setTransform(SC, 0, 0, SC, 0, 0);
  g.imageSmoothingEnabled = false;
  if (!artReady) { g.fillStyle = '#100e0e'; g.fillRect(0, 0, W, H); return; }
  // камера: центр между бойцами, пол у нижнего края, поднимается за высоко подброшенным
  const [a, b] = G.f;
  const top = Math.min(a.rig.hd.y, b.rig.hd.y) - 14;
  const want = { x: Math.max(0, Math.min(W - VW, (a.x + b.x) / 2 - VW / 2)), y: Math.max(0, Math.min(H - VH, Math.min(H - VH, top))) };
  let cam = cams.get(G);
  if (!cam) { cam = { ...want }; cams.set(G, cam); }
  cam.x += (want.x - cam.x) * 0.18; cam.y += (want.y - cam.y) * 0.12;
  const cx = Math.round(cam.x * SC * ZOOM) / (SC * ZOOM), cy = Math.round(cam.y * SC * ZOOM) / (SC * ZOOM);
  g.setTransform(SC * ZOOM, 0, 0, SC * ZOOM, -cx * SC * ZOOM, -cy * SC * ZOOM);
  g.save();
  if (G.shake) g.translate(Math.round((Math.random() - 0.5) * G.shake), Math.round((Math.random() - 0.5) * G.shake));
  g.drawImage(stageCanvas, 0, 0);
  g.save(); g.globalCompositeOperation = 'lighter';
  for (const [x, y, n] of LAMPS) glow(g, x, y, 5 + Math.sqrt(n) * 1.4, '255,184,97', 0.09 + 0.03 * Math.sin(t / 26 + x));
  g.restore();
  // атакующий рисуется поверх
  const order = [...G.f].sort((a, b) => (a.st === 'atk' || a.st === 'ult') - (b.st === 'atk' || b.st === 'ult'));
  for (const f of order) drawFighter(g, f, t);
  for (const p of G.proj) {
    dot(g, p, 3.5, '#262222'); dot(g, { x: p.x - 1, y: p.y - 1 }, 1.2, '#5a5050');
    if ((t >> (p.stuck && p.fuse < 30 ? 1 : 3)) % 2) dot(g, { x: p.x + 1, y: p.y - 2 }, 1.3, '#ff3a2a');
  }
  for (const p of G.parts) {
    if (p.ring) { const k = 1 - p.life / p.max; g.strokeStyle = `rgba(255,225,77,${1 - k})`; g.lineWidth = 3 * (1 - k) + 1; g.beginPath(); g.arc(p.x, p.y, p.rad * (0.3 + k), 0, TAU); g.stroke(); dot(g, p, p.rad * 0.5 * (1 - k), `rgba(255,240,200,${0.8 * (1 - k)})`); continue; }
    g.globalAlpha = Math.min(1, p.life / 10); g.fillStyle = p.c; g.fillRect(Math.round(p.x), Math.round(p.y), p.r, p.r);
  }
  g.globalAlpha = 1;
  g.drawImage(IMG.bg_fg, 0, 0);
  g.save(); g.globalCompositeOperation = 'lighter';
  for (const [x, y, n] of CANDLES) {
    const fl = 0.75 + 0.15 * Math.sin(t * 0.15 + x * 1.7) + 0.1 * Math.sin(t * 0.23 + y);
    glow(g, x, y - 2, (5 + Math.sqrt(n) * 0.9) * fl, '255,158,64', 0.28 * fl);
  }
  g.restore();
  if (opts.debug) for (const f of G.f) {
    const b = f.rig.box; g.strokeStyle = '#0f0'; g.lineWidth = 0.6; g.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    const m = f.mv;
    if (f.st === 'atk' && m) {
      const hb = m.box ? m.box(f) : HB[f.id]?.[f.mn] || m.hb;
      if (hb && f.mf >= m.s && f.mf < m.s + m.a) { const x0 = f.face > 0 ? f.x + hb.x : f.x - hb.x - hb.w; g.strokeStyle = '#f00'; g.strokeRect(x0, f.y + hb.y, hb.w, hb.h); }
    }
  }
  g.restore();
  if (G.flash) { g.fillStyle = `rgba(255,255,255,${G.flash / 28})`; g.fillRect(0, 0, W, H); }
  g.setTransform(SC, 0, 0, SC, 0, 0);
}
