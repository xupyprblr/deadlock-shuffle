// Звук режима «Крутить билд». Всё синтезируется в браузере (Web Audio), файлов не нужно.
// Любой звук можно заменить файлом: положить его в public/snd/slots/ и вписать в FILES ниже —
// тогда вместо синтеза играет файл (mp3 или ogg). Ключи: lever, spin-loop, reel-stop, tick, win-trash, win-common,
// win-unique, win-rare, win-ultra, win-jackpot, coins, crate-shake, crate-open, card-flip. Петли: spin-loop, crate-shake.
const FILES = {
  // lever: 'snd/slots/lever.mp3',
  // 'spin-loop': 'snd/slots/spin-loop.mp3',
};
const VOL = 0.9; // общая громкость

let AC = null, out = null, noiseBuf = null, enabled = true;
const bufs = {}, loops = {};

function ctx() {
  if (!enabled) return null;
  if (!AC) {
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
    const comp = AC.createDynamicsCompressor();
    out = AC.createGain(); out.gain.value = VOL; out.connect(comp).connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    for (const [k, url] of Object.entries(FILES)) fetch(url).then((r) => r.arrayBuffer()).then((b) => AC.decodeAudioData(b)).then((b) => { bufs[k] = b; }).catch(() => {});
  }
  if (AC.state === 'suspended') AC.resume();
  return AC;
}

