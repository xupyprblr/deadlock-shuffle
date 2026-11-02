// Движок файтинга: состояния бойцов, физика, попадания, спецприёмы, раунды. Без DOM.
// Game.update(inputs) — один кадр (1/60 с). События для звука и надписей копятся в game.events.
import { W, FLOOR, MOVES, SPECIALS, CHARS, HB, STAND, CROUCH, JUMP, BLOCK, CBLOCK, HIT, DIZZY, KNOCK, DOWN, WIN, BEAM } from './data.js';
import { RIGS } from './rigs.js';
import { ANIMS, KEYS } from './anims.js';

export const ROUND_TIME = 99;
export const WINS_NEEDED = 2;
const WALL_L = 16, WALL_R = W - 16, GRAV = 0.32, PUSH = 32;
// Камера показывает часть сцены (render.js, ZOOM), поэтому бойцы не расходятся дальше MAX_GAP.
export const MAX_GAP = 250;
const D2R = Math.PI / 180;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function blend(a, b, t) { const o = {}; for (const k of KEYS) o[k] = lerp(a[k] || 0, b[k] || 0, t); return o; }
const FREE = new Set(['idle', 'walk', 'crouch', 'block', 'cblock']);
const BTN = ['lp', 'hp', 'lk', 'hk'];

// ---------- скелет ----------
// Кости и гнёзда — с нарисованных частей (rigs.js). Кость корпуса идёт от таза к переднему плечу и на рисунке наклонена
// на torsoAng; заднее плечо, шея и два бедра — отдельные гнёзда. Стопа — своя кость, ровная, пока на неё опираются.
const RS = (o, a, s) => { const c = Math.cos(a * D2R), n = Math.sin(a * D2R); return { x: (o[0] * c - o[1] * n) * s, y: o[0] * n + o[1] * c }; };
export function rig(f) {
  const p = f.pose, R = RIGS[f.id], d = R.bones, k = R.sockets, s = f.face, r = p.rot || 0;
  const L = (a, l) => ({ x: Math.sin(a * D2R) * l * s, y: Math.cos(a * D2R) * l });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  const fo = d.foot;
  const hF = Math.cos(p.tF * D2R) * d.th + Math.cos(p.sF * D2R) * d.sh + fo;
  const hB = Math.cos(p.tB * D2R) * d.th + Math.cos(p.sB * D2R) * d.sh + fo;
  const ho = lerp(Math.max(hF, hB, 10), 7, Math.min(1, Math.abs(r) / 90));
  const hip = { x: f.x, y: f.y - ho };
  const hipF = add(hip, RS(k.hipF, r, s)), hipB = add(hip, RS(k.hipB, r, s));
  const kF = add(hipF, L(p.tF - r, d.th)), anF = add(kF, L(p.sF - r, d.sh));
  const kB = add(hipB, L(p.tB - r, d.th)), anB = add(kB, L(p.sB - r, d.sh));
  const lowF = hF >= hB - 1.5 && Math.abs(r) < 25, lowB = hB >= hF - 1.5 && Math.abs(r) < 25;
  const footF = lowF ? 0 : 0.5 * p.sF - r, footB = lowB ? 0 : 0.5 * p.sB - r;
  const ftF = add(anF, L(footF, fo)), ftB = add(anB, L(footB, fo));
  const la = p.lean + r;
  const sh = add(hip, RS(k.shF, la, s)), shB = add(hip, RS(k.shB, la, s)), neck = add(hip, RS(k.neck, la, s));
  const ha = la + p.head, hv = { x: Math.sin(ha * D2R) * s, y: -Math.cos(ha * D2R) };
  const hd = { x: neck.x + hv.x * (d.head + 1), y: neck.y + hv.y * (d.head + 1) };
  const eF = add(sh, L(p.aF - r, d.ua)), hnF = add(eF, L(p.fF - r, d.fa));
  const eB = add(shB, L(p.aB - r, d.uaB)), hnB = add(eB, L(p.fB - r, d.faB));
  const j = { hip, hipF, hipB, kF, anF, ftF, footF, kB, anB, ftB, footB, sh, shB, neck, hd, eF, hnF, eB, hnB, la, ha, r };
  if (Math.abs(r) > 20) { // повёрнутое тело не уходит под пол, а лёжа касается его
    const pts = [hip, sh, shB, eF, eB, hnF, hnB, kF, kB, ftF, ftB, { y: hd.y + d.head }];
    const lo = Math.max(...pts.map((q) => q.y)) + 2 - f.y;
    if (lo > 0 || (f.y >= FLOOR && lo < 0)) for (const q of Object.values(j)) if (q && typeof q === 'object') q.y -= lo;
  }
  const w = d.w * 1.3; // зона попадания чуть шире нарисованного корпуса
  if (Math.abs(r) < 25) {
    const cx = (hip.x + sh.x + shB.x) / 3;
    j.box = { x0: cx - w, x1: cx + w, y0: hd.y - d.head, y1: Math.max(ftF.y, ftB.y, hip.y + 4) };
  } else {
    const pts = [hip, kF, ftF, kB, ftB, sh, shB, hd];
    j.box = { x0: Math.min(...pts.map((q) => q.x)) - 4, x1: Math.max(...pts.map((q) => q.x)) + 4, y0: Math.min(...pts.map((q) => q.y)) - 5, y1: Math.max(...pts.map((q) => q.y)) + 3 };
  }
  return j;
}

