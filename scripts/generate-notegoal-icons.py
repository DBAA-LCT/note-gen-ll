"""Generate the clean dual-tone NoteGoal icon from the original NoteGen mark."""

from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "branding" / "notegen-original.png"
OUTPUT = ROOT / "branding" / "notegoal-icon.png"
SIZE = 620


def dual_tone(source: Image.Image) -> Image.Image:
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


def render(source: Image.Image) -> Image.Image:
    return dual_tone(source)


def replace_png(path: Path, icon: Image.Image) -> None:
    if not path.exists():
        return
    with Image.open(path) as current:
        size = current.size
    icon.resize(size, Image.Resampling.LANCZOS).save(path, optimize=True)


def apply(icon: Image.Image) -> None:
    icon.save(OUTPUT, optimize=True)
    icon.save(ROOT / "public" / "app-icon.png", optimize=True)
    icon_root = ROOT / "src-tauri" / "icons"
    for path in icon_root.rglob("*.png"):
        replace_png(path, icon)
    icon.save(
        icon_root / "icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    icon.save(
        ROOT / "src" / "app" / "favicon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48)],
    )


def main() -> None:
    with Image.open(SOURCE) as opened:
        icon = render(opened.convert("RGBA"))
    apply(icon)
    print(f"Generated and applied {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
