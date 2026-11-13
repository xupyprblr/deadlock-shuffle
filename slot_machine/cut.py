"""Нарезка арта «Крутить билд» из slot_machine/raw/ в public/img/slots/*.webp.

Запуск из корня репозитория: python -I slot_machine/cut.py
Нужен Pillow. Исходники (raw/) в git не лежат; выбранные варианты заданы ниже.
Замеры окон барабанов, табло и рычага пишутся в slot_machine/layout.json (в процентах от cabinet.webp).
"""
import json
import os
from PIL import Image

RAW = 'slot_machine/raw'
OUT = 'public/img/slots'
PICK = {'cabinet': 'v1', 'lever': 'v1', 'lootbox': 'v2', 'symbols': 'v2', 'card': 'v1'}
Q = 85
os.makedirs(OUT, exist_ok=True)


def load(name):
    return Image.open(f'{RAW}/{name}.png').convert('RGBA')


def bbox(im, thr=24):
    return im.getchannel('A').point(lambda v: 255 if v > thr else 0).getbbox()


def save(im, name, q=Q):
    path = f'{OUT}/{name}.webp'
    im.save(path, 'WEBP', quality=q, method=6)
    return path


def scale(im, k):
    return im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)


def runs(flags):
    out, s = [], None
    for i, f in enumerate(flags + [False]):
        if f and s is None:
            s = i
        elif not f and s is not None:
            out.append((s, i))
            s = None
    return out


# ---------- корпус: стираем нарисованный рычаг (всё правее корпуса в зоне рычага) ----------
cab = load(f'01-cabinet-{PICK["cabinet"]}')
CUT_X, CUT_Y0, CUT_Y1 = 899, 470, 1010  # правый край корпуса ~x893-897, рычаг и втулка правее
px = cab.load()
for y in range(CUT_Y0, CUT_Y1):
    for x in range(CUT_X, cab.width):
        px[x, y] = (0, 0, 0, 0)
cb = bbox(cab)
cab = cab.crop(cb)
W, H = cab.size


def pct(x0, y0, x1, y1):
    return {'left': round(100 * x0 / W, 2), 'top': round(100 * y0 / H, 2),
            'width': round(100 * (x1 - x0) / W, 2), 'height': round(100 * (y1 - y0) / H, 2)}


def dark(p, lim):
    return p[3] > 200 and max(p[:3]) < lim


cpx = cab.load()


def dark_box(x0, y0, x1, y1, lim):
    """Внутренний прямоугольник тёмной области: по строке/столбцу через её центр."""
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    xs = [x for x in range(x0, x1) if dark(cpx[x, cy], lim)]
    ys = [y for y in range(y0, y1) if dark(cpx[cx, y], lim)]
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1


# окна барабанов: строка через середину окна, три длинных тёмных отрезка
mid = round(0.47 * H)
row = [dark(cpx[x, mid], 30) for x in range(W)]
wins = [r for r in runs(row) if r[1] - r[0] > W * 0.12][:3]
assert len(wins) == 3, wins
reels = []
for x0, x1 in wins:
    bx = dark_box(x0, 0, x1, H, 30)
    # по вертикали ищем через центр окна, ограничивая зону окна
    cx = (x0 + x1) // 2
    col = [dark(cpx[cx, y], 30) for y in range(H)]
    y0, y1 = max((r for r in runs(col) if r[0] <= mid < r[1]))
    reels.append(pct(x0, y0, x1, y1))

# табло: тёмный прямоугольник под окнами
plate_y = round(0.69 * H)
row = [W * 0.15 < x < W * 0.85 and dark(cpx[x, plate_y], 60) for x in range(W)]
px0, px1 = max(runs(row), key=lambda r: r[1] - r[0])
cx = (px0 + px1) // 2
col = [dark(cpx[cx, y], 60) for y in range(H)]
py0, py1 = next(r for r in runs(col) if r[0] <= plate_y < r[1])
plate = pct(px0, py0, px1, py1)

# лампы на вывеске: яркие пятна в верхних 12% корпуса (простая заливка по связности)
seen, bulbs = set(), []
for y in range(round(H * 0.12)):
    for x in range(W):
        if (x, y) in seen:
            continue
        p = cpx[x, y]
        if p[3] < 200 or sum(p[:3]) < 690:
            continue
        stack, pts = [(x, y)], []
        seen.add((x, y))
        while stack:
            qx, qy = stack.pop()
            pts.append((qx, qy))
            for nx, ny in ((qx + 1, qy), (qx - 1, qy), (qx, qy + 1), (qx, qy - 1)):
                if 0 <= nx < W and 0 <= ny < H * 0.12 and (nx, ny) not in seen:
                    q = cpx[nx, ny]
                    if q[3] >= 200 and sum(q[:3]) >= 690:
                        seen.add((nx, ny))
                        stack.append((nx, ny))
        if len(pts) > 80:
            bx = sum(p[0] for p in pts) / len(pts)
            by = sum(p[1] for p in pts) / len(pts)
            bulbs.append({'x': round(100 * bx / W, 2), 'y': round(100 * by / H, 2)})