// ---------- клипы анимаций ----------
// Поза в кадре f клипа: смешение соседних ключей (linear — как удары движка, smooth — сглаженно).
export function clipPose(id, name, f) {
  const c = ANIMS[id][name] || ANIMS[id].idle, k = c.keys;
  if (c.loop) f = ((f % c.n) + c.n) % c.n; else f = clamp(f, 0, c.n - 1);
  const arr = (v) => { const o = {}; KEYS.forEach((q, i) => { o[q] = v[i]; }); return o; };
  if (f <= k[0][0]) return arr(k[0][1]);
  for (let i = 0; i < k.length - 1; i++) if (f <= k[i + 1][0]) {
    const [fa, a] = k[i], [fb, b] = k[i + 1], u = (f - fa) / Math.max(1e-6, fb - fa), t = c.ease === 'smooth' ? u * u * (3 - 2 * u) : u;
    return arr(a.map((v, q) => lerp(v, b[q], t)));
  }
  return arr(k[k.length - 1][1]);
}

function worldBox(f, hb) {
  const x0 = f.face > 0 ? f.x + hb.x : f.x - hb.x - hb.w;
  return { x0, x1: x0 + hb.w, y0: f.y + hb.y, y1: f.y + hb.y + hb.h };
}
const overlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

// ---------- спецприёмы ----------
// Те же поля, что у обычных ударов, плюс tick (каждый кадр приёма), box (зона удара по кадрам), onHit.
const SP = {
  hook: {
    s: 8, a: 22, r: 14, dmg: 6, kind: 'mid', hs: 10, kb: 0, special: true,
    pose: { ...STAND, lean: 14, aF: 92, fF: 90, aB: 30, fB: 120, tF: 30, sF: 10, tB: -26, sB: -26 },
    tick(G, f) {
      const k = f.mf - this.s;
      f.reach = k < 0 ? 0 : k < 14 ? (k + 1) / 14 * 150 : k < this.a ? 150 * (1 - (k - 14) / (this.a - 14)) : 0;
      if (k === 0) G.emit('sfx', { s: 'chain' });
    },
    box(f) { return f.mf - this.s < 14 && f.reach > 0 ? { x: 16, y: -68, w: f.reach + 6, h: 14 } : null; },
    onHit(G, f, o) {
      o.st = 'pulled'; o.pullTo = f.x + f.face * 30; o.vx = 0; o.vy = 0;
      f.mf = Math.max(f.mf, this.s + 14); // сразу сматываем руку
    },
  },
  bomb: {
    s: 10, a: 1, r: 18, special: true, pose: { ...STAND, lean: 10, aF: 150, fF: 120, aB: 60, fB: 140 },
    tick(G, f) {
      if (f.mf === this.s) {
        G.proj.push({ type: 'bomb', owner: f, x: f.rig.hnB.x, y: f.rig.hnB.y, vx: 3.3 * f.face, vy: -2.4, t: 0, stuck: null, fuse: 0 });
        G.emit('sfx', { s: 'throw' });
      }
    },
  },
  xup: {
    s: 8, a: 5, r: 26, dmg: 15, kind: 'mid', hs: 30, kb: 1, kd: { vx: 2, vy: -8 }, special: true, from: CROUCH, to: STAND,
    hb: { x: 0, y: -104, w: 34, h: 72 },
    pose: { ...STAND, lean: 4, head: -10, aF: 175, fF: 178, aB: 40, fB: 150 },
    tick(G, f) { if (f.mf === this.s) { f.vx = 2.2 * f.face; G.boom(f.x + f.face * 18, f.y - 70, 0.6); } },
    onHit(G, f, o) { G.boom((f.x + o.x) / 2, f.y - 60, 1); },
  },
  beam: {
    s: 34, a: 72, r: 22, dmg: 2.2, kind: 'mid', hs: 12, kb: 0.5, special: true, ult: true, multi: true, pose: BEAM,
    tick(G, f) {
      if (f.mf === 1) G.emit('sfx', { s: 'charge' });
      if (f.mf === this.s) { G.emit('sfx', { s: 'beam' }); G.shake = 10; }
      if (f.mf < this.s && f.mf % 2 === 0) G.charge(f);
      f.beam = f.mf >= this.s && f.mf < this.s + this.a;
    },
    box(f) {
      const k = f.mf - this.s;
      if (k < 0 || k % 6) return null;
      return { x: 18, y: -74, w: W, h: 28, last: k >= this.a - 6 };
    },
  },
  grap: {
    s: 6, a: 24, r: 10, dmg: 9, kind: 'mid', hs: 20, kb: 2, kd: { vx: 2.5, vy: -4 }, special: true, phys: true,
    hb: { x: 2, y: -64, w: 32, h: 38 },
    pose: { ...JUMP, lean: -10, tF: 80, sF: 85, tB: 60, sB: -40, aF: 120, fF: 120 },
    tick(G, f) {
      const k = f.mf - this.s;
      if (k === 0) { f.vx = 6.6 * f.face; f.vy = f.y < FLOOR - 1 ? -0.6 : -1.6; G.emit('sfx', { s: 'whip' }); }
      f.whip = k < 8 ? { tx: f.x + f.face * (40 + k * 12), ty: f.y - 90 } : null;
      if (k >= 0 && k < this.a) { f.nograv = true; f.vy = Math.min(f.vy + 0.1, 0.6); if (f.x <= WALL_L + 1 || f.x >= WALL_R - 1) f.mf = this.s + this.a; }
      else { f.nograv = false; f.vx *= 0.85; }
    },
    onHit(G, f) { f.mf = this.s + this.a; f.vx = -1.5 * f.face; f.vy = -2.5; f.nograv = false; },
  },
  flog: {
    s: 9, a: 5, r: 18, dmg: 8, kind: 'mid', hs: 18, kb: 3, special: true,
    hb: { x: 12, y: -76, w: 84, h: 34 },
    pose: { ...STAND, lean: 14, aF: 110, fF: 100, aB: 20, fB: 90, tF: 30, sF: 10, tB: -26, sB: -26 },
    tick(G, f) {
      const k = f.mf - this.s;
      if (f.mf === 4) G.emit('sfx', { s: 'whip' });
      f.whip = k >= -3 && k < this.a + 3 ? { tx: f.x + f.face * (40 + Math.min(1, (k + 4) / 6) * 56), ty: f.y - 60 + Math.sin(k) * 4 } : null;
    },
    onHit(G, f) { f.hp = Math.min(100, f.hp + 5); G.emit('heal', { side: f.side }); },
  },
  gstrike: {
    s: 4, a: 90, r: 18, special: true, phys: true, pose: { ...JUMP, lean: 20, tF: 30, sF: 0, tB: 10, sB: 0, aF: 175, fF: 178, aB: 160, fB: 175 },
    tick(G, f, o) {
      const k = f.mf - this.s;
      if (k === 0) { f.vx = 0; f.vy = 8.5; f.h0 = FLOOR - f.y; G.emit('sfx', { s: 'whoosh' }); }
      if (k > 0 && k < this.a && f.y >= FLOOR) {
        f.mf = this.s + this.a;
        const dmg = Math.round(5 + f.h0 / 9);
        G.area(f, { x: -64, y: -26, w: 128, h: 26 }, { dmg, kind: 'low', hs: 20, kd: { vx: 2.2, vy: -5 }, special: true });
        G.shake = 12; G.dust(f.x, FLOOR, 22); G.boom(f.x, FLOOR - 6, 0.5);
      }
    },
  },
  slam: {
    s: 12, a: 1, r: 28, special: true, ult: true, pose: { ...STAND, lean: 18, aF: 100, fF: 95, aB: 30, fB: 90, tF: 30, sF: 10, tB: -26, sB: -26 },
    tick(G, f, o) {
      f.whip = f.mf >= 6 && f.mf <= this.s + 6 ? { tx: f.x + f.face * 70, ty: f.y - 50 } : null;
      if (f.mf !== this.s) return;
      G.emit('sfx', { s: 'whip' });
      if (Math.abs(o.x - f.x) < 78 && G.hittable(o) && o.y > FLOOR - 50) {
        f.st = 'ult'; f.ct = 0; o.st = 'grabbed'; o.mv = null; f.whip = null; G.emit('sfx', { s: 'grab' });
      }
    },
  },
};

