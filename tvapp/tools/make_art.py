#!/usr/bin/env python3
"""Generate the Android TV launcher banner (320x180) and launcher icons in the arcade neon style.

Run from repo root:  python3 tvapp/tools/make_art.py
Needs Pillow and the Press Start 2P + Orbitron fonts (paths below; override with env FONT_PIXEL / FONT_TECH).
Outputs are committed, so this only needs re-running when the art changes.
"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'src', 'main', 'res')
GF = '/usr/share/fonts/truetype/sand-box/google'
FONT_PIXEL = os.environ.get('FONT_PIXEL', GF + '/Press Start 2P/PressStart2P-Regular.ttf')
FONT_TECH = os.environ.get('FONT_TECH', GF + '/Orbitron/Orbitron-VariableFont_wght.ttf')

BG_TOP, BG_BOT = (6, 4, 22), (24, 4, 40)
PINK, CYAN, YEL = (255, 0, 127), (0, 240, 255), (255, 230, 0)


def font(path, size, weight=None):
    f = ImageFont.truetype(path, size)
    if weight is not None:
        try:
            f.set_variation_by_axes([weight])
        except Exception:
            pass
    return f


def gradient(w, h):
    img = Image.new('RGB', (w, h))
    px = img.load()
    for y in range(h):
        t = y / max(1, h - 1)
        c = tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3))
        for x in range(w):
            px[x, y] = c
    return img


def neon_grid(img, horizon, color, lw):
    """Synthwave perspective floor below `horizon`."""
    w, h = img.size
    layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx = w / 2
    for i in range(-14, 15):
        d.line([(cx + i * w * 0.02, horizon), (cx + i * w * 0.16, h)], fill=color + (150,), width=lw)
    y, step = horizon, max(2, h * 0.012)
    while y < h:
        d.line([(0, y), (w, y)], fill=color + (150,), width=lw)
        y += step
        step *= 1.35
    glow = layer.filter(ImageFilter.GaussianBlur(lw * 2))
    img.alpha_composite(glow)
    img.alpha_composite(layer)


def glow_text(img, xy, text, f, color, blur, anchor='mm', stroke=0):
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.text(xy, text, font=f, fill=color + (255,), anchor=anchor, stroke_width=stroke, stroke_fill=color + (255,))
    for r, a in ((blur * 2.2, 0.9), (blur, 1.0)):
        g = layer.filter(ImageFilter.GaussianBlur(r))
        if a < 1:
            g.putalpha(g.getchannel('A').point(lambda v: int(v * a)))
        img.alpha_composite(g)
    core = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ImageDraw.Draw(core).text(xy, text, font=f, fill=(255, 255, 255, 255), anchor=anchor)
    img.alpha_composite(layer)
    # white-hot core, slightly inset, like a neon tube
    img.alpha_composite(Image.blend(core, layer, 0.72))


def banner(path, W=320, H=180, S=4):
    w, h = W * S, H * S
    img = gradient(w, h).convert('RGBA')
    horizon = int(h * 0.70)
    # sun
    sun = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sun)
    r = int(h * 0.30)
    for i in range(r):
        t = i / r
        c = (255, int(40 + 150 * (1 - t)), int(127 * t))
        sd.line([(w / 2 - (r * r - (r - i) ** 2) ** 0.5, horizon - r + i), (w / 2 + (r * r - (r - i) ** 2) ** 0.5, horizon - r + i)], fill=c + (70,))
    img.alpha_composite(sun.filter(ImageFilter.GaussianBlur(S)))
    neon_grid(img, horizon, PINK, max(1, S // 2))
    glow_text(img, (w / 2, h * 0.24), 'AHLERS', font(FONT_TECH, int(h * 0.15), 900), CYAN, S * 3)
    glow_text(img, (w / 2, h * 0.50), 'ARCADE', font(FONT_PIXEL, int(h * 0.22)), PINK, S * 4)
    glow_text(img, (w / 2, h * 0.86), 'LIVE SCOREBOARD', font(FONT_TECH, int(h * 0.085), 800), YEL, S * 2)
    d = ImageDraw.Draw(img)
    d.rectangle([S, S, w - S - 1, h - S - 1], outline=CYAN + (255,), width=S * 2)
    img = img.resize((W, H), Image.LANCZOS).convert('RGB')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)


def icon(path, size, S=4):
    w = size * S
    img = gradient(w, w).convert('RGBA')
    neon_grid(img, int(w * 0.72), PINK, max(1, S // 2))
    glow_text(img, (w / 2, w * 0.44), 'A', font(FONT_PIXEL, int(w * 0.52)), PINK, S * 3)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([S * 2, S * 2, w - S * 2 - 1, w - S * 2 - 1], radius=int(w * 0.16), outline=CYAN + (255,), width=max(S * 2, w // 28))
    mask = Image.new('L', (w, w), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, w - 1], radius=int(w * 0.18), fill=255)
    out = Image.new('RGBA', (w, w), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    out = out.resize((size, size), Image.LANCZOS)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out.save(path, optimize=True)


if __name__ == '__main__':
    banner(os.path.join(ROOT, 'drawable-xhdpi', 'tv_banner.png'))
    for d, s in (('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)):
        icon(os.path.join(ROOT, 'mipmap-' + d, 'ic_launcher.png'), s)
    print('art written under', os.path.normpath(ROOT))
