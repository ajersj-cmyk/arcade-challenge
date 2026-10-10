#!/usr/bin/env python3
# Contact sheet / before-after composite.  python3 tools/sheet.py OUT.png img1 img2 ... [--cols=4] [--w=480]
#   before/after:  python3 tools/sheet.py OUT.png --pairs before/01-live.png after/01-live.png ...
import sys
from PIL import Image, ImageDraw, ImageFont
a = sys.argv[1:]; out = a.pop(0)
cols = int(next((x.split('=')[1] for x in a if x.startswith('--cols=')), 4)); w = int(next((x.split('=')[1] for x in a if x.startswith('--w=')), 480))
pairs = '--pairs' in a; imgs = [x for x in a if not x.startswith('--')]
if pairs: cols = 2
h = int(w * 9 / 16); lab = 22
try: font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 15)
except Exception: font = ImageFont.load_default()
rows = (len(imgs) + cols - 1) // cols
sheet = Image.new('RGB', (cols * (w + 6) + 6, rows * (h + lab + 6) + 6), (20, 20, 24))
d = ImageDraw.Draw(sheet)
for i, p in enumerate(imgs):
    im = Image.open(p).convert('RGB').resize((w, h), Image.LANCZOS)
    x = 6 + (i % cols) * (w + 6); y = 6 + (i // cols) * (h + lab + 6)
    name = p.split('/')[-1].rsplit('.', 1)[0]
    if pairs: name = ('BEFORE  ' if i % 2 == 0 else 'AFTER  ') + name
    d.text((x + 2, y + 3), name, fill=(230, 230, 230), font=font)
    sheet.paste(im, (x, y + lab))
sheet.save(out, optimize=True); print(out, sheet.size)