// Порядок ultimate-цикла Lash: 3 удара о землю по 26 кадров.
const SLAM_CYCLE = 26, SLAM_N = 3, SLAM_DMG = 8;

// ---------- боец ----------
export class Fighter {
  constructor(id, side, alt = false) {
    this.id = id; this.side = side; this.ch = CHARS[id]; this.col = alt ? this.ch.alt : this.ch.col;
    this.meter = 0; this.wins = 0; this.reset();
  }
  reset() {
    this.x = this.side ? 254 : 130; this.y = FLOOR; this.vx = 0; this.vy = 0;
    this.face = this.side ? -1 : 1; this.hp = 100; this.lagHp = 100;
    this.st = 'idle'; this.t = 0; this.mv = null; this.mf = 0; this.hasHit = false; this.airUsed = false;
    this.pose = clipPose(this.id, 'idle', 0); this.akey = null; this.af = 0; this.buf = []; this.prev = {}; this.inv = 0; this.stun = 0; this.bstun = 0;
    this.combo = 0; this.jug = 0; this.reach = 0; this.whip = null; this.beam = false; this.nograv = false; this.wt = 0;
    this.rig = rig(this);
  }
  get busy() { return !FREE.has(this.st) || this.bstun > 0; }
}

// ---------- игра ----------
export class Game {
  constructor(p1, p2, opts = {}) {
    const alt = p1 === p2;
    this.f = [new Fighter(p1, 0), new Fighter(p2, 1, alt)];
    this.f[0].o = this.f[1]; this.f[1].o = this.f[0];
    this.round = 1; this.frame = 0; this.events = []; this.parts = []; this.proj = [];
    // Тренировка: таймер стоит, раунды не считаются, здоровье восстанавливается; опции можно менять на ходу.
    // immortal — здоровье не падает ниже 1; meter — шкала ульты всегда полная.
    this.opts = { training: false, immortal: true, meter: false, ...opts };
    this.winner = null; this.newRound();
  }
  emit(type, data = {}) { this.events.push({ type, ...data }); }
  newRound() {
    for (const f of this.f) f.reset();
    this.phase = 'intro'; this.pt = 0; this.timer = ROUND_TIME * 60; this.proj = []; this.stop = 0; this.shake = 0; this.flash = 0;
    this.koBy = null;
    if (this.opts.training) { this.phase = 'fight'; this.round = 1; }
  }

