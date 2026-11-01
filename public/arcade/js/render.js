// Отрисовка на маленьком холсте 384×216, который растягивается без сглаживания — пиксельный вид.
// Пока это «манекены» из примитивов: позы и тайминги проверяем на них, потом заменим спрайтами.
import { W, H, FLOOR } from './data.js';

const TAU = Math.PI * 2;

export function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

// ---------- сцена: переулок Нью-Йорка-призрака, фонари, мокрая брусчатка ----------
export function makeStage() {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const sky = g.createLinearGradient(0, 0, 0, FLOOR);
  sky.addColorStop(0, '#0b1414'); sky.addColorStop(0.55, '#16231f'); sky.addColorStop(1, '#2a2a1e');
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  // дальняя башня с окнами
  g.fillStyle = '#1e2420'; g.fillRect(160, 20, 64, 150);
  g.beginPath(); g.moveTo(156, 22); g.lineTo(192, 0); g.lineTo(228, 22); g.fill();
  for (let r = 0; r < 4; r++) for (let i = 0; i < 3; i++) {
    const x = 168 + i * 18, y = 40 + r * 28;
    g.fillStyle = rnd() < 0.7 ? '#e8a84a' : '#3a3a2a'; g.fillRect(x, y + 4, 8, 14);
    g.beginPath(); g.arc(x + 4, y + 4, 4, Math.PI, 0); g.fill();
  }
  // здания по бокам — перспектива переулка
  const side = (x0, x1, dir) => {
    for (let i = 0; i < 4; i++) {
      const xa = x0 + (x1 - x0) * i / 4, xb = x0 + (x1 - x0) * (i + 1) / 4;
      const top = 10 + i * 12 + rnd() * 10;
      g.fillStyle = shade(i % 2 ? '#2a2620' : '#231f1b', 1 - i * 0.08);
      g.fillRect(Math.min(xa, xb), top, Math.abs(xb - xa), FLOOR - top);
      for (let y = top + 8; y < FLOOR - 40; y += 18) for (let x = Math.min(xa, xb) + 5; x < Math.max(xa, xb) - 8; x += 13) {
        g.fillStyle = rnd() < 0.25 ? '#f0b45a' : '#141210'; g.fillRect(x, y, 6, 9);
      }
    }
    // балкон-галерея
    g.strokeStyle = '#0d0c0b'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x0, 92); g.lineTo(x1, 104); g.stroke();
    for (let x = Math.min(x0, x1); x < Math.max(x0, x1); x += 5) { g.beginPath(); g.moveTo(x, 92 + (x - x0) / (x1 - x0) * 12); g.lineTo(x, 104 + (x - x0) / (x1 - x0) * 12); g.lineWidth = 1; g.stroke(); }
  };
  side(0, 150, 1); side(W, 236, -1);
  // вывеска лавки
  g.fillStyle = '#20302c'; g.fillRect(286, 112, 86, 16);
  g.fillStyle = '#7fa89a'; g.font = 'bold 9px monospace'; g.fillText('3RD EYE SUPPLY', 290, 123);
  g.fillStyle = '#3a2216'; g.fillRect(290, 132, 70, 64);
  g.fillStyle = 'rgba(255,190,90,.35)'; g.fillRect(296, 138, 58, 40);
  // плакаты на левой стене
  for (let i = 0; i < 9; i++) { g.fillStyle = `rgba(200,180,140,${0.08 + rnd() * 0.1})`; g.fillRect(Math.round(10 + rnd() * 110), Math.round(124 + rnd() * 44), 7, 9); }
  // туман
  const fog = g.createLinearGradient(0, 110, 0, FLOOR);
  fog.addColorStop(0, 'rgba(120,160,140,0)'); fog.addColorStop(1, 'rgba(120,160,140,.18)');
  g.fillStyle = fog; g.fillRect(0, 110, W, FLOOR - 110);
  // брусчатка
  g.fillStyle = '#1c1a17'; g.fillRect(0, FLOOR - 8, W, H - FLOOR + 8);
  for (let row = 0; row < 6; row++) {
    const y = FLOOR - 6 + row * 5, h = 3 + row * 0.6, w = 9 + row * 2;
    for (let x = -(row % 2) * w / 2; x < W; x += w) {
      const l = 0.7 + rnd() * 0.5;
      g.fillStyle = shade('#3a352d', l); g.fillRect(Math.round(x) + 1, Math.round(y), Math.round(w) - 2, Math.round(h));
    }
  }
  // блики от фонарей на мокрых камнях
  for (const x of [118, 192, 270]) { const r = g.createRadialGradient(x, FLOOR + 6, 2, x, FLOOR + 6, 40); r.addColorStop(0, 'rgba(255,200,110,.28)'); r.addColorStop(1, 'rgba(255,200,110,0)'); g.fillStyle = r; g.fillRect(x - 40, FLOOR - 10, 80, 30); }
  // люк по центру
  g.strokeStyle = '#121110'; g.lineWidth = 1; g.beginPath(); g.ellipse(192, FLOOR + 8, 22, 4, 0, 0, TAU); g.stroke();
  return c;
}

