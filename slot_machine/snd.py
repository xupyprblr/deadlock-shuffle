# Звуки «Казино билдов»: исходники из sound/casino/ и sound/gen/ (папка sound/ не в git) → public/snd/slots/*.mp3
# (моно, 44.1 кГц, 64 кбит/с; тишина по краям обрезается, громкость выравнивается по RMS с ограничением пика).
# Нужен PyAV: pip install av (ffmpeg внутри). Запуск: python -I slot_machine/snd.py [папка с PyAV, если ставили через --target]
import sys, os
if len(sys.argv) > 1: sys.path.insert(0, sys.argv[1])
import av
import numpy as np

SRC, OUT = 'sound/casino', 'public/snd/slots'
SR, BITRATE = 44100, 64000
# имя на сайте: (исходник, целевой RMS) — «больше» звуки чуть громче
FILES = {
    **{f'card-slide-{i}': (f'card-slide-{i}.ogg', 0.10) for i in range(1, 9)},
    **{f'card-place-{i}': (f'card-place-{i}.ogg', 0.12) for i in (1, 2, 4)},
    # выбор Алекса из генераций ElevenLabs (slot_machine/sfx.mjs → sound/gen/), джекпот — его файл
    'win-trash': ('../gen/win-trash-1.mp3', 0.10),
    'win-common': ('../gen/win-common-1.mp3', 0.09),
    'win-unique': ('../gen/win-unique-3.mp3', 0.10),
    'win-rare': ('../gen/win-rare-1.mp3', 0.11),
    'win-ultra': ('../gen/win-ultra-3.mp3', 0.12),
    'win-jackpot': ('win-jackpot.wav', 0.13),
    'coins': ('../gen/coins-1.mp3', 0.10),
    # автомат: длинные звуки выигрыша (лутбокс играет короткие win-*)
    'slot-unique': ('../gen/slot-unique-1.mp3', 0.10),
    'slot-rare': ('../gen/slot-rare-2.mp3', 0.11),
    'slot-ultra': ('../gen/slot-ultra-1.mp3', 0.12),
}
PEAK = 0.92


def load(path):
    c = av.open(path)
    rs = av.AudioResampler(format='flt', layout='mono', rate=SR)
    parts = []
    for fr in c.decode(c.streams.audio[0]):
        for o in rs.resample(fr): parts.append(o.to_ndarray()[0])
    for o in rs.resample(None): parts.append(o.to_ndarray()[0])
    c.close()
    return np.concatenate(parts).astype(np.float32)


def trim(a, db=-50):
    env = np.abs(a)
    nz = np.nonzero(env > env.max() * 10 ** (db / 20))[0]
    a = a[max(0, nz[0] - int(0.004 * SR)): nz[-1] + int(0.03 * SR)].copy()
    fi, fo = int(0.004 * SR), min(int(0.06 * SR), len(a) // 4)
    a[:fi] *= np.linspace(0, 1, fi); a[-fo:] *= np.linspace(1, 0, fo)
    return a


def save(a, path):
    c = av.open(path, 'w', format='mp3')
    s = c.add_stream('libmp3lame', rate=SR, layout='mono'); s.bit_rate = BITRATE
    fr_n = 1152
    for i in range(0, len(a), fr_n):
        chunk = a[i:i + fr_n]
        fr = av.AudioFrame.from_ndarray(chunk[None, :], format='flt', layout='mono'); fr.rate = SR
        for p in s.encode(fr): c.mux(p)
    for p in s.encode(None): c.mux(p)
    c.close()


os.makedirs(OUT, exist_ok=True)
total = 0
for name, (src, rms_t) in FILES.items():
    a = trim(load(os.path.join(SRC, src)))
    rms, peak = float(np.sqrt((a ** 2).mean())), float(np.abs(a).max())
    g = min(rms_t / rms, PEAK / peak)
    a = np.clip(a * g, -1, 1)
    dst = os.path.join(OUT, name + '.mp3')
    save(a, dst)
    kb = os.path.getsize(dst) / 1024; total += kb
    print(f'{name:14s} {len(a) / SR:5.2f}s gain {g:5.2f} {kb:5.1f} KB')
print(f'всего {total:.0f} KB')
