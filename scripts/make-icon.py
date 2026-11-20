"""Draws Scrim's app icon (original artwork): a rounded tile with a sheer curtain whose
folds fade from opaque to transparent, revealing a text cursor behind it.

Usage: python3 scripts/make-icon.py assets/icon-source.png
"""
import sys
from PIL import Image, ImageDraw

S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
tile = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(tile)
d.rounded_rectangle([64, 64, S - 64, S - 64], radius=200, fill=(250, 247, 240, 255))
img.alpha_composite(tile)

# Text cursor behind the curtain.
cur = Image.new("RGBA", (S, S), (0, 0, 0, 0))
dc = ImageDraw.Draw(cur)
dc.rounded_rectangle([600, 300, 640, 724], radius=20, fill=(40, 44, 52, 255))
img.alpha_composite(cur)

# Curtain: vertical folds, alpha falling off to the right.
curtain = Image.new("RGBA", (S, S), (0, 0, 0, 0))
dk = ImageDraw.Draw(curtain)
folds = 9
left, right = 64, 820
w = (right - left) / folds
for i in range(folds):
    x0 = left + i * w
    alpha = int(235 * (1 - i / folds) ** 1.4)
    shade = (52, 78, 120) if i % 2 == 0 else (64, 92, 138)
    dk.rectangle([x0, 64, x0 + w + 1, S - 64], fill=shade + (alpha,))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([64, 64, S - 64, S - 64], radius=200, fill=255)
clipped = Image.new("RGBA", (S, S), (0, 0, 0, 0))
clipped.paste(curtain, (0, 0), Image.composite(curtain.getchannel("A"), Image.new("L", (S, S), 0), mask))
img.alpha_composite(clipped)

# Rail at the top.
rail = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(rail).rounded_rectangle([120, 130, S - 120, 160], radius=15, fill=(40, 44, 52, 255))
img.alpha_composite(rail)

img.save(sys.argv[1])
