"""Extract transparent model artwork from version-pinned ORBAT PDFs."""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw
from pypdf import PdfReader


SCRIPT_DIR = Path(__file__).resolve().parent
REPOSITORY_ROOT = SCRIPT_DIR.parents[1]
DEFAULT_MANIFEST = SCRIPT_DIR / "ship-image-sources.json"
DEFAULT_OUTPUT = REPOSITORY_ROOT / "public" / "campaign" / "ships"

logging.getLogger("pypdf").setLevel(logging.ERROR)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--contact-sheet",
        type=Path,
        help="Optional JPEG contact sheet for visual QA.",
    )
    parser.add_argument(
        "--inspect",
        nargs=2,
        metavar=("SOURCE", "PAGE"),
        help="Export every embedded image from one page to tmp/pdfs/ship-image-inspection.",
    )
    return parser.parse_args()


def load_manifest(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def resolve_from_repository(path: str) -> Path:
    return (REPOSITORY_ROOT / path).resolve()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verified_source(source: dict[str, str]) -> Path:
    path = resolve_from_repository(source["path"])
    if not path.is_file():
        raise FileNotFoundError(
            f"Missing source PDF: {path}\nDownload the pinned file from {source['url']}"
        )
    actual_hash = sha256(path)
    if actual_hash != source["sha256"]:
        raise ValueError(
            f"Unexpected PDF version for {path}: expected {source['sha256']}, got {actual_hash}"
        )
    return path


def decoded_image(image_file: Any) -> Image.Image:
    """Restore a PDF image's soft mask even when pypdf cannot combine it."""
    image = image_file.image.convert("RGBA")
    image_object = image_file.indirect_reference.get_object()
    soft_mask_reference = image_object.get("/SMask")
    if soft_mask_reference is None:
        return image

    soft_mask = soft_mask_reference.get_object()
    width = int(soft_mask["/Width"])
    height = int(soft_mask["/Height"])
    data = soft_mask.get_data()

    if len(data) == width * height:
        alpha = Image.frombytes("L", (width, height), data)
    else:
        # Some ORBAT masks are JPEG data behind a FlateDecode/DCTDecode chain.
        alpha = Image.open(BytesIO(data)).convert("L")

    if alpha.size != image.size:
        alpha = alpha.resize(image.size, Image.Resampling.LANCZOS)
    image.putalpha(alpha)
    return image


def crop_transparent(image: Image.Image, threshold: int = 8, padding: int = 6) -> Image.Image:
    alpha = image.getchannel("A")
    visible = alpha.point(lambda value: 255 if value >= threshold else 0)
    bounds = visible.getbbox()
    if bounds is None:
        raise ValueError("The selected image has no visible pixels")
    left, top, right, bottom = bounds
    bounds = (
        max(0, left - padding),
        max(0, top - padding),
        min(image.width, right + padding),
        min(image.height, bottom + padding),
    )
    return image.crop(bounds)


def make_contact_sheet(files: list[Path], destination: Path) -> None:
    tile_width, tile_height = 280, 220
    thumbnail_width, thumbnail_height = 260, 180
    tiles: list[Image.Image] = []
    for path in files:
        image = Image.open(path).convert("RGBA")
        image.thumbnail((thumbnail_width, thumbnail_height))
        tile = Image.new("RGBA", (tile_width, tile_height), "white")
        tile.alpha_composite(
            image,
            ((tile_width - image.width) // 2, 28 + (thumbnail_height - image.height) // 2),
        )
        ImageDraw.Draw(tile).text((8, 7), path.stem, fill="black")
        tiles.append(tile.convert("RGB"))

    columns = 4
    rows = max(1, (len(tiles) + columns - 1) // columns)
    sheet = Image.new("RGB", (tile_width * columns, tile_height * rows), (226, 226, 226))
    for index, tile in enumerate(tiles):
        sheet.paste(tile, ((index % columns) * tile_width, (index // columns) * tile_height))
    destination.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(destination, "JPEG", quality=92)


def inspect_page(manifest: dict[str, Any], source_key: str, page_number: int) -> None:
    source = manifest["sources"].get(source_key)
    if source is None:
        raise KeyError(f"Unknown source {source_key!r}")
    reader = PdfReader(str(verified_source(source)))
    page = reader.pages[page_number - 1]
    destination = (
        REPOSITORY_ROOT
        / "tmp"
        / "pdfs"
        / "ship-image-inspection"
        / f"{source_key}-{page_number}"
    )
    destination.mkdir(parents=True, exist_ok=True)
    files: list[Path] = []
    for index, image_file in enumerate(page.images):
        output = destination / f"{index:02d}-{Path(image_file.name).stem}.png"
        decoded_image(image_file).save(output, "PNG")
        files.append(output)
        print(f"[{index}] {image_file.name} -> {output}")
    make_contact_sheet(files, destination / "contact-sheet.jpg")
    print(f"Contact sheet: {destination / 'contact-sheet.jpg'}")


def extract_all(
    manifest: dict[str, Any], output_directory: Path, contact_sheet: Path | None
) -> None:
    source_paths = {
        key: verified_source(value) for key, value in manifest["sources"].items()
    }
    readers = {key: PdfReader(str(path)) for key, path in source_paths.items()}
    output_directory.mkdir(parents=True, exist_ok=True)
    outputs: list[Path] = []

    for ship in manifest["ships"]:
        page = readers[ship["source"]].pages[int(ship["page"]) - 1]
        image_file = page.images[int(ship["imageIndex"])]
        image = crop_transparent(decoded_image(image_file))
        output = output_directory / ship["output"]
        image.save(output, "WEBP", lossless=True, method=6, exact=True)
        outputs.append(output)
        print(
            f"{ship['profileId']}: page {ship['page']}, image {ship['imageIndex']} "
            f"-> {output} ({image.width}x{image.height})"
        )

    if contact_sheet is not None:
        make_contact_sheet(outputs, contact_sheet)
        print(f"Contact sheet: {contact_sheet}")


def main() -> None:
    args = parse_args()
    manifest = load_manifest(args.manifest.resolve())
    if args.inspect:
        source_key, page = args.inspect
        inspect_page(manifest, source_key, int(page))
        return
    extract_all(manifest, args.output.resolve(), args.contact_sheet)


if __name__ == "__main__":
    main()