  update(inputs) {
    this.frame++;
    if (this.phase === 'over') { this.stepParts(); for (const f of this.f) this.stepFighter(f, {}); return; }
    if (this.stop > 0) { this.stop--; return; }
    if (this.shake > 0) this.shake *= 0.86, this.shake < 0.3 && (this.shake = 0);
    if (this.flash > 0) this.flash--;
    this.pt++;
    if (this.phase === 'intro') {
      if (this.pt === 1) this.emit('round', { n: this.round });
      if (this.pt === 75) this.emit('fight');
      if (this.pt >= 95) { this.phase = 'fight'; this.pt = 0; }
    } else if (this.phase === 'fight') {
      if (this.opts.training) this.training();
      else if (--this.timer <= 0) this.timeUp();
    } else if (this.phase === 'ko') {
      if (this.pt < 50 && this.pt % 2) return; // замедление сразу после нокаута
      if (this.pt === 90 && this.winnerSide !== null) { const w = this.f[this.winnerSide]; if (w.st !== 'ult') { w.st = 'win'; w.mv = null; } }
      if (this.pt === 100) this.emit('result', { side: this.winnerSide, flawless: this.winnerSide !== null && this.f[this.winnerSide].hp >= 100 });
      if (this.pt === 210) this.endRound();
    }
    const live = this.phase === 'fight';
    for (const f of this.f) this.stepFighter(f, live ? (inputs[f.side] || {}) : {});
    this.solve();
    for (const f of this.f) {
      const key = f.st === 'atk' ? 'atk:' + f.mn : f.st === 'walk' ? 'walk' + (f.vx * f.face >= 0) : f.st;
      if (key !== f.akey) { f.akey = key; f.af = 0; } else f.af++;
      f.pose = blend(f.pose, this.poseOf(f), f.st === 'atk' || f.st === 'ult' ? 1 : 0.5); f.rig = rig(f);
    }
    for (const f of this.f) this.attackCheck(f);
    this.stepProj();
    this.stepParts();
    for (const f of this.f) if (f.lagHp > f.hp) f.lagHp = Math.max(f.hp, f.lagHp - 0.35); else f.lagHp = f.hp;
    if (this.phase === 'fight') for (const f of this.f) if (f.hp <= 0) { this.ko(f); break; }
  }

  ko(v) {
    this.phase = 'ko'; this.pt = 0; this.winnerSide = v.o.side; this.stop = 12; this.flash = 6;
    if (v.st !== 'grabbed' && v.st !== 'knock') { v.st = 'knock'; v.vy = -4; v.vx = Math.sign(v.x - v.o.x || -v.face) * 2; }
    this.emit('ko'); this.emit('sfx', { s: 'ko' });
  }
  timeUp() {
    const [a, b] = this.f;
    this.phase = 'ko'; this.pt = 40;
    this.winnerSide = a.hp === b.hp ? null : a.hp > b.hp ? 0 : 1;
    if (this.winnerSide !== null) { const l = this.f[1 - this.winnerSide]; l.st = 'dizzy'; l.stun = 999; }
    this.emit('timeup');
  }
  training() {
    for (const f of this.f) {
      if (this.opts.meter) f.meter = 100;
      // через 1,5 с без урона здоровье восстанавливается, чтобы можно было пробовать серии заново
      if (f.hp < 100 && this.frame - (f.hurtAt || 0) > 90 && FREE.has(f.st)) f.hp = Math.min(100, f.hp + 1.5);
    }
  }
  endRound() {
    if (this.opts.training) { this.newRound(); return; }
    if (this.winnerSide !== null) this.f[this.winnerSide].wins++;
    const champ = this.f.find((f) => f.wins >= WINS_NEEDED);
    if (champ) { this.phase = 'over'; this.winner = champ.side; this.emit('match', { side: champ.side }); return; }
    this.round++; this.newRound();
  }