// ---------- кирпичики ----------
const hz = (m) => 440 * 2 ** ((m - 69) / 12); // нота MIDI → частота
// тон f0 → f1 за dur; vib — вибрато [частота, глубина в Гц]; cut — срез фильтра
function tone(f0, dur, { type = 'square', vol = 0.08, f1 = f0, at = 0, attack = 0.004, cut = 0, vib = null, dest = out } = {}) {
  const t = AC.currentTime + at, o = AC.createOscillator(), v = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  if (vib) { const l = AC.createOscillator(), lg = AC.createGain(); l.frequency.value = vib[0]; lg.gain.value = vib[1]; l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + dur + 0.05); }
  v.gain.setValueAtTime(0.0001, t); v.gain.linearRampToValueAtTime(vol, t + attack); v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let n = o;
  if (cut) { const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cut; n = o.connect(f); }
  n.connect(v).connect(dest); o.start(t); o.stop(t + dur + 0.05);
}
// шум через фильтр freq → freq1
function noise(dur, { vol = 0.2, freq = 1200, freq1 = freq, type = 'lowpass', q = 1, at = 0, attack = 0.002, dest = out } = {}) {
  const t = AC.currentTime + at, s = AC.createBufferSource(), f = AC.createBiquadFilter(), v = AC.createGain();
  s.buffer = noiseBuf; s.loop = true; f.type = type; f.Q.value = q; f.frequency.setValueAtTime(freq, t);
  if (freq1 !== freq) f.frequency.exponentialRampToValueAtTime(freq1, t + dur);
  v.gain.setValueAtTime(0.0001, t); v.gain.linearRampToValueAtTime(vol, t + attack); v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(v).connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.05);
}
// колокольчик: негармонические обертоны, долгий спад
function bell(f, { at = 0, vol = 0.06, dur = 0.9 } = {}) {
  for (const [k, g, d] of [[1, 1, 1], [2.76, 0.45, 0.6], [5.4, 0.25, 0.35], [8.93, 0.12, 0.2]]) tone(f * k, dur * d, { type: 'sine', vol: vol * g, at, attack: 0.002 });
}
// металлический «дзынь» монеты
function clink(at, vol = 0.05) {
  const f = 2600 + Math.random() * 2600;
  tone(f, 0.12 + Math.random() * 0.12, { type: 'sine', vol, at, attack: 0.001 });
  tone(f * 1.48, 0.08, { type: 'sine', vol: vol * 0.6, at, attack: 0.001 });
  noise(0.02, { vol: vol * 0.8, freq: 7000, type: 'highpass', at });
}
// буфер из функции sample(t) — для петель
function makeBuf(dur, fn) {
  const n = Math.ceil(AC.sampleRate * dur), b = AC.createBuffer(1, n, AC.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = fn(i / AC.sampleRate);
  return b;
}
// щелчок/стук: затухающий шум с простым фильтром (для петель)
function clickTrain(dur, hits, { decay = 140, tone: f = 0, lp = 0.35, vol = 0.6, bed = 0.05, bedLp = 0.04 } = {}) {
  let y = 0, yb = 0;
  return makeBuf(dur, (t) => {
    let s = 0;
    for (const h of hits) { const dt = t - h; if (dt >= 0 && dt < 0.08) s += Math.exp(-dt * decay) * ((Math.random() * 2 - 1) + (f ? Math.sin(2 * Math.PI * f * dt) : 0)); }
    y += lp * (s - y);
    yb += bedLp * ((Math.random() * 2 - 1) - yb);
    return y * vol + yb * bed * 6;
  });
}
const loopBufs = {};
function synthLoop(name) {
  if (loopBufs[name]) return loopBufs[name];
  if (name === 'spin-loop') // барабаны: мерный механический стрекот + низкий гул
    loopBufs[name] = clickTrain(0.5, [0, 0.125, 0.25, 0.375].map((h) => h + Math.random() * 0.01), { decay: 160, tone: 1400, lp: 0.4, vol: 0.5, bed: 0.06 });
  else if (name === 'crate-shake') // сундук: неровный деревянный стук
    loopBufs[name] = clickTrain(0.48, [0, 0.07, 0.16, 0.2, 0.31, 0.38, 0.43], { decay: 70, tone: 220, lp: 0.12, vol: 1.1, bed: 0.03 });
  return loopBufs[name];
}

// ---------- эффекты ----------
const SYN = {
  lever: () => {
    for (let i = 0; i < 6; i++) noise(0.018, { vol: 0.22, freq: 3800, type: 'bandpass', q: 3, at: i * 0.038 }); // трещотка
    tone(320, 0.32, { type: 'triangle', vol: 0.05, f1: 140, vib: [22, 30], at: 0.05 }); // пружина
    noise(0.12, { vol: 0.35, freq: 700, freq1: 160, at: 0.24 }); tone(95, 0.18, { type: 'sine', vol: 0.3, f1: 48, at: 0.24 }); // удар в упор
  },
  tick: () => { tone(1900, 0.022, { vol: 0.03 }); noise(0.012, { vol: 0.05, freq: 6000, type: 'highpass' }); },
  'reel-stop': (e) => {
    const i = e?.i || 0;
    noise(0.12, { vol: 0.38, freq: 1100, freq1: 220 });
    tone(118 - i * 14, 0.16, { type: 'sine', vol: 0.32, f1: 52 });
    tone(2300 - i * 200, 0.035, { type: 'square', vol: 0.025, cut: 4000 });
  },
  'win-trash': () => { // «вау-вау-вау-ваааа»
    [55, 54, 53].forEach((m, i) => tone(hz(m), 0.3, { type: 'sawtooth', vol: 0.07, cut: 900, at: i * 0.32, attack: 0.03 }));
    tone(hz(52), 1.0, { type: 'sawtooth', vol: 0.07, cut: 800, at: 0.96, attack: 0.03, vib: [6, 5] });
  },
  'win-common': () => bell(hz(84), { vol: 0.07 }),
  'win-unique': () => { bell(hz(84), { vol: 0.06 }); bell(hz(88), { vol: 0.07, at: 0.12, dur: 1.1 }); },
  'win-rare': () => {
    [84, 88, 91, 96].forEach((m, i) => bell(hz(m), { vol: 0.055, at: i * 0.08, dur: i === 3 ? 1.3 : 0.7 }));
    noise(0.9, { vol: 0.05, freq: 7000, freq1: 11000, type: 'highpass', at: 0.25, attack: 0.15 }); // искры
  },
  'win-ultra': () => { // фанфара
    [[67, 0], [72, 0.13], [76, 0.26]].forEach(([m, at]) => tone(hz(m), 0.16, { type: 'sawtooth', vol: 0.06, cut: 2600, at }));
    for (const m of [72, 76, 79, 84]) tone(hz(m), 1.1, { type: 'sawtooth', vol: 0.045, cut: 2400, at: 0.4, attack: 0.02, vib: [5, 3] });
    tone(hz(48), 1.1, { type: 'triangle', vol: 0.12, at: 0.4 });
    bell(hz(96), { vol: 0.05, at: 0.4, dur: 1.2 });
  },
  'win-jackpot': () => {
    for (let i = 0; i < 14; i++) bell(hz(i % 2 ? 91 : 88), { vol: 0.05, at: i * 0.075, dur: 0.5 }); // звонок джекпота
    [72, 76, 79, 84, 79, 84, 88].forEach((m, i) => tone(hz(m), i === 6 ? 1.2 : 0.14, { type: 'square', vol: 0.045, cut: 3200, at: 1.05 + i * 0.12 }));
    for (const m of [60, 64, 67]) tone(hz(m), 1.4, { type: 'sawtooth', vol: 0.04, cut: 1800, at: 1.77, attack: 0.03 });
    tone(hz(36), 1.4, { type: 'sine', vol: 0.18, at: 1.77 });
  },
  coins: () => { // монеты сыплются: часто в начале, реже к концу
    for (let i = 0; i < 46; i++) { const at = Math.pow(Math.random(), 1.6) * 2.6; clink(at, 0.025 + Math.random() * 0.03); }
  },
  'crate-open': () => {
    noise(0.08, { vol: 0.4, freq: 2500, type: 'highpass' });
    tone(85, 0.35, { type: 'sine', vol: 0.32, f1: 40 });
    noise(0.45, { vol: 0.14, freq: 500, freq1: 3600, type: 'bandpass', q: 1.2, at: 0.03 }); // свист
    for (const [i, m] of [79, 84, 88, 91].entries()) tone(hz(m), 0.9, { type: 'sine', vol: 0.03, at: 0.08 + i * 0.03, attack: 0.05 }); // сияние
  },
  'card-flip': () => { noise(0.07, { vol: 0.12, freq: 1800, freq1: 4200, type: 'bandpass', q: 1.5 }); tone(900, 0.04, { type: 'triangle', vol: 0.03, f1: 1400, at: 0.03 }); },
};

// ---------- API ----------
export function play(name, e) {
  if (!ctx()) return;
  if (bufs[name]) {
    const s = AC.createBufferSource(); s.buffer = bufs[name];
    if (name === 'reel-stop') s.playbackRate.value = 1 - (e?.i || 0) * 0.06; // три барабана — три чуть разных удара
    s.connect(out); s.start();
  } else SYN[name]?.(e);
}
// петля: loop(name, true/false), плавные края. id — несколько копий одной петли (у каждого барабана своя),
// rate — скорость/высота (1 — как записано)
export function loop(name, on, { id = '', rate = 1, vol = 1 } = {}) {
  const key = name + id;
  if (!on) {
    const l = loops[key]; if (!l) return;
    delete loops[key];
    try { const t = AC.currentTime; l.g.gain.cancelScheduledValues(t); l.g.gain.setValueAtTime(l.g.gain.value, t); l.g.gain.linearRampToValueAtTime(0, t + 0.08); l.s.stop(t + 0.1); } catch {}
    return;
  }
  if (loops[key] || !ctx()) return;
  const s = AC.createBufferSource(), g = AC.createGain();
  s.buffer = bufs[name] || synthLoop(name); s.loop = true; s.playbackRate.value = rate;
  const t = AC.currentTime, v = (bufs[name] ? 0.8 : 0.5) * vol;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.08);
  s.connect(g).connect(out); s.start(t, Math.random() * s.buffer.duration);
  loops[key] = { s, g, base: rate, v };
}
// замедление петли вместе с барабаном: k от 1 (полный ход) до 0 (стоит)
export function loopSpeed(name, id, k) {
  const l = loops[name + id]; if (!l) return;
  const t = AC.currentTime;
  l.s.playbackRate.setTargetAtTime(l.base * (0.45 + 0.55 * k), t, 0.03);
  l.g.gain.setTargetAtTime(l.v * (0.5 + 0.5 * k), t, 0.03);
}
export function setSound(on) {
  enabled = on;
  if (!on) for (const k of Object.keys(loops)) loop(k, false);
}
