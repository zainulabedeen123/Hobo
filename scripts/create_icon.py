from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
size = 1024
image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((32, 32, 992, 992), radius=230, fill=(24, 27, 22, 255))
draw.rounded_rectangle((96, 96, 928, 928), radius=190, fill=(201, 242, 124, 255))

# Four-point spark, matching the in-app brand mark.
points = [
    (512, 215), (568, 440), (790, 512), (568, 584),
    (512, 809), (456, 584), (234, 512), (456, 440),
]
draw.polygon(points, fill=(26, 33, 15, 255))
image.save(root / "app-icon.png")
print(root / "app-icon.png")
