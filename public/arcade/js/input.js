// Ввод: клавиатура (два игрока), геймпады и сенсорные кнопки. Отдаёт «зажатые» кнопки, нажатия считает движок.
// Короткое нажатие не теряется: оно запоминается (tapped, touchTap) и держится до конца кадра игры, который его прочитал.
// Кнопок атаки две: p — Рука, k — Нога; blk — Блок. Раскладка одинаковая у клавиатуры, геймпада и сенсора.
export const KEYMAP = [
  { l: ['KeyA'], r: ['KeyD'], u: ['KeyW'], d: ['KeyS'], p: ['KeyJ'], k: ['KeyK'], blk: ['Space', 'KeyL'] },
  { l: ['ArrowLeft'], r: ['ArrowRight'], u: ['ArrowUp'], d: ['ArrowDown'], p: ['Numpad1', 'Comma'], k: ['Numpad2', 'Period'], blk: ['Numpad0', 'Numpad3', 'Slash'] },
];
// Подписи кнопок для списка приёмов.
export const KEYCAP = [{ p: 'J', k: 'K', blk: 'Пробел' }, { p: ',', k: '.', blk: '/' }];

const down = new Set(), tapped = new Set();
const touch = {}, touchTap = {};
let solo = true; // в одиночной игре стрелки тоже управляют первым игроком

export function initInput(target = window) {
  target.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    const all = KEYMAP.flatMap((m) => Object.values(m).flat());
    if (all.includes(e.code)) e.preventDefault();
    down.add(e.code); if (!e.repeat) tapped.add(e.code);
  });
  target.addEventListener('keyup', (e) => down.delete(e.code));
  window.addEventListener('blur', () => { down.clear(); endFrame(); });
}
export function setSolo(v) { solo = v; }
// Вызывается после кадра игры, который прочитал ввод: запомненные короткие нажатия больше не нужны.
export function endFrame() { tapped.clear(); for (const k in touchTap) touchTap[k] = false; }

function pad(i) {
  const gp = navigator.getGamepads?.()[i];
  if (!gp || !gp.connected) return null;
  const b = (n) => !!gp.buttons[n]?.pressed, ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
  return {
    l: b(14) || ax < -0.5, r: b(15) || ax > 0.5, u: b(12) || ay < -0.6, d: b(13) || ay > 0.5,
    p: b(2) || b(3), k: b(0) || b(1), blk: b(4) || b(5) || b(6) || b(7), // X/Y — Рука, A/B — Нога, бамперы и курки — Блок
  };
}

export function readInput(side) {
  const o = {};
  const maps = solo && side === 0 ? [KEYMAP[0], KEYMAP[1]] : [KEYMAP[side]];
  for (const m of maps) for (const k in m) if (m[k].some((c) => down.has(c) || tapped.has(c))) o[k] = true;
  const p = pad(side);
  if (p) for (const k in p) if (p[k]) o[k] = true;
  if (side === 0) { for (const k in touch) if (touch[k]) o[k] = true; for (const k in touchTap) if (touchTap[k]) o[k] = true; }
  return o;
}
export const anyKey = () => down.size > 0;

// Сенсорное управление: крестовина слева (направление по углу касания) и кнопки справа.
export function bindTouch(root) {
  const padEl = root.querySelector('[data-pad]');
  const setDir = (e) => {
    const r = padEl.getBoundingClientRect(), x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2;
    const dead = r.width * 0.16;
    touch.l = x < -dead; touch.r = x > dead; touch.u = y < -dead * 1.4; touch.d = y > dead;
    padEl.dataset.dir = (touch.u ? 'u' : '') + (touch.d ? 'd' : '') + (touch.l ? 'l' : '') + (touch.r ? 'r' : '');
  };
  const clear = () => { touch.l = touch.r = touch.u = touch.d = false; padEl.dataset.dir = ''; };
  padEl.addEventListener('pointerdown', (e) => { padEl.setPointerCapture(e.pointerId); setDir(e); e.preventDefault(); });
  padEl.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') setDir(e); });
  padEl.addEventListener('pointerup', clear); padEl.addEventListener('pointercancel', clear);
  for (const btn of root.querySelectorAll('[data-btn]')) {
    const k = btn.dataset.btn;
    btn.addEventListener('pointerdown', (e) => { touch[k] = true; touchTap[k] = true; btn.classList.add('on'); btn.setPointerCapture(e.pointerId); e.preventDefault(); });
    const up = () => { touch[k] = false; btn.classList.remove('on'); };
    btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up);
  }
}
