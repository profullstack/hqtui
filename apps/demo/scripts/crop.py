"""Crop terminal screenshots away from the sentinel page background."""
import sys, os
from PIL import Image

src, dst, sentinel = sys.argv[1], sys.argv[2], sys.argv[3]
target = tuple(int(sentinel.lstrip("#")[i:i+2], 16) for i in (0, 2, 4))

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
            if pixels[x, y] != target:
                if x < left: left = x
                if x > right: right = x
                if y < top: top = y
                if y > bottom: bottom = y
    if right < 0:
        print(f"  ! {name}: nothing but background")
        continue

    cropped = image.crop((left, top, right + 1, bottom + 1))
    out = os.path.join(dst, name.replace(".raw.png", ".png"))
    cropped.save(out, optimize=True)
    print(f"  {os.path.basename(out)}  {cropped.width}x{cropped.height}")
    count += 1

print(f"cropped {count} screenshots")
