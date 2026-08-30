"""Crop terminal screenshots away from the sentinel page background.

The sentinel is a colour no terminal theme uses, so the bounding box of
everything that is not it is the frame. Anti-aliasing leaves a fringe of
blended pixels at that boundary, which survives a naive bbox crop as a magenta
hairline in the corners, so the box is pulled in and any residue is repainted
with the frame's own background.
"""
import sys, os
from PIL import Image

src, dst, sentinel = sys.argv[1], sys.argv[2], sys.argv[3]
target = tuple(int(sentinel.lstrip("#")[i:i+2], 16) for i in (0, 2, 4))

def near_sentinel(px, tolerance=60):
    return (abs(px[0] - target[0]) < tolerance
            and abs(px[1] - target[1]) < tolerance
            and abs(px[2] - target[2]) < tolerance)

count = 0
for name in sorted(os.listdir(src)):
    if not name.endswith(".raw.png"):
        continue
    image = Image.open(os.path.join(src, name)).convert("RGB")
    pixels = image.load()
    width, height = image.size

    left, top, right, bottom = width, height, -1, -1
    for y in range(height):
        for x in range(width):
            if not near_sentinel(pixels[x, y]):
                if x < left: left = x
                if x > right: right = x
                if y < top: top = y
                if y > bottom: bottom = y
    if right < 0:
        print(f"  ! {name}: nothing but background")
        continue

    # Pull in past the blended edge.
    inset = 2
    left, top = left + inset, top + inset
    right, bottom = right - inset, bottom - inset
    cropped = image.crop((left, top, right + 1, bottom + 1))

    # Anything still carrying the sentinel becomes the frame's own background,
    # sampled from a corner that is inside the terminal.
    fill = cropped.getpixel((4, 4))
    if near_sentinel(fill):
        fill = (5, 7, 10)
    out_px = cropped.load()
    for y in range(cropped.height):
        for x in range(cropped.width):
            if near_sentinel(out_px[x, y]):
                out_px[x, y] = fill

    out = os.path.join(dst, name.replace(".raw.png", ".png"))
    cropped.save(out, optimize=True)
    print(f"  {os.path.basename(out)}  {cropped.width}x{cropped.height}")
    count += 1

print(f"cropped {count} screenshots")
