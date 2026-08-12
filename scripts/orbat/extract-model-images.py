"""Extract transparent model artwork from every mapped ORBAT profile page."""

from __future__ import annotations

import argparse
import json
import re
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[2]
CARD_MANIFEST = ROOT / "src" / "assets" / "orbat-card-manifest.json"
OUTPUT = ROOT / "public" / "ships"
IMAGE_MANIFEST = ROOT / "src" / "assets" / "ship-image-manifest.json"


def decoded_image(image_file: Any) -> Image.Image:
    image = image_file.image.convert("RGBA")
    image_object = image_file.indirect_reference.get_object()
    mask_reference = image_object.get("/SMask")
    if mask_reference is None:
        return image
    mask = mask_reference.get_object()
    width, height = int(mask["/Width"]), int(mask["/Height"])
    data = mask.get_data()
    alpha = (
        Image.frombytes("L", (width, height), data)
        if len(data) == width * height
        else Image.open(BytesIO(data)).convert("L")
    )
    if alpha.size != image.size:
        alpha = alpha.resize(image.size, Image.Resampling.LANCZOS)
    image.putalpha(alpha)
    return image


def crop(image: Image.Image) -> Image.Image:
    alpha = image.getchannel("A")
    bounds = alpha.point(lambda value: 255 if value >= 8 else 0).getbbox()
    if bounds is None:
        raise ValueError("empty image")
    left, top, right, bottom = bounds
    padding = 6
    return image.crop(
        (
            max(0, left - padding),
            max(0, top - padding),
            min(image.width, right + padding),
            min(image.height, bottom + padding),
        )
    )


MODEL_IMAGE_INDEX: dict[str, int | None] = {
    "commonwealth": None,
    "crown": 8,
    "empire": 7,
    "enlightened": 7,
    "imperium": None,
    "sultanate": 7,
    "union": None,
}


def model_image_index(slug: str, page_number: int, image_count: int) -> int | None:
    if slug == "alliance":
        # Alliance model layers have a stable square-ish 435x422 source box,
        # while the absolute index moves when a page omits a decoration.
        return -1
    return MODEL_IMAGE_INDEX.get(slug)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--faction",
        choices=(
            "alliance",
            "commonwealth",
            "crown",
            "empire",
            "enlightened",
            "imperium",
            "sultanate",
            "union",
        ),
        help="Update only one faction while preserving the existing image manifest.",
    )
    return parser.parse_args()


def candidate(page: Any, slug: str, page_number: int) -> tuple[int, Image.Image] | None:
    index = model_image_index(slug, page_number, len(page.images))
    if index == -1:
        model_layers = [
            (candidate_index, image_file)
            for candidate_index, image_file in enumerate(page.images)
            if 250 <= int(image_file.indirect_reference.get_object().get("/Width", 0)) <= 600
            and 250 <= int(image_file.indirect_reference.get_object().get("/Height", 0)) <= 600
        ]
        if not model_layers:
            return None
        index = model_layers[0][0]
    if index is None or index >= len(page.images):
        return None
    try:
        image = crop(decoded_image(page.images[index]))
    except Exception:
        return None
    return index, image


def source_path(slug: str) -> Path:
    modern = ROOT / "tmp" / "pdfs" / "orbats" / f"{slug}.pdf"
    legacy = ROOT / "tmp" / "pdfs" / ("empire-4.01.pdf" if slug == "empire" else f"{slug}.pdf")
    return modern if modern.is_file() else legacy


def main() -> None:
    args = parse_args()
    source = json.loads(CARD_MANIFEST.read_text("utf-8"))
    if args.faction and IMAGE_MANIFEST.is_file():
        result: dict[str, Any] = json.loads(IMAGE_MANIFEST.read_text("utf-8"))
        result["sources"] = source["sources"]
    else:
        result = {"images": {}, "missing": {}, "sources": source["sources"]}
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for slug, cards in source["cards"].items():
        if args.faction and slug != args.faction:
            continue
        pdf = source_path(slug)
        reader = PdfReader(str(pdf)) if pdf.is_file() else None
        by_page: dict[int, list[str]] = {}
        for key, card_url in cards.items():
            page = int(re.search(r"/(\d+)\.webp$", card_url).group(1))
            by_page.setdefault(page, []).append(key)
        found: dict[str, str] = {}
        missing: list[str] = []
        for page_number, keys in sorted(by_page.items()):
            selection = candidate(reader.pages[page_number - 1], slug, page_number) if reader else None
            if selection is None:
                missing.extend(keys)
                continue
            image_index, image = selection
            path = OUTPUT / slug / f"{page_number}.webp"
            path.parent.mkdir(parents=True, exist_ok=True)
            image.save(path, "WEBP", lossless=True, method=6, exact=True)
            for key in keys:
                found[key] = {
                    "imageIndex": image_index,
                    "url": f"/ships/{slug}/{page_number}.webp",
                }
        result["images"][slug] = found
        result["missing"][slug] = sorted(missing)
        print(f"{slug}: {len(found)} images, {len(missing)} missing")
    IMAGE_MANIFEST.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", "utf-8")


if __name__ == "__main__":
    main()