  // ----- ввод и состояния -----
  stepFighter(f, inp) {
    const o = f.o;
    const pr = {};
    for (const k of ['lp', 'hp', 'lk', 'hk', 'u', 'd', 'l', 'r', 'blk']) { pr[k] = !!inp[k] && !f.prev[k]; }
    f.prev = { ...inp };
    const fwd = f.face > 0 ? 'r' : 'l', back = f.face > 0 ? 'l' : 'r';
    if (pr[fwd]) f.buf.push({ k: 'F', t: this.frame });
    if (pr[back]) f.buf.push({ k: 'B', t: this.frame });
    if (pr.d) f.buf.push({ k: 'D', t: this.frame });
    while (f.buf.length && this.frame - f.buf[0].t > 40) f.buf.shift();
    const F = !!inp[fwd], B = !!inp[back], Dn = !!inp.d, Up = !!inp.u;
    let atk = BTN.find((k) => pr[k]);
    if (f.ai) { atk = f.ai.press || atk; f.ai.press = null; }
    if (f.inv > 0) f.inv--;
    f.t++;
    const grounded = f.y >= FLOOR;

    if (FREE.has(f.st)) {
      if (f.bstun > 0) { f.bstun--; f.vx *= 0.85; f.x += f.vx; return; }
      o.combo = 0; f.jug = 0;
      f.face = o.x >= f.x ? 1 : -1;
      if (f.aiSpecial) { const id = f.aiSpecial; f.aiSpecial = null; if (this.startSpecial(f, id)) return; }
      if (atk && this.trySpecial(f, atk, inp, false)) return;
      if (atk) {
        let m;
        if (Dn) m = { lp: 'clp', hp: 'up', lk: 'clk', hk: 'chk' }[atk];
        else if (B && (atk === 'lk' || atk === 'hk')) m = atk === 'lk' ? 'sweep' : 'round';
        else m = atk;
        this.startMove(f, m); return;
      }
      // двойное нажатие →→ — рывок к сопернику, ←← — отскок назад (как в МК)
      const dd = f.aiDash || (pr[fwd] && dbl(f.buf, 'F') ? 1 : pr[back] && dbl(f.buf, 'B') ? -1 : 0);
      f.aiDash = 0;
      if (dd && grounded && !Dn && !inp.blk) { this.startDash(f, dd); return; }
      if (Up && !inp.blk) {
        f.st = 'jump'; f.vy = -f.ch.jump; f.vx = (F ? 2.2 : B ? -2.2 : 0) * f.face; f.airUsed = false;
        this.emit('sfx', { s: 'jump' }); return;
      }
      if (inp.blk) { f.st = Dn ? 'cblock' : 'block'; f.vx = 0; return; }
      if (Dn) { f.st = 'crouch'; f.vx = 0; return; }
      if (F || B) { f.st = 'walk'; f.vx = (F ? f.ch.walk[0] : -f.ch.walk[1]) * f.face; f.wt += F ? 1 : -1; f.x += f.vx; return; }
      f.st = 'idle'; f.vx = 0; return;
    }

    switch (f.st) {
      case 'dash': { // рывок: из него сразу бьют или проводят спецприём (буфер →→ сохранён)
        f.dt++;
        if (atk) {
          if (this.trySpecial(f, atk, inp, false)) return;
          const carry = f.vx * 0.5;
          this.startMove(f, Dn ? { lp: 'clp', hp: 'up', lk: 'clk', hk: 'chk' }[atk] : atk); f.vx = carry; return;
        }
        f.x += f.vx; f.vx *= 0.9;
        if (f.dt % 5 === 0) this.dust(f.x - f.face * 6, FLOOR, 2);
        if (f.dt >= 16) { f.st = 'idle'; f.vx = 0; }
        return;
      }
      case 'bdash': { // отскок: короткий прыжок назад, первые кадры неуязвим
        f.dt++; this.physics(f);
        if (f.dt > 3 && f.y >= FLOOR && f.vy >= 0) { f.st = 'idle'; f.vx = 0; this.dust(f.x, FLOOR, 4); }
        return;
      }
      case 'jump': {
        if (atk && !f.airUsed) {
          if (this.trySpecial(f, atk, inp, true)) return;
          f.airUsed = true; this.startMove(f, atk === 'lp' || atk === 'hp' ? 'jp' : 'jk'); return;
        }
        this.physics(f);
        if (f.y >= FLOOR && f.vy >= 0) { f.st = 'idle'; f.vx = 0; this.dust(f.x, FLOOR, 4); }
        return;
      }
      case 'atk': {
        const m = f.mv; f.mf++;
        m.tick?.(this, f, o);
        if (f.st !== 'atk') return; // приём сменил состояние (захват ульты)
        if (m.air || m.phys || f.y < FLOOR || f.vy < 0) {
          this.physics(f);
          if (m.air && f.y >= FLOOR) { this.endMove(f, inp); f.vx = 0; return; }
        } else { f.vx *= 0.8; f.x += f.vx; }
        if (f.mf >= m.s + m.a + m.r) this.endMove(f, inp);
        return;
      }
      case 'hit': case 'dizzy': {
        f.vx *= 0.86; f.x += f.vx;
        if (f.y < FLOOR) this.physics(f);
        if (--f.stun <= 0) f.st = 'idle';
        return;
      }
      case 'knock': {
        this.physics(f);
        if (f.y >= FLOOR && f.vy >= 0) {
          f.vx *= 0.3; f.st = f.hp <= 0 ? 'ko' : 'down'; f.t = 0; this.dust(f.x, FLOOR, 10); this.shake = Math.max(this.shake, 4);
          this.emit('sfx', { s: 'land' });
        }
        return;
      }
      case 'down': { f.vx *= 0.8; f.x += f.vx; if (f.t > 38) { f.st = 'getup'; f.t = 0; f.inv = 16; } return; }
      case 'getup': { if (f.t > 14) { f.st = 'idle'; f.jug = 0; } return; }
      case 'ko': { f.vx *= 0.8; f.x += f.vx; return; }
      case 'pulled': {
        const d = f.pullTo - f.x; f.x += clamp(d, -9, 9); f.y = Math.min(FLOOR, f.y + 6);
        if (Math.abs(d) < 1 && f.y >= FLOOR) { f.st = 'dizzy'; f.stun = 32; f.vx = 0; }
        return;
      }
      case 'grabbed': return;
      case 'ult': { this.stepSlam(f); return; }
      case 'win': case 'lose': return;
    }
  }