function stageFx(g, t) {
  // гирлянда фонарей с мерцанием
  g.strokeStyle = '#0a0a09'; g.lineWidth = 1;
  const wire = (x0, y0, x1, y1, sag) => {
    g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2, Math.max(y0, y1) + sag, x1, y1); g.stroke();
    for (let i = 1; i < 6; i++) {
      const u = i / 6, x = (1 - u) * (1 - u) * x0 + 2 * u * (1 - u) * (x0 + x1) / 2 + u * u * x1;
      const y = (1 - u) * (1 - u) * y0 + 2 * u * (1 - u) * (Math.max(y0, y1) + sag) + u * u * y1;
      const on = 0.75 + 0.25 * Math.sin(t / 9 + i * 1.7) * (i === 3 ? 2 : 1);
      g.fillStyle = `rgba(255,214,140,${0.18 * on})`; g.beginPath(); g.arc(x, y + 4, 6, 0, TAU); g.fill();
      g.fillStyle = `rgba(255,226,160,${on})`; g.fillRect(Math.round(x) - 1, Math.round(y) + 2, 2, 3);
    }
  };
  wire(40, 40, 340, 60, 40); wire(90, 70, 300, 30, 50);
  // свечи у краёв
  for (const [x, y] of [[8, FLOOR + 2], [20, FLOOR - 2], [30, FLOOR + 4], [356, FLOOR], [370, FLOOR - 3], [378, FLOOR + 3]]) {
    g.fillStyle = '#e8dcc0'; g.fillRect(x, y - 8, 3, 8);
    const fl = 1 + Math.sin(t / 3 + x) * 0.4;
    g.fillStyle = `rgba(255,170,60,${0.25})`; g.beginPath(); g.arc(x + 1.5, y - 10, 5 * fl, 0, TAU); g.fill();
    g.fillStyle = '#ffd36a'; g.fillRect(x + 1, y - 11 - fl, 1, 2 + fl);
  }
}

