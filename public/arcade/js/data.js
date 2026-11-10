// Аркада «Подвальный бой»: персонажи, позы и обычные удары. Без DOM — модуль можно гонять в Node (тесты).
// Координаты — внутреннее разрешение 384×216, ось Y вниз. x в ударах — «вперёд» по взгляду бойца.

export const W = 384, H = 216, FLOOR = 196;

// Поза — абсолютные углы в градусах. Корпус и голова: 0 — вверх, + — наклон вперёд.
// Руки и ноги: 0 — вниз, 90 — вперёд, 180 — вверх, отрицательные — назад. rot — поворот всего тела (−90 — лёжа на спине).
const P = (b, o) => ({ ...b, ...o });
export const STAND = { lean: 6, head: 0, aF: 55, fF: 150, aB: 35, fB: 145, tF: 16, sF: -4, tB: -14, sB: -22, rot: 0 };
export const CROUCH = P(STAND, { lean: 38, head: -18, aF: 75, fF: 155, aB: 55, fB: 150, tF: 98, sF: -10, tB: 58, sB: -60 });
export const JUMP = P(STAND, { lean: 12, tF: 110, sF: -15, tB: 70, sB: -50, aF: 60, fF: 140 });
export const BLOCK = P(STAND, { lean: -4, head: -6, aF: 112, fF: 172, aB: 96, fB: 170 });
export const CBLOCK = P(CROUCH, { aF: 112, fF: 172, aB: 96, fB: 170 });
export const HIT = P(STAND, { lean: -28, head: -25, aF: -25, fF: 25, aB: -45, fB: -5, tF: 24, sF: 10, tB: -22, sB: -28 });
export const DIZZY = P(STAND, { lean: -12, head: -20, aF: 15, fF: 40, aB: 5, fB: 30 });
export const KNOCK = P(HIT, { rot: -40, tF: 50, sF: 30, tB: 20, sB: 0 });
export const DOWN = P(STAND, { rot: -90, lean: 0, head: 0, aF: 15, fF: 50, aB: -15, fB: 15, tF: 8, sF: 0, tB: -4, sB: 0 });
export const WIN = P(STAND, { lean: -4, head: -8, aF: 168, fF: 178, aB: 30, fB: 120 });
export const BEAM = P(STAND, { lean: 10, aF: 92, fF: 90, aB: 88, fB: 92, tF: 30, sF: 10, tB: -30, sB: -30 });