  physics(f) {
    f.x += f.vx; f.y += f.vy;
    if (!f.nograv) f.vy += GRAV;
    if (f.y >= FLOOR) { f.y = FLOOR; if (f.vy > 0) f.vy = 0; }
  }

  startMove(f, name, m = MOVES[name]) {
    f.st = 'atk'; f.mv = m; f.mn = name; f.mf = 0; f.hasHit = false; f.reach = 0; f.whip = null; f.beam = false;
    this.emit('move', { side: f.side, name, s: m.s, a: m.a, r: m.r, dmg: m.dmg || 0 });
    if (!m.air && !m.phys && f.y >= FLOOR) f.vx = 0;
    this.emit('sfx', { s: m.special ? 'special' : 'swing', heavy: m.dmg >= 9 });
  }
  startDash(f, d) {
    f.dt = 0;
    if (d > 0) { f.st = 'dash'; f.vx = 5.6 * f.face; }
    else { f.st = 'bdash'; f.vx = -3.4 * f.face; f.vy = -2.8; f.inv = Math.max(f.inv, 8); }
    this.dust(f.x, FLOOR, 5); this.emit('sfx', { s: 'whoosh' });
  }
  endMove(f, inp = {}) {
    const m = f.mv; f.mv = null; f.reach = 0; f.whip = null; f.beam = false; f.nograv = false;
    if (f.y < FLOOR) { f.st = 'jump'; f.airUsed = true; return; }
    f.st = m && m.crouch && m.to !== STAND && inp.d ? 'crouch' : 'idle';
  }
  trySpecial(f, btn, inp, air) {
    for (const sp of SPECIALS[f.id]) {
      if (sp.btn !== btn) continue;
      if (air && !sp.air && !sp.airOnly) continue;
      if (!air && sp.airOnly) continue;
      if (sp.ult && f.meter < 100) continue;
      if (sp.hold ? !inp[sp.hold] : !matchSeq(f.buf, sp.seq, this.frame)) continue;
      if (this.startSpecial(f, sp.id)) { f.buf.length = 0; return true; }
    }
    return false;
  }
  // Запуск приёма по id — им же пользуется компьютерный соперник.
  startSpecial(f, id) {
    const sp = SPECIALS[f.id].find((s) => s.id === id);
    if (!sp) return false;
    const air = f.y < FLOOR - 1;
    if (air ? !(sp.air || sp.airOnly) || f.airUsed : sp.airOnly) return false;
    if (id === 'gstrike' && f.y > FLOOR - 24) return false;
    if (sp.ult) { if (f.meter < 100) return false; f.meter = 0; this.flash = 10; this.emit('ult', { side: f.side, name: sp.name }); }
    if (air) f.airUsed = true;
    if (id === 'bomb' && this.proj.some((p) => p.owner === f)) return false;
    this.startMove(f, id, SP[id]);
    this.emit('special', { side: f.side, name: sp.name });
    return true;
  }

  stepSlam(f) {
    const o = f.o; f.ct++;
    const k = f.ct % SLAM_CYCLE;
    o.x = clamp(f.x + f.face * 30, WALL_L, WALL_R);
    o.y = k < 12 ? FLOOR - (k / 12) * 64 : k < 16 ? FLOOR - 64 + ((k - 12) / 4) * 64 : FLOOR;
    o.face = -f.face;
    f.whip = { tx: o.x, ty: o.y - 40 };
    if (k === 16) {
      this.dmg(o, SLAM_DMG); f.meter = Math.min(100, f.meter); f.combo++; this.emit('combo', { side: f.side, n: f.combo });
      this.shake = 9; this.dust(o.x, FLOOR, 14); this.emit('sfx', { s: 'slam' }); this.stop = 3;
    }
    if (f.ct >= SLAM_CYCLE * SLAM_N - 4) {
      o.st = 'knock'; o.vx = f.face * 3; o.vy = -3; o.y = Math.min(o.y, FLOOR - 1);
      f.st = 'atk'; f.mv = SP.slam; f.mf = SP.slam.s + SP.slam.a; f.whip = null;
    }
  }

  // ----- столкновения тел и стены -----
  solve() {
    const [a, b] = this.f;
    for (const f of this.f) f.x = clamp(f.x, WALL_L, WALL_R);
    if (Math.abs(b.x - a.x) > MAX_GAP) { // упираются в края кадра: отходящий не утаскивает камеру
      const over = Math.abs(b.x - a.x) - MAX_GAP, s = Math.sign(b.x - a.x);
      const am = Math.abs(a.vx) > Math.abs(b.vx); // двигал тот, у кого скорость больше
      if (am) a.x += over * s; else b.x -= over * s;
    }
    if (a.st === 'grabbed' || b.st === 'grabbed' || a.st === 'pulled' || b.st === 'pulled') return;
    const dy = Math.abs(a.y - b.y);
    if (dy > 46) return; // перепрыгивает через голову
    const d = b.x - a.x, ad = Math.abs(d);
    if (ad < PUSH) {
      const push = (PUSH - ad) / 2, s = d === 0 ? (a.face > 0 ? 1 : -1) : Math.sign(d);
      a.x -= push * s; b.x += push * s;
      for (const f of this.f) f.x = clamp(f.x, WALL_L, WALL_R);
      if (Math.abs(b.x - a.x) < PUSH - 1) { if (a.x <= WALL_L + 1) b.x = a.x + PUSH; else if (b.x <= WALL_L + 1) a.x = b.x + PUSH; else if (a.x >= WALL_R - 1) b.x = a.x - PUSH; else if (b.x >= WALL_R - 1) a.x = b.x - PUSH; }
    }
  }

