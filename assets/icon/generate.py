"""Needs resvg-py and pillow; run from the repository root.

`python3 assets/icon/generate.py` writes the icons and the promo tile;
`python3 assets/icon/generate.py icons` writes the icons only.
"""
import io
import math
import os
import sys

import resvg_py
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ICON_SRC = os.path.join(ROOT, "assets", "icon")
ICON_OUT = os.path.join(ROOT, "app", "public", "icon")
STORE_OUT = os.path.join(ROOT, "assets", "store")

INDIGO = "#6366F1"
INDIGO_DARK = "#3730A3"
TEAL = "#14B8A6"
WHITE = "#FFFFFF"

# One drawing per pixel size. Chrome resamples the nearest file when a size is
# missing (toolbar 16dp = 16/20/24/32px by display scale; chrome://extensions
# shows the 48px file at 36dp), and fine detail drawn for 128px turns into grey
# smudges at 16-48px. Small sizes get a circle filling the canvas (the 16px
# padding rule is for the 128px store icon only), one wave period and a
# thicker stroke.
#   size: (radius, wave inset from the left/right edge, amplitude, stroke, hard)
ICONS = {
    16: (8, 3, 2.5, 2, True),
    20: (10, 3.5, 3.25, 2.5, False),
    24: (12, 4.25, 3.75, 3, False),
    32: (16, 6, 5.5, 4, False),
    48: (21, 9, 7.5, 5, False),
}
# 128px (install dialog, Web Store, README) keeps the full drawing: store_icon_svg
WAVE_CYCLES = 1
WAVE_DECAY = 0.25  # the second half-wave is lower: the "fade"
HARD_THRESHOLD = 110  # 16px: wave coverage at or above this is solid white, else none


def envelope(t, floor):
    return floor + (1 - floor) * (0.5 + 0.5 * math.cos(math.pi * t))


def wave_points(x0, x1, cy, amp, cycles, floor, steps=160):
    pts = []
    for k in range(steps + 1):
        t = k / steps
        x = x0 + (x1 - x0) * t
        y = cy - amp * envelope(t, floor) * math.sin(2 * math.pi * cycles * t)
        pts.append(f"{x:.2f},{y:.2f}")
    return " ".join(pts)


def icon_wave_points(size, inset, amp, steps=240):
    c = size / 2
    pts = []
    for k in range(steps + 1):
        t = k / steps
        x = inset + (size - 2 * inset) * t
        y = c - amp * (1 - WAVE_DECAY * t) * math.sin(2 * math.pi * WAVE_CYCLES * t)
        pts.append(f"{x:.3f},{y:.3f}")
    return " ".join(pts)


def icon_parts(size):
    r, inset, amp, stroke, _ = ICONS[size]
    c = size / 2
    disc = f'<circle cx="{c:g}" cy="{c:g}" r="{r}" fill="{INDIGO}"/>'
    wave = (
        f'<polyline points="{icon_wave_points(size, inset, amp)}" fill="none" stroke="{WHITE}"'
        f' stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round"/>'
    )
    return disc, wave


def svg_doc(size, *body):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}">\n'
        + "".join(f"  {b}\n" for b in body)
        + "</svg>\n"
    )


def icon_svg(size):
    return svg_doc(size, *icon_parts(size))


def store_icon_svg():
    # Chrome's 128px icon guideline: 96px of art with 16px transparent padding
    pts = wave_points(30, 98, 64, 28, 1.75, 0.12)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">\n'
        f'  <circle cx="64" cy="64" r="48" fill="{INDIGO}"/>\n'
        f'  <polyline points="{pts}" fill="none" stroke="{WHITE}" stroke-width="10"'
        ' stroke-linecap="round" stroke-linejoin="round"/>\n'
        "</svg>\n"
    )


def promo_svg():
    w, h = 440, 280
    layers = []
    for amp, cycles, sw, op, dy in ((70, 3.25, 10, 0.25, 0), (54, 2.75, 12, 0.45, 0), (40, 2.25, 14, 1.0, 0)):
        pts = wave_points(-20, w + 20, h / 2 + dy, amp, cycles, 0.08)
        layers.append(
            f'  <polyline points="{pts}" fill="none" stroke="{WHITE}" stroke-opacity="{op}"'
            f' stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>'
        )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">\n'
        '  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{TEAL}"/><stop offset="0.55" stop-color="{INDIGO}"/>'
        f'<stop offset="1" stop-color="{INDIGO_DARK}"/></linearGradient></defs>\n'
        f'  <rect width="{w}" height="{h}" fill="url(#bg)"/>\n'
        + "\n".join(layers)
        + "\n</svg>\n"
    )


def render(svg, width, height):
    data = bytes(resvg_py.svg_to_bytes(svg_string=svg, width=width, height=height))
    return Image.open(io.BytesIO(data)).convert("RGBA")


def render_hard(size):
    """Antialiased circle, but a wave of whole white pixels (no grey fringe)."""
    disc, wave = icon_parts(size)
    out = render(svg_doc(size, disc), size, size)
    big = render(svg_doc(size, wave), size * 8, size * 8).getchannel("A")
    cover = list(big.resize((size, size), Image.Resampling.BOX).tobytes())
    rgba = list(out.tobytes())
    for i, c in enumerate(cover):
        if c >= HARD_THRESHOLD and rgba[i * 4 + 3]:
            rgba[i * 4 : i * 4 + 3] = (255, 255, 255)
    return Image.frombytes("RGBA", (size, size), bytes(rgba))


def write_icons():
    os.makedirs(ICON_OUT, exist_ok=True)
    for size, (*_, hard) in ICONS.items():
        svg = icon_svg(size)
        with open(os.path.join(ICON_SRC, f"icon-{size}.svg"), "w", encoding="utf-8") as f:
            f.write(svg)
        im = render_hard(size) if hard else render(svg, size, size)
        im.save(os.path.join(ICON_OUT, f"{size}.png"), optimize=True)
    svg = store_icon_svg()
    with open(os.path.join(ICON_SRC, "icon.svg"), "w", encoding="utf-8") as f:
        f.write(svg)
    render(svg, 128, 128).save(os.path.join(ICON_OUT, "128.png"), optimize=True)


def write_promo():
    os.makedirs(STORE_OUT, exist_ok=True)
    promo = promo_svg()
    with open(os.path.join(STORE_OUT, "promo-small.svg"), "w", encoding="utf-8") as f:
        f.write(promo)
    # the Web Store rejects promo tiles with alpha
    render(promo, 440, 280).convert("RGB").save(os.path.join(STORE_OUT, "promo-small-440x280.png"), optimize=True)


def main():
    write_icons()
    if sys.argv[1:] != ["icons"]:
        write_promo()


if __name__ == "__main__":
    main()