// Обычные удары. s/a/r — кадры замаха, активной фазы и восстановления (60 кадров = 1 с).
// hb — зона удара относительно точки опоры бойца; kind: high (над присевшим проходит мимо), mid, low (только присев блок),
// over (из прыжка — только стоячий блок). kd — сбивает с ног (скорость отлёта).
export const MOVES = {
  lp: { s: 6, a: 3, r: 10, dmg: 3, adv: 3, ret: 3, hb: { x: 8, y: -66, w: 30, h: 14 }, kind: 'mid', hs: 15, kb: 1.6, pose: P(STAND, { lean: 12, aF: 92, fF: 90, aB: 50, fB: 150 }) },
  hp: { s: 8, a: 4, r: 14, dmg: 5, hb: { x: 10, y: -78, w: 30, h: 14 }, kind: 'high', hs: 20, kb: 2.4, pose: P(STAND, { lean: 16, aF: 120, fF: 122, aB: 20, fB: 90 }) },
  lk: { s: 9, a: 4, r: 14, dmg: 5, adv: 8, ret: 8, hb: { x: 8, y: -44, w: 34, h: 14 }, kind: 'mid', hs: 18, kb: 2.2, pose: P(STAND, { lean: -12, tF: 88, sF: 92, tB: -8, sB: -8, aF: 40, fF: 120 }) },
  hk: { s: 11, a: 4, r: 18, dmg: 7, adv: 8, ret: 8, hb: { x: 8, y: -78, w: 34, h: 18 }, kind: 'mid', hs: 22, kb: 3, pose: P(STAND, { lean: -32, head: -10, tF: 150, sF: 168, tB: -6, sB: -6, aF: 70, fF: 120, aB: -20, fB: 30 }) },
  round: { s: 18, a: 5, r: 24, dmg: 9, adv: 10, ret: 10, hb: { x: 6, y: -82, w: 38, h: 24 }, kind: 'high', hs: 25, kb: 3, kd: { vx: 2.1, vy: -3.2 }, pose: P(STAND, { lean: -32, head: -15, tF: 150, sF: 162, tB: -6, sB: -6, aF: -30, fF: 0, aB: 60, fB: 90 }) },
  sweep: { s: 15, a: 5, r: 26, dmg: 6, adv: 6, ret: 6, hb: { x: 4, y: -12, w: 42, h: 12 }, kind: 'low', hs: 25, kb: 1, kd: { vx: 0.8, vy: -2 }, crouch: true, pose: P(CROUCH, { tF: 88, sF: 90, tB: 70, sB: -80, lean: 30 }) },
  clp: { s: 6, a: 3, r: 10, dmg: 3, hb: { x: 8, y: -46, w: 30, h: 14 }, kind: 'mid', hs: 15, kb: 1.6, crouch: true, pose: P(CROUCH, { aF: 92, fF: 90 }) },
  up: { s: 14, a: 6, r: 28, dmg: 10, adv: 6, hb: { x: 2, y: -98, w: 28, h: 64 }, kind: 'mid', hs: 36, kb: 1, kd: { vx: 1.3, vy: -5.7 }, crouch: true, from: CROUCH, to: STAND, pose: P(STAND, { lean: 4, head: -8, aF: 170, fF: 178, aB: 40, fB: 150 }) },
  clk: { s: 7, a: 3, r: 12, dmg: 3, hb: { x: 6, y: -12, w: 36, h: 10 }, kind: 'low', hs: 15, kb: 1.6, crouch: true, pose: P(CROUCH, { tF: 85, sF: 88 }) },
  chk: { s: 10, a: 4, r: 16, dmg: 5, hb: { x: 6, y: -16, w: 42, h: 12 }, kind: 'low', hs: 20, kb: 2.4, crouch: true, pose: P(CROUCH, { tF: 80, sF: 84, lean: 30 }) },
  jp: { s: 6, a: 16, r: 0, dmg: 5, hb: { x: 6, y: -64, w: 28, h: 22 }, kind: 'over', hs: 20, kb: 2, air: true, pose: P(JUMP, { aF: 62, fF: 55 }) },
  jk: { s: 7, a: 18, r: 0, dmg: 7, hb: { x: 6, y: -48, w: 32, h: 22 }, kind: 'over', hs: 22, kb: 2.6, air: true, pose: P(JUMP, { tF: 62, sF: 55, tB: 100, sB: 0 }) },
};

// Удары бойца: общая таблица MOVES плюс свои поправки. У Bebop главный удар — шар: длинный выпад рукой и урон выше.
const OWN = { bebop: { lp: { s: 7, dmg: 4, adv: 8, ret: 8 } }, lash: {} };
export const MV = Object.fromEntries(Object.entries(OWN).map(([id, own]) => [id, Object.fromEntries(Object.entries(MOVES).map(([n, m]) => [n, { ...m, ...own[n] }]))]));

// Спецприёмы — способности героев. Последовательность: F — к сопернику, B — от него, D — вниз.
// Кнопки: lp/hp — нижний/верхний рукой, lk/hk — нижний/верхний ногой. ult — нужна полная шкала.
export const SPECIALS = {
  bebop: [
    { id: 'beam', seq: ['D', 'D', 'F'], btn: 'hp', ult: true, name: 'Hyper Beam', icon: 'bebop/bebop_hyper_beam.webp', desc: 'Гигантский луч через весь экран. Нужна полная шкала.' },
    { id: 'hook', seq: ['B', 'F'], btn: 'lp', name: 'Grapple Arm', icon: 'bebop/bebop_hook.webp', desc: 'Рука-захват: притягивает соперника, он на миг оглушён.' },
    { id: 'bomb', seq: ['D', 'F'], btn: 'hp', name: 'Sticky Bomb', icon: 'bebop/bebop_sticky_bomb.webp', desc: 'Липкая бомба: цепляется и взрывается через секунду.' },
    { id: 'xup', seq: ['F', 'F'], btn: 'hp', name: 'Exploding Uppercut', icon: 'bebop/bebop_uppercut.webp', desc: 'Взрывной апперкот, подбрасывает высоко.' },
  ],
  lash: [
    { id: 'slam', seq: ['D', 'D', 'F'], btn: 'hp', ult: true, name: 'Death Slam', icon: 'lash/lash_counter_lash.webp', desc: 'Хлыст поднимает соперника и трижды бьёт о землю. Нужна полная шкала.' },
    { id: 'grap', seq: ['B', 'F'], btn: 'lk', air: true, name: 'Grapple', icon: 'lash/lash_lash.webp', desc: 'Рывок на хлысте с ударом ногой. Можно в прыжке.' },
    { id: 'flog', seq: ['D', 'F'], btn: 'lp', name: 'Flog', icon: 'lash/lash_flog.webp', desc: 'Хлыст на полэкрана, лечит Lash.' },
    { id: 'gstrike', hold: 'd', btn: 'hk', airOnly: true, name: 'Ground Strike', icon: 'lash/lash_death_slam.webp', desc: 'В прыжке: удар о землю, урон растёт с высотой.' },
  ],
};