  hittable(o) { return !o.inv && !['down', 'getup', 'grabbed', 'pulled', 'ko'].includes(o.st) && !(o.st === 'knock' && o.jug >= 3); }

  attackCheck(f) {
    if (f.st !== 'atk' || !f.mv) return;
    const m = f.mv, o = f.o;
    const active = f.mf >= m.s && f.mf < m.s + m.a;
    if (!active) return;
    let hb;
    if (m.box) { hb = m.box(f); if (hb && m.multi) f.hasHit = false; }
    else hb = HB[f.id]?.[f.mn] || m.hb;
    if (!hb || f.hasHit || !m.dmg) return;
    const wb = worldBox(f, hb);
    if (!this.hittable(o) || !overlap(wb, o.rig.box)) return;
    f.hasHit = true;
    const res = this.applyHit(f, o, { dmg: m.dmg, kind: m.kind, hs: m.hs, kb: m.kb, kd: hb.last ? { vx: 2.4, vy: -4 } : m.kd, special: m.special, multi: m.multi }, wb);
    if (res === 'hit') m.onHit?.(this, f, o);
  }

  area(f, hb, h) {
    const o = f.o, wb = worldBox(f, hb);
    if (this.hittable(o) && overlap(wb, o.rig.box)) this.applyHit(f, o, h, wb);
  }

  blocks(v, kind, a) {
    if (kind === 'unblock') return false;
    const st = v.st === 'block' || v.st === 'cblock' ? v.st : null;
    if (!st) return false;
    if (Math.sign(a.x - v.x) !== v.face && Math.abs(a.x - v.x) > 4) return false; // удар в спину
    if (kind === 'low') return st === 'cblock';
    if (kind === 'over') return st === 'block';
    return true;
  }

  dmg(v, n) {
    v.hp = Math.max(this.opts.training && this.opts.immortal ? 1 : 0, v.hp - n); v.hurtAt = this.frame;
    this.emit('dmg', { side: v.side, n, combo: v.o.combo }); v.meter = Math.min(100, v.meter + n * 0.9); v.o.meter = Math.min(100, v.o.meter + n * 1.25); }

  applyHit(a, v, h, wb) {
    const cx = (Math.max(wb.x0, v.rig.box.x0) + Math.min(wb.x1, v.rig.box.x1)) / 2;
    const cy = (Math.max(wb.y0, v.rig.box.y0) + Math.min(wb.y1, v.rig.box.y1)) / 2;
    const dir = Math.sign(v.x - a.x) || a.face;
    if (this.blocks(v, h.kind, a)) {
      if (h.special) this.dmg(v, h.dmg * 0.2);
      v.bstun = Math.round(h.hs * 0.6); v.vx = dir * Math.max(1.2, (h.kb ?? 2) * 0.9);
      this.sparks(cx, cy, '#60cde3', 6); this.stop = 3; this.emit('sfx', { s: 'block' });
      return 'block';
    }
    const wasHurt = ['hit', 'dizzy', 'knock', 'pulled'].includes(v.st);
    this.dmg(v, h.dmg);
    a.combo = wasHurt ? a.combo + 1 : 1;
    if (a.combo >= 2) this.emit('combo', { side: a.side, n: a.combo });
    v.mv = null; v.whip = null; v.reach = 0; v.beam = false; v.nograv = false; v.bstun = 0;
    const air = v.y < FLOOR - 1;
    if (v.hp <= 0 || h.kd || (air && !h.multi)) {
      v.st = 'knock'; v.vx = dir * (h.kd?.vx ?? 1.8); v.vy = h.kd?.vy ?? -3; v.jug++;
    } else { v.st = 'hit'; v.stun = h.hs; v.vx = dir * (h.kb ?? 2); }
    this.stop = h.special ? 6 : h.dmg >= 9 ? 5 : 3;
    this.shake = Math.max(this.shake, h.dmg >= 9 ? 5 : 2);
    this.sparks(cx, cy, h.special ? '#ffe14d' : '#ff8a3d', h.dmg >= 9 ? 14 : 8);
    this.emit('sfx', { s: h.dmg >= 9 ? 'hitH' : 'hit' });
    return 'hit';
  }

