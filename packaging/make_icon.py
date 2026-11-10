"""Build multi-size asmlens.ico (PNG-compressed entries) for Windows title bar."""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent / "icons"
WEB = Path(__file__).resolve().parents[1] / "web"


def make(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    m = max(1, round(size * 0.06))
    d.rounded_rectangle(
        [m, m, size - m - 1, size - m - 1],
        radius=max(2, round(size * 0.22)),
        fill=(12, 118, 145, 255),
    )
    cx, cy = round(size * 0.45), round(size * 0.42)
    rad = max(5, round(size * 0.27))
    ring = max(2, round(size * 0.075))
    cream = (250, 252, 253, 255)
    d.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=cream)
    inn = max(3, rad - ring)
    d.ellipse([cx - inn, cy - inn, cx + inn, cy + inn], fill=(12, 118, 145, 255))
    h = int(inn * 1.5)
    w = max(2, int(inn * 0.5))
    top = cy - h // 2
    pink, peach = (235, 115, 115, 255), (255, 230, 200, 255)
    steps = max(10, size // 8)
    p1, p2 = [], []
    for i in range(steps):
        t = i / (steps - 1)
        y = top + int(t * h)
        ph = t * math.pi * 2.4
        x1 = cx + int(math.sin(ph) * w)
        x2 = cx + int(math.sin(ph + math.pi) * w)
        p1.append((x1, y))
        p2.append((x2, y))
        if i % 2 == 0:
            d.line([(x1, y), (x2, y)], fill=peach, width=max(1, size // 48))
    d.line(p1, fill=pink, width=max(2, size // 28))
    d.line(p2, fill=peach, width=max(2, size // 28))
    ang = math.radians(40)
    hx = cx + int(math.cos(ang) * (rad - 1))
    hy = cy + int(math.sin(ang) * (rad - 1))
    hx2 = hx + int(math.cos(ang) * rad * 0.95)
    hy2 = hy + int(math.sin(ang) * rad * 0.95)
    d.line([(hx, hy), (hx2, hy2)], fill=cream, width=max(ring + 1, size // 10))
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    base = make(256)
    # Pillow ICO embeds BMP for small sizes — Windows title bar reads these reliably
    base.save(OUT / "asmlens.ico", format="ICO", sizes=sizes)
    make(256).save(OUT / "asmlens_256.png")
    make(256).save(OUT / "asmlens.png")
    make(32).save(OUT / "favicon-32.png")
    make(32).save(WEB / "favicon.png")
    print("wrote", OUT / "asmlens.ico", (OUT / "asmlens.ico").stat().st_size)
    im = Image.open(OUT / "asmlens.ico")
    print("verify", im.format, im.size, "frames", getattr(im, "n_frames", 1))


if __name__ == "__main__":
    main()