// ---------- бойцы ----------
function limb(g, a, b, w, c) { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
function dot(g, p, r, c) { g.fillStyle = c; g.beginPath(); g.arc(p.x, p.y, r, 0, TAU); g.fill(); }
function torsoQuad(g, j, wHip, wSh, c) {
  const n = { x: -j.tv.y, y: j.tv.x };
  g.fillStyle = c; g.beginPath();
  g.moveTo(j.hip.x + n.x * wHip, j.hip.y + n.y * wHip); g.lineTo(j.sh.x + n.x * wSh, j.sh.y + n.y * wSh);
  g.lineTo(j.sh.x - n.x * wSh, j.sh.y - n.y * wSh); g.lineTo(j.hip.x - n.x * wHip, j.hip.y - n.y * wHip); g.closePath(); g.fill();
}
const mid = (a, b, t = 0.5) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function drawBebop(g, f, t) {
  const j = f.rig, c = f.col, s = f.face;
  const dk = (x) => shade(x, 0.62);
  // задняя нога и рука с шаром
  limb(g, j.hip, j.kB, 7, dk(c.metal)); limb(g, j.kB, j.ftB, 6, dk(c.body)); dot(g, j.kB, 3.5, dk(c.yellow));
  g.fillStyle = dk(c.metal); g.fillRect(j.ftB.x - 5, j.ftB.y - 3, 10, 4);
  limb(g, j.shB, j.eB, 5, dk(c.metal)); limb(g, j.eB, j.hnB, 6, dk(c.body));
  const ball = { x: j.hnB.x, y: j.hnB.y + 7 };
  limb(g, j.hnB, ball, 1.5, '#1a1410');
  dot(g, ball, 8, c.ball);
  for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + t / 30; dot(g, { x: ball.x + Math.cos(a) * 8.5, y: ball.y + Math.sin(a) * 8.5 }, 1.2, '#6a5040'); }
  dot(g, { x: ball.x - 2, y: ball.y - 2 }, 3, '#e8dcc0');
  // юбка-набедренник
  const dn = { x: -j.tv.x, y: -j.tv.y }, n = { x: -j.tv.y, y: j.tv.x };
  g.fillStyle = c.cloth; g.beginPath();
  g.moveTo(j.hip.x + n.x * 9, j.hip.y + n.y * 9); g.lineTo(j.hip.x - n.x * 9, j.hip.y - n.y * 9);
  g.lineTo(j.hip.x - n.x * 11 + dn.x * 15, j.hip.y - n.y * 11 + dn.y * 15); g.lineTo(j.hip.x + n.x * 11 + dn.x * 15, j.hip.y + n.y * 11 + dn.y * 15); g.fill();
  // корпус
  torsoQuad(g, j, 8, 13, c.body);
  torsoQuad(g, { ...j, hip: mid(j.hip, j.sh, 0.15), sh: mid(j.hip, j.sh, 0.3) }, 9, 10, c.body2);
  dot(g, mid(j.hip, j.sh, 0.55), 4, c.yellow); dot(g, mid(j.hip, j.sh, 0.55), 2, '#2a1a10');
  // голова
  dot(g, j.hd, f.ch.dim.head - 1, c.body);
  g.fillStyle = c.eye; g.fillRect(j.hd.x + s * 2 - 1, j.hd.y - 1, 2, 2); g.fillRect(j.hd.x + s * 5 - 1, j.hd.y - 1, 2, 2);
  limb(g, j.hd, { x: j.hd.x - s * 1, y: j.hd.y - 10 }, 1, c.metal); dot(g, { x: j.hd.x - s, y: j.hd.y - 10 }, 1.5, c.yellow);
  // передняя нога
  limb(g, j.hip, j.kF, 7, c.metal); limb(g, j.kF, j.ftF, 6, c.body); dot(g, j.kF, 3.5, c.yellow);
  g.fillStyle = c.metal; g.fillRect(j.ftF.x - 5 + s * 2, j.ftF.y - 3, 10, 4);
  // наплечник и рука-захват
  g.fillStyle = c.yellow; g.beginPath(); g.ellipse(j.sh.x + s * 2, j.sh.y + 2, 8, 6, 0, 0, TAU); g.fill();
  limb(g, j.sh, j.eF, 5, c.metal);
  if (f.reach > 0) {
    const tip = { x: j.hnF.x + s * f.reach, y: j.hnF.y };
    limb(g, j.eF, j.hnF, 6, c.body);
    g.setLineDash([2, 2]); limb(g, j.hnF, tip, 2, '#9a9aa2'); g.setLineDash([]);
    claw(g, tip, s, c);
  } else { limb(g, j.eF, j.hnF, 6, c.body); claw(g, j.hnF, s, c); }
  if (f.beam) drawBeam(g, f, t);
}
function claw(g, p, s, c) {
  dot(g, p, 3.5, c.yellow);
  limb(g, p, { x: p.x + s * 5, y: p.y - 3 }, 2, c.yellow); limb(g, p, { x: p.x + s * 5, y: p.y + 3 }, 2, c.yellow);
}
function drawBeam(g, f, t) {
  const x0 = f.rig.hnF.x, y = f.rig.hnF.y, x1 = f.face > 0 ? W + 10 : -10;
  const w = 16 + Math.sin(t) * 3;
  g.fillStyle = 'rgba(96,205,227,.35)'; g.fillRect(Math.min(x0, x1), y - w / 2 - 4, Math.abs(x1 - x0), w + 8);
  g.fillStyle = 'rgba(160,240,255,.8)'; g.fillRect(Math.min(x0, x1), y - w / 2, Math.abs(x1 - x0), w);
  g.fillStyle = '#fff'; g.fillRect(Math.min(x0, x1), y - 3, Math.abs(x1 - x0), 6);
  dot(g, { x: x0, y }, 12 + Math.sin(t * 1.3) * 2, 'rgba(220,255,255,.9)');
}