  // ----- снаряды (липкая бомба) -----
  stepProj() {
    for (const p of this.proj) {
      p.t++;
      const v = p.owner.o;
      if (p.stuck) {
        p.x = v.rig.sh.x; p.y = (v.rig.sh.y + v.rig.hip.y) / 2;
        if (--p.fuse <= 0) {
          p.dead = true; this.boom(p.x, p.y, 1);
          if (!['grabbed', 'ko'].includes(v.st)) this.applyHit(p.owner, v, { dmg: 13, kind: 'unblock', hs: 20, kd: { vx: 2.2, vy: -5 }, special: true }, { x0: p.x - 4, x1: p.x + 4, y0: p.y - 4, y1: p.y + 4 });
        }
        continue;
      }
      p.x += p.vx; p.y += p.vy; p.vy += 0.16;
      const box = { x0: p.x - 5, x1: p.x + 5, y0: p.y - 5, y1: p.y + 5 };
      if (this.hittable(v) && overlap(box, v.rig.box)) {
        if (this.blocks(v, 'mid', p)) { p.dead = true; this.boom(p.x, p.y, 0.4); v.bstun = 10; this.emit('sfx', { s: 'block' }); }
        else { p.stuck = v; p.fuse = 66; this.emit('sfx', { s: 'stick' }); this.dmg(v, 2); }
        continue;
      }
      if (p.y >= FLOOR - 3 || p.x < 0 || p.x > W) {
        p.dead = true; this.boom(p.x, Math.min(p.y, FLOOR - 4), 0.6);
        const near = { x0: p.x - 22, x1: p.x + 22, y0: FLOOR - 30, y1: FLOOR };
        if (this.hittable(v) && overlap(near, v.rig.box)) this.applyHit(p.owner, v, { dmg: 6, kind: 'mid', hs: 16, kb: 2, special: true }, near);
      }
    }
    this.proj = this.proj.filter((p) => !p.dead);
  }

  // ----- частицы -----
  sparks(x, y, c, n) {
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 3; this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.5, life: 10 + Math.random() * 10, c, r: 1 + (Math.random() < 0.3) }); }
  }
  dust(x, y, n) {
    for (let i = 0; i < n; i++) this.parts.push({ x: x + (Math.random() - 0.5) * 20, y: y - 1, vx: (Math.random() - 0.5) * 2, vy: -Math.random() * 0.8, life: 18 + Math.random() * 14, c: '#8a8070', r: 2, g: -0.02 });
  }
  boom(x, y, s) {
    this.parts.push({ x, y, ring: true, life: 18, max: 18, rad: 26 * s, c: '#ffe14d' });
    for (let i = 0; i < 18 * s; i++) { const a = Math.random() * Math.PI * 2, v = 1 + Math.random() * 3.5 * s; this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, life: 14 + Math.random() * 16, c: Math.random() < 0.5 ? '#ff8a3d' : '#ffe14d', r: 2 }); }
    this.shake = Math.max(this.shake, 6 * s); this.emit('sfx', { s: 'boom' });
  }
  charge(f) {
    const hx = f.rig.hnF.x, hy = f.rig.hnF.y;
    const a = Math.random() * Math.PI * 2, d = 24 + Math.random() * 16;
    this.parts.push({ x: hx + Math.cos(a) * d, y: hy + Math.sin(a) * d, vx: -Math.cos(a) * d / 12, vy: -Math.sin(a) * d / 12, life: 12, c: '#9ff0ff', r: 1 });
  }
  stepParts() {
    for (const p of this.parts) { p.life--; if (!p.ring) { p.x += p.vx; p.y += p.vy; p.vy += p.g ?? 0.12; } }
    this.parts = this.parts.filter((p) => p.life > 0);
    if (this.parts.length > 400) this.parts.splice(0, this.parts.length - 400);
  }

  // ----- позы -----
  // Поза берётся из клипа ANIMS по состоянию; f.af — кадр с начала текущего состояния.
  poseOf(f) {
    const id = f.id, t = this.frame, k = f.af;
    switch (f.st) {
      case 'idle': return clipPose(id, 'idle', t + f.side * 30);
      case 'walk': return clipPose(id, f.vx * f.face >= 0 ? 'walk_fwd' : 'walk_back', k);
      case 'crouch': return clipPose(id, 'crouch', k);
      case 'block': return clipPose(id, 'block', k);
      case 'cblock': return clipPose(id, 'cblock', k);
      case 'jump': return clipPose(id, 'jump', k);
      case 'dash': { const p = clipPose(id, 'walk_fwd', k * 2.4); p.lean += 14; p.head -= 6; return p; }
      case 'bdash': { const p = clipPose(id, 'walk_back', k * 2.4); p.lean -= 8; return p; }
      case 'hit': case 'pulled': return clipPose(id, 'hit', k);
      case 'dizzy': case 'lose': return clipPose(id, 'dizzy', k);
      case 'knock': return clipPose(id, 'knock', k);
      case 'grabbed': return clipPose(id, 'knock', 12);
      case 'down': return clipPose(id, 'down', k);
      case 'ko': return clipPose(id, 'down', 0);
      case 'getup': return clipPose(id, 'getup', k * 22 / 15);
      case 'win': return clipPose(id, 'win', k);
      case 'ult': return clipPose(id, 'slam_ult', f.ct);
      case 'atk': {
        const m = f.mv, n = f.mn;
        if (n === 'gstrike' && f.mf >= m.s + m.a) return clipPose(id, 'gstrike_land', f.mf - m.s - m.a);
        return clipPose(id, n, f.mf);
      }
    }
    return clipPose(id, 'idle', t);
  }
}

// Два последних нажатия направления — одно и то же и не дальше 12 кадров друг от друга.
function dbl(buf, k) {
  const n = buf.length; if (n < 2) return false;
  const a = buf[n - 2], b = buf[n - 1];
  return a.k === k && b.k === k && b.t - a.t <= 12;
}

export function matchSeq(buf, seq, now) {
  let i = seq.length - 1, last = now;
  for (let j = buf.length - 1; j >= 0 && i >= 0; j--) {
    const e = buf[j];
    if (last - e.t > 16) break;
    if (e.k === seq[i]) { i--; last = e.t; }
  }
  return i < 0;
}