bulbs.sort(key=lambda b: b['x'])

save(cab, 'cabinet', 80)  # самый тяжёлый файл, 80 укладывает набор в бюджет ~600 КБ

# ---------- рычаг: два кадра в общей рамке, выровненной по левому краю пластины ----------
lv = load(f'02-lever-{PICK["lever"]}')
halves = [lv.crop((0, 0, lv.width // 2, lv.height)), lv.crop((lv.width // 2, 0, lv.width, lv.height))]
plate_x = []
for h in halves:
    b = bbox(h, 120)
    plate_x.append(b[0])  # пластина самая левая часть рычага
ub = [bbox(h) for h in halves]
left = min(b[0] - px for b, px in zip(ub, plate_x))
right = max(b[2] - px for b, px in zip(ub, plate_x))
top = min(b[1] for b in ub)
bot = max(b[3] for b in ub)
frames = [h.crop((px + left, top, px + right, bot)) for h, px in zip(halves, plate_x)]
# масштаб: высота верхнего рычага (шар..низ пластины) как у нарисованного на корпусе, ~430 px исходника
k = 430 / (ub[0][3] - ub[0][1])
frames = [scale(f, k) for f in frames]
save(frames[0], 'lever-up')
save(frames[1], 'lever-down')
# пластина рычага садится на правый край корпуса; верх кадра на уровне верха шара нарисованного рычага
LEVER_X, LEVER_Y = 880 - cb[0] + round(left * k), 520 - cb[1] - round((ub[0][1] - top) * k)
lever = pct(LEVER_X, LEVER_Y, LEVER_X + frames[0].width, LEVER_Y + frames[0].height)

# ---------- лутбокс: три элемента по связным областям ----------
lb = load(f'03-lootbox-{PICK["lootbox"]}')
a = lb.getchannel('A').point(lambda v: 255 if v > 24 else 0)
# крышка сверху, сундуки снизу: делим по пустой полосе
rows_full = [a.crop((0, y, lb.width, y + 1)).getbbox() is not None for y in range(lb.height)]
bands = [r for r in runs(rows_full) if r[1] - r[0] > 40]
lid_band, box_band = bands[0], bands[-1]
lid = lb.crop((0, lid_band[0], lb.width, lid_band[1]))
lid = lid.crop(bbox(lid))
boxes = lb.crop((0, box_band[0], lb.width, lb.height))
cols_full = [boxes.getchannel('A').point(lambda v: 255 if v > 24 else 0).crop((x, 0, x + 1, boxes.height)).getbbox() is not None for x in range(boxes.width)]
parts = [r for r in runs(cols_full) if r[1] - r[0] > 100]
closed = boxes.crop((parts[0][0], 0, parts[0][1], boxes.height))
opened = boxes.crop((parts[1][0], 0, parts[1][1], boxes.height))  # только полоса сундуков, без отдельной крышки
closed, opened = closed.crop(bbox(closed)), opened.crop(bbox(opened))
# общая рамка для closed/open: низ и центр совпадают, чтобы смена кадра не прыгала
CW, CH = max(closed.width, opened.width), max(closed.height, opened.height)


def frame(im):
    f = Image.new('RGBA', (CW, CH), (0, 0, 0, 0))
    f.alpha_composite(im, ((CW - im.width) // 2, CH - im.height))
    return f


kc = 520 / CW
fc = frame(closed)
save(scale(fc, kc), 'crate-closed')
save(scale(frame(opened), kc), 'crate-open')
# отдельная крышка не используется: у открытого сундука она уже нарисована откинутой
if os.path.exists(f'{OUT}/crate-lid.webp'):
    os.remove(f'{OUT}/crate-lid.webp')
# медальон закрытого сундука: тёмный круг по центру, ниже крышки
fp = fc.load()
mx = CW // 2
# заливка тёмной области от точки внутри круга (центр по x, 3/4 высоты закрытого сундука), рамка заливки — медальон
def inner(c):  # серый фон медальона; чёрный контур (<22) и цветные детали не берём
    return c[3] > 200 and min(c[:3]) >= 22 and max(c[:3]) <= 62 and max(c[:3]) - min(c[:3]) < 16


seed = (mx, round(CH * 0.75))
assert inner(fp[seed]), fp[seed]
stack, seen = [seed], {seed}
while stack:
    x, y = stack.pop()
    for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
        if (nx, ny) not in seen and 0 <= nx < CW and 0 <= ny < CH and inner(fp[nx, ny]):
            seen.add((nx, ny))
            stack.append((nx, ny))
mr = (min(p[0] for p in seen), max(p[0] for p in seen) + 1)
my0, my1 = min(p[1] for p in seen), max(p[1] for p in seen)
crate = {'frame': [round(CW * kc), round(CH * kc)],
         'medal': {'x': round(100 * (mr[0] + mr[1]) / 2 / CW, 2), 'y': round(100 * (my0 + my1) / 2 / CH, 2),
                   'd': round(100 * (mr[1] - mr[0]) / CW, 2)}}

# ---------- символы: сетка 3x3 ----------
sy = load(f'04-symbols-{PICK["symbols"]}')
sa = sy.getchannel('A').point(lambda v: 255 if v > 60 else 0)
colf = [sa.crop((x, 0, x + 1, sy.height)).getbbox() is not None for x in range(sy.width)]
rowf = [sa.crop((0, y, sy.width, y + 1)).getbbox() is not None for y in range(sy.height)]
cs = [r for r in runs(colf) if r[1] - r[0] > 100]
rs = [r for r in runs(rowf) if r[1] - r[0] > 100]
assert len(cs) == 3 and len(rs) == 3, (cs, rs)
names = [['sym-weapon', 'sym-spirit', 'sym-vitality'],
         ['rar-trash', 'rar-common', 'rar-unique'],
         ['rar-rare', 'rar-ultra', 'rar-legendary']]
for ri, (y0, y1) in enumerate(rs):
    for ci, (x0, x1) in enumerate(cs):
        t = sy.crop((x0, y0, x1, y1))
        t = t.crop(bbox(t))
        side = max(t.size)
        sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        sq.alpha_composite(t, ((side - t.width) // 2, (side - t.height) // 2))
        save(sq.resize((160, 160), Image.LANCZOS), names[ri][ci])

# ---------- рубашка карты ----------
cd = load(f'05-card-back-{PICK["card"]}')
cd = cd.crop(bbox(cd, 200))  # высокий порог: отрезаем цветные ореолы по краю
cd = scale(cd, 420 / cd.width)
# Карта на сайте выше рисунка, поэтому рубашка собирается из частей (css .lc-back):
# верх и низ рамки, боковые кромки (повторяются по высоте), медальон по центру, полосатый фон — CSS.
# Тёмный полосатый фон внутри частей делаем прозрачным заливкой от затравок, чтобы швов не было.
if os.path.exists(f'{OUT}/card-back.webp'):
    os.remove(f'{OUT}/card-back.webp')
CW_, CH_ = cd.size
EDGE, TOP, MED = 31, 62, (12, 60, 408, 494)  # толщина боковой рамки, высота верх/низ, рамка медальона (px при ширине 420)


def clear_dark(im, seeds, lim=58):
    im = im.copy()
    p = im.load()
    w, h = im.size
    stack = [s for s in seeds if max(p[s][:3]) < lim]
    seen = set(stack)
    while stack:
        x, y = stack.pop()
        p[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in seen and p[nx, ny][3] > 0 and max(p[nx, ny][:3]) < lim:
                seen.add((nx, ny))
                stack.append((nx, ny))
    return im


top = clear_dark(cd.crop((0, 0, CW_, TOP)), [(x, TOP - 1) for x in range(EDGE + 2, CW_ - EDGE - 2, 6)])
bot = clear_dark(cd.crop((0, CH_ - TOP, CW_, CH_)), [(x, 0) for x in range(EDGE + 2, CW_ - EDGE - 2, 6)])
side = cd.crop((0, 180, CW_, 240))
sp = side.load()
for y in range(side.height):
    for x in range(EDGE, CW_ - EDGE):
        sp[x, y] = (0, 0, 0, 0)
med = cd.crop(MED)
mw, mh = med.size
med = clear_dark(med, [(x, 0) for x in range(0, mw, 3)] + [(x, mh - 1) for x in range(0, mw, 3)] + [(0, y) for y in range(0, mh, 3)] + [(mw - 1, y) for y in range(0, mh, 3)])
save(top, 'card-top')
save(bot, 'card-bot')
save(side, 'card-side')
save(med, 'card-medal')
card = {'size': [CW_, CH_], 'top': TOP, 'edge': EDGE, 'medal': [MED[2] - MED[0], MED[3] - MED[1]]}

layout = {'cabinet': [W, H], 'reels': reels, 'plate': plate, 'lever': lever, 'bulbs': bulbs, 'crate': crate, 'card': card}
with open('slot_machine/layout.json', 'w', encoding='utf-8') as f:
    json.dump(layout, f, indent=1)
print(json.dumps(layout, indent=1))
tot = 0
for n in sorted(os.listdir(OUT)):
    s = os.path.getsize(f'{OUT}/{n}')
    tot += s
    print(f'{n:22} {Image.open(f"{OUT}/{n}").size}  {s // 1024} KB')
print('итого', tot // 1024, 'KB')