function drawLash(g, f, t) {
  const j = f.rig, c = f.col, s = f.face;
  const dk = (x) => shade(x, 0.62);
  // задние нога и рука
  limb(g, j.hip, j.kB, 8, dk(c.pants)); limb(g, j.kB, j.ftB, 7, dk(c.pants));
  g.fillStyle = dk(c.boot); g.fillRect(j.ftB.x - 5, j.ftB.y - 5, 10, 6);
  limb(g, j.shB, j.eB, 6.5, dk(c.skin)); limb(g, j.eB, j.hnB, 6, dk(c.skin)); dot(g, j.hnB, 3.6, dk(c.boot));
  // корпус: майка, подтяжки, ремень, верёвка
  torsoQuad(g, j, 7, 12, c.shirt);
  dot(g, j.sh, 6, c.skin);
  const n = { x: -j.tv.y, y: j.tv.x };
  for (const k of [-5, 5]) limb(g, { x: j.sh.x + n.x * k, y: j.sh.y + n.y * k }, { x: j.hip.x + n.x * k * 0.8, y: j.hip.y + n.y * k * 0.8 }, 1.5, c.strap);
  limb(g, { x: j.hip.x + n.x * 8, y: j.hip.y + n.y * 8 }, { x: j.hip.x - n.x * 8, y: j.hip.y - n.y * 8 }, 3, c.strap);
  g.strokeStyle = '#a07a4a'; g.lineWidth = 1.5; g.beginPath(); g.arc(j.hip.x - s * 6, j.hip.y + 5, 4, 0, TAU); g.stroke();
  // голова
  dot(g, j.hd, f.ch.dim.head, c.skin);
  g.fillStyle = c.hair; g.beginPath(); g.arc(j.hd.x - s * 1, j.hd.y - 2, f.ch.dim.head, Math.PI * 1.05, Math.PI * 1.95); g.fill();
  g.fillRect(j.hd.x - s * 6 - 2, j.hd.y - 3, 4, 6);
  g.fillStyle = '#1a120c'; g.fillRect(j.hd.x + (s > 0 ? 1 : -7), j.hd.y + 2, 6, 2); // усы
  g.fillRect(j.hd.x + s * 4 - 1, j.hd.y - 2, 2, 1);
  // передние нога и рука
  limb(g, j.hip, j.kF, 8, c.pants); limb(g, j.kF, j.ftF, 7, c.pants);
  g.fillStyle = c.boot; g.fillRect(j.ftF.x - 5 + s * 2, j.ftF.y - 5, 10, 6);
  limb(g, j.sh, j.eF, 6.5, c.skin); limb(g, j.eF, j.hnF, 6, c.skin); dot(g, j.hnF, 3.8, c.wrap);
  if (f.whip) {
    g.strokeStyle = '#4a2e16'; g.lineWidth = 2; g.beginPath(); g.moveTo(j.hnF.x, j.hnF.y);
    g.quadraticCurveTo((j.hnF.x + f.whip.tx) / 2, Math.min(j.hnF.y, f.whip.ty) - 18, f.whip.tx, f.whip.ty); g.stroke();
  }
}

function drawFighter(g, f, t) {
  // тень
  g.fillStyle = 'rgba(0,0,0,.4)'; g.beginPath(); g.ellipse(f.x, FLOOR + 1, 18 * Math.max(0.4, 1 - (FLOOR - f.y) / 120), 3, 0, 0, TAU); g.fill();
  g.lineCap = 'round'; g.lineJoin = 'round';
  if (f.inv > 0 && (t >> 1) % 2) g.globalAlpha = 0.5;
  if (f.id === 'bebop') drawBebop(g, f, t); else drawLash(g, f, t);
  g.globalAlpha = 1;
  if (f.st === 'dizzy' && f.stun < 900) for (let i = 0; i < 3; i++) { const a = t / 8 + i * TAU / 3; dot(g, { x: f.rig.hd.x + Math.cos(a) * 9, y: f.rig.hd.y - 12 + Math.sin(a) * 3 }, 1.5, '#ffe14d'); }
}

export function render(g, G, stage, opts = {}) {
  const t = G.frame;
  g.save();
  if (G.shake) g.translate(Math.round((Math.random() - 0.5) * G.shake), Math.round((Math.random() - 0.5) * G.shake));
  g.drawImage(stage, 0, 0);
  stageFx(g, t);
  // атакующий рисуется поверх
  const order = [...G.f].sort((a, b) => (a.st === 'atk' || a.st === 'ult') - (b.st === 'atk' || b.st === 'ult'));
  for (const f of order) drawFighter(g, f, t);
  for (const p of G.proj) {
    dot(g, p, 4, '#2a2a2a');
    if ((t >> (p.stuck && p.fuse < 30 ? 1 : 3)) % 2) dot(g, { x: p.x + 1, y: p.y - 2 }, 1.5, '#ff3a2a');
  }
  for (const p of G.parts) {
    if (p.ring) { const k = 1 - p.life / p.max; g.strokeStyle = `rgba(255,225,77,${1 - k})`; g.lineWidth = 3 * (1 - k) + 1; g.beginPath(); g.arc(p.x, p.y, p.rad * (0.3 + k), 0, TAU); g.stroke(); dot(g, p, p.rad * 0.5 * (1 - k), `rgba(255,240,200,${0.8 * (1 - k)})`); continue; }
    g.globalAlpha = Math.min(1, p.life / 10); g.fillStyle = p.c; g.fillRect(Math.round(p.x), Math.round(p.y), p.r, p.r);
  }
  g.globalAlpha = 1;
  if (opts.debug) for (const f of G.f) {
    const b = f.rig.box; g.strokeStyle = '#0f0'; g.lineWidth = 1; g.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    const m = f.mv; if (f.st === 'atk' && m) { const hb = m.box ? m.box(f) : m.hb; if (hb && f.mf >= m.s && f.mf < m.s + m.a) { const x0 = f.face > 0 ? f.x + hb.x : f.x - hb.x - hb.w; g.strokeStyle = '#f00'; g.strokeRect(x0, f.y + hb.y, hb.w, hb.h); } }
  }
  g.restore();
  if (G.flash) { g.fillStyle = `rgba(255,255,255,${G.flash / 28})`; g.fillRect(0, 0, W, H); }
}
