# Пасхалка автомата: лого канала → символ барабана public/img/slots/egg.webp (круг по красному диску, прозрачный фон).
# Запуск: python -I slot_machine/egg.py [путь к лого, по умолчанию logo.jpg в корне]
import sys
from PIL import Image, ImageDraw

SRC = sys.argv[1] if len(sys.argv) > 1 else 'logo.jpg'
OUT = 'public/img/slots/egg.webp'
R = 392  # радиус красного диска со светло-зелёным ободком, px исходника 1004×1004
SIZE = 160

im = Image.open(SRC).convert('RGB')
w, h = im.size
cx, cy = w // 2, h // 2
box = (cx - R, cy - R, cx + R, cy + R)
crop = im.crop(box).convert('RGBA')
# маска круга со сглаживанием: рисуем в 4× и уменьшаем
S = 4
m = Image.new('L', (crop.width * S, crop.height * S), 0)
ImageDraw.Draw(m).ellipse((0, 0, crop.width * S - 1, crop.height * S - 1), fill=255)
crop.putalpha(m.resize(crop.size, Image.LANCZOS))
crop.resize((SIZE, SIZE), Image.LANCZOS).save(OUT, 'WEBP', quality=88, method=6)
print(OUT, SIZE)
