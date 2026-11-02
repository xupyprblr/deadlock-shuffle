// Компьютерный соперник: раз в несколько кадров решает, что делать, и «держит» кнопки как игрок.
import { FLOOR } from './data.js';

const LEVELS = {
  easy: { react: 24, block: 0.15, aa: 0.2, sp: 0.15, agg: 0.45 },
  normal: { react: 14, block: 0.4, aa: 0.45, sp: 0.3, agg: 0.6 },
  hard: { react: 7, block: 0.65, aa: 0.7, sp: 0.4, agg: 0.75 },
};
const R = Math.random;
const pick = (arr) => arr[Math.floor(R() * arr.length)];

export function makeAI(level = 'normal') {
  const L = LEVELS[level] || LEVELS.normal;
  let hold = {}, holdT = 0, cd = 20, press = null, pressT = 0;
  return function think(G, f) {
    const o = f.o, dist = Math.abs(o.x - f.x), fwd = f.face > 0 ? 'r' : 'l', back = f.face > 0 ? 'l' : 'r';
    if (G.phase !== 'fight') { hold = {}; holdT = 0; return {}; }
    // нажатие кнопки держим 2 кадра, потом отпускаем, чтобы движок увидел новое нажатие в следующий раз
    if (press) { if (--pressT <= 0) { const r = press; press = null; return { ...r.held }; } return { ...press.held, [press.btn]: true }; }
    const doPress = (btn, held = {}) => { press = { btn, held }; pressT = 2; return { ...held, [btn]: true }; };

    if (f.st === 'jump' && !f.airUsed) {
      if (f.id === 'lash' && f.y < FLOOR - 40 && dist < 40 && R() < 0.15) return doPress('hk', { d: true });
      if (f.vy > -1 && dist < 46 && R() < 0.35) return doPress(R() < 0.5 ? 'hk' : 'hp');
      return { ...hold };
    }
    if (holdT > 0) { holdT--; return { ...hold }; }
    hold = {};
    if (f.busy) return {};
    // отклик на атаку соперника — проверяем каждый кадр, но с вероятностью уровня
    const oAtk = (o.st === 'atk' && o.mv && o.mf < o.mv.s + o.mv.a) || G.proj.some((p) => p.owner === o && !p.stuck);
    if (oAtk && dist < 110 && R() < L.block / 6) { hold = { blk: true, d: o.mv?.kind === 'low' }; holdT = 16; return { ...hold }; }
    if (o.st === 'jump' && dist < 70 && o.y < FLOOR - 20 && R() < L.aa / 4) return doPress('hp', { d: true });
    if (--cd > 0) return {};
    cd = L.react + Math.floor(R() * 10);

    if (f.meter >= 100 && (f.id === 'bebop' ? dist < 300 : dist < 70) && R() < 0.7) { f.aiSpecial = f.id === 'bebop' ? 'beam' : 'slam'; return {}; }
    const down = ['down', 'getup', 'ko'].includes(o.st);
    if (down) { hold = { [back]: R() < 0.3 }; holdT = 10; return { ...hold }; }

    if (dist > 120) {
      if (R() < L.sp) {
        if (f.id === 'bebop') { f.aiSpecial = R() < 0.55 ? 'hook' : 'bomb'; return {}; }
        f.aiSpecial = 'grap'; return {};
      }
      if (R() < 0.15 * L.agg) { hold = { u: true, [fwd]: true }; holdT = 3; return { ...hold }; }
      if (R() < 0.3 * L.agg) { f.aiDash = 1; return {}; }
      hold = { [fwd]: true }; holdT = 14 + Math.floor(R() * 20); return { ...hold };
    }
    if (dist > 56) {
      if (R() < L.sp) {
        if (f.id === 'bebop') { f.aiSpecial = pick(['hook', 'bomb', 'hook']); return {}; }
        if (dist < 98) { f.aiSpecial = 'flog'; return {}; }
        f.aiSpecial = 'grap'; return {};
      }
      if (R() < 0.12 * L.agg) { hold = { u: true, [fwd]: true }; holdT = 3; return { ...hold }; }
      if (R() < 0.15) { hold = { [back]: true }; holdT = 10; return { ...hold }; }
      hold = { [fwd]: true }; holdT = 8 + Math.floor(R() * 12); return { ...hold };
    }
    // ближний бой
    const r = R();
    if (r < 0.12) { hold = { blk: true, d: R() < 0.4 }; holdT = 18; return { ...hold }; }
    if (r < 0.16) { hold = { [back]: true }; holdT = 12; return { ...hold }; }
    if (r < 0.2) { f.aiDash = -1; return {}; }
    if (r < 0.2 + L.agg * 0.15 && f.id === 'bebop') { f.aiSpecial = 'xup'; return {}; }
    if (r < 0.25 + L.agg * 0.15 && f.id === 'lash') { f.aiSpecial = 'flog'; return {}; }
    const moves = [['lp'], ['lp'], ['hp'], ['lk'], ['hk'], ['lk', { [back]: true }], ['hk', { [back]: true }], ['lk', { d: true }], ['hk', { d: true }], ['hp', { d: true }], ['lp', { d: true }]];
    const [b, held] = pick(moves);
    return doPress(b, held || {});
  };
}
