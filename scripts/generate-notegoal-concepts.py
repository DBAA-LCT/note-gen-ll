"""Restore the NoteGen icon and render three integrated NoteGoal concepts."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "branding" / "notegen-original.png"
CONCEPTS = ROOT / "branding" / "concepts"
SIZE = 620


def restore_original(source: Image.Image) -> None:
    source.save(ROOT / "public" / "app-icon.png", optimize=True)
    icon_root = ROOT / "src-tauri" / "icons"
    for path in icon_root.rglob("*.png"):
        with Image.open(path) as current:
            size = current.size
        source.resize(size, Image.Resampling.LANCZOS).save(path, optimize=True)
    source.save(icon_root / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    source.save(ROOT / "src" / "app" / "favicon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48)])


def duotone(source: Image.Image) -> Image.Image:
    output = source.copy().convert("RGBA")
    pixels = output.load()
    for y in range(SIZE):
        for x in range(SIZE):
            r, g, b, a = pixels[x, y]
            luminance = max(r, g, b) / 255
            t = max(0.0, min(1.0, (x / SIZE - 0.38) / 0.42))
            t = t * t * (3 - 2 * t)
            accent = (56, 189, 248)
            color = tuple(round((255 * (1 - t) + channel * t) * luminance) for channel in accent)
            pixels[x, y] = (*color, a)
    return output


def midnight(source: Image.Image) -> Image.Image:
    output = source.copy().convert("RGBA")
    pixels = output.load()
    for y in range(SIZE):
        t = y / (SIZE - 1)
        background = tuple(round(a + (b - a) * t) for a, b in zip((15, 23, 42), (49, 46, 129)))
        for x in range(SIZE):
            r, g, b, a = pixels[x, y]
            luminance = max(r, g, b) / 255
            color = tuple(round(channel * (1 - luminance) + 255 * luminance) for channel in background)
            pixels[x, y] = (*color, a)
    return output


def progress_arc(source: Image.Image) -> Image.Image:
    scale = 4
    output = source.resize((SIZE * scale, SIZE * scale), Image.Resampling.LANCZOS)
    draw = ImageDraw.Draw(output)
    box = tuple(value * scale for value in (34, 34, 586, 586))
    start, end = -88, 198
    steps = end - start
    for index, angle in enumerate(range(start, end)):
        t = index / steps
        color = tuple(round(a + (b - a) * t) for a, b in zip((99, 102, 241), (34, 211, 238)))
        draw.arc(box, angle, angle + 2, fill=color, width=13 * scale)
    return output.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def contact_sheet(items: list[tuple[str, str, Image.Image]]) -> Image.Image:
    margin, label_height, gap = 32, 64, 24
    width = margin * 2 + SIZE * len(items) + gap * (len(items) - 1)
    sheet = Image.new("RGB", (width, SIZE + label_height + margin * 2), "#f3f4f6")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default(size=24)
    for index, (letter, title, image) in enumerate(items):
        x = margin + index * (SIZE + gap)
        sheet.paste(image, (x, margin), image)
        draw.text((x, margin + SIZE + 18), f"{letter}  {title}", fill="#111827", font=font)
    return sheet


def main() -> None:
    CONCEPTS.mkdir(parents=True, exist_ok=True)
    with Image.open(SOURCE) as opened:
        source = opened.convert("RGBA")
    restore_original(source)
    items = [
        ("A", "Dual N", duotone(source)),
        ("B", "Midnight", midnight(source)),
        ("C", "Progress", progress_arc(source)),
    ]
    for letter, title, image in items:
        image.save(CONCEPTS / f"{letter.lower()}-{title.lower().replace(' ', '-')}.png", optimize=True)
    contact_sheet(items).save(CONCEPTS / "notegoal-concepts.png", optimize=True)
    print("Restored original app icon and generated three NoteGoal concepts.")


if __name__ == "__main__":
    main()