// Зоны ударов под нарисованные позы: кулак, шар или стопа в активной фазе лежат в зоне, зона выходит за арт не больше чем на 2 px.
// x — от точки опоры вперёд, y — от пола вверх (отрицательные). Если удара нет в списке — зона из MOVES / спецприёма.
// Проверка: каждый обычный удар достаёт стоящего соперника с минимальной дистанции (тест в scripts/test-arcade.mjs).
const B = (x, y, w, h) => ({ x, y, w, h });
export const HB = {
  bebop: {
    lp: B(10, -76, 39, 18), hp: B(12, -96, 36, 20), lk: B(8, -44, 38, 16), hk: B(8, -54, 36, 16), round: B(8, -56, 37, 20),
    sweep: B(6, -22, 41, 14), clp: B(20, -62, 41, 20), up: B(0, -110, 44, 66), clk: B(6, -28, 46, 14), chk: B(6, -28, 42, 16),
    jp: B(14, -54, 33, 26), jk: B(8, -20, 33, 22), xup: B(0, -112, 44, 74),
  },
  lash: {
    lp: B(10, -64, 35, 14), hp: B(10, -78, 32, 14), lk: B(8, -45, 40, 14), hk: B(8, -56, 38, 16), round: B(8, -58, 39, 20),
    sweep: B(6, -22, 42, 14), clp: B(14, -41, 37, 14), up: B(2, -92, 38, 56), clk: B(6, -26, 42, 14), chk: B(6, -24, 42, 14),
    jp: B(10, -34, 31, 18), jk: B(8, -18, 34, 20), grap: B(10, -53, 32, 38),
  },
};

// Персонажи. walk — скорость ходьбы вперёд и назад, jump — толчок прыжка, push — полуширина тела для расталкивания
// (минимальная дистанция между бойцами — сумма их push), power — множитель урона обычных ударов: Bebop крупнее и медленнее,
// в него проще попасть, зато бьёт он тяжелее. Цвета col/alt остались от прототипа.
export const CHARS = {
  bebop: {
    name: 'Bebop', card: 'bebop_card.webp', small: 'bebop_sm.webp',
    dim: { th: 18, sh: 18, torso: 27, ua: 13, fa: 14, head: 8, w: 13 },
    walk: [1.2, 0.95], jump: 5.1, push: 30, power: 1.25,
    col: { body: '#d9622b', body2: '#a8441c', metal: '#4b4b52', yellow: '#f0b83a', cloth: '#8a7a4a', eye: '#60f0e8', ball: '#3a2a22' },
    alt: { body: '#5f8fd9', body2: '#3a5f9e', metal: '#3c3f4a', yellow: '#d9d9d9', cloth: '#4a4a3a', eye: '#ff6a4a', ball: '#262626' },
  },
  lash: {
    name: 'Lash', card: 'lash_card.webp', small: 'lash_sm.webp',
    dim: { th: 18, sh: 18, torso: 25, ua: 13, fa: 13, head: 8, w: 11 },
    walk: [1.35, 1.05], jump: 5.45, push: 26, power: 1,
    col: { skin: '#d39a72', shirt: '#3c6fb5', pants: '#3d3028', boot: '#6b3f22', hair: '#2a1c14', strap: '#5a3a1e', wrap: '#e8e0d0' },
    alt: { skin: '#c48a64', shirt: '#b53c3c', pants: '#2a2a30', boot: '#3a2a20', hair: '#5a3a1a', strap: '#2a1a10', wrap: '#ffd27a' },
  },
};
