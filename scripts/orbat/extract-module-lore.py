"""Extract Empire module artwork and complete lore from the local ORBAT 4.01.

Requires pymupdf, pdfplumber and Pillow. Run from any directory; the source PDF
stays local. Coordinates are PDF points, reviewed against pages 81–86.
"""

from pathlib import Path
import hashlib
import json
import re
import statistics
import unicodedata

import pdfplumber
import pymupdf
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "DW-ORBATS_Empire_Full-4.01_W.pdf"
OUTPUT = ROOT / "public" / "modules" / "empire"
MANIFEST = ROOT / "src" / "assets" / "module-lore-manifest.json"

# name, page, artwork bounds, text bounds in reading order, catalog aliases
MODULES = [
    ("Light Alchemical Rocket Battery", 81, (58, 251, 150, 296), [(56, 315, 294, 594)], ["Light Alchemical Rockets"]),
    ("Light Corrosive Mortar", 81, (304, 241, 354, 290), [(304, 314, 542, 498)], ["Light Corrosive Mortars"]),
    ("Cạp Cạp Flak Gun", 81, (305, 502, 362, 551), [(304, 572, 542, 787)], ["Cap Cap Flak Gun"]),
    ("Light Gun Battery", 82, (55, 80, 130, 103), [(56, 130, 294, 409)], []),
    ("Light Huǒqiāng", 82, (56, 419, 154, 455), [(56, 475, 294, 633)], ["Light Huoqiang"]),
    ("Heavy Gun Battery", 82, (304, 80, 422, 120), [(304, 145, 542, 458)], []),
    ("Heavy Alchemical Rocket Battery", 82, (299, 461, 406, 515), [(304, 531, 542, 783)], ["Heavy Alchemical Rockets"]),
    ("Heavy Huǒqiāng", 83, (55, 82, 196, 124), [(56, 143, 294, 301)], ["Heavy Huoqiang"]),
    ("Heavy Corrosive Mortar", 83, (54, 301, 114, 349), [(56, 367, 294, 525)], []),
    ("Jangdaebi Repeating Gun", 83, (55, 532, 202, 578), [(56, 598, 294, 730), (304, 81, 542, 374)], []),
    ("Atomic Generator", 83, (303, 407, 403, 453), [(304, 473, 542, 779)], []),
    ("Fury Generator", 84, (55, 82, 153, 128), [(56, 153, 294, 337)], []),
    ("Great Wall Generator", 84, (55, 340, 151, 386), [(56, 407, 294, 768)], []),
    ("Heavy Shield Generator", 84, (303, 82, 403, 128), [(304, 155, 542, 422)], []),
    ("Interphase Generator", 85, (55, 81, 152, 131), [(56, 153, 294, 528)], []),
    ("Magma Cast Generator", 85, (55, 531, 160, 577), [(56, 598, 294, 786), (304, 81, 542, 283)], []),
    ("Magnetic Generator", 85, (303, 286, 408, 333), [(304, 353, 542, 667)], []),
    ("Repulsion Field Generator", 86, (55, 82, 163, 131), [(56, 148, 294, 363)], ["Repulsion Generator"]),
    ("Shroud Generator", 86, (55, 366, 158, 413), [(56, 433, 294, 674)], []),
]


def paragraphs(page, bounds):
    # The PDF duplicates bold glyphs at identical positions. Deduplicate before
    # reading, and discard tiny accent overlays already encoded in the letters.
    region = page.crop(bounds).dedupe_chars(tolerance=1).filter(
        lambda obj: obj.get("object_type") != "char" or obj.get("size", 0) >= 7
    )
    lines = region.extract_text_lines()
    spacing = statistics.median(b["top"] - a["top"] for a, b in zip(lines, lines[1:]))
    result = [""]
    previous = None
    for line in lines:
        if previous and line["top"] - previous["top"] > spacing * 1.17:
            result.append("")
        text = unicodedata.normalize("NFKC", line["text"]).strip()
        if result[-1].endswith("-"):
            result[-1] = result[-1][:-1] + text
        else:
            result[-1] += (" " if result[-1] else "") + text
        previous = line
    return result


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    records = []
    with pymupdf.open(SOURCE) as pdf, pdfplumber.open(SOURCE) as text_pdf:
        for name, number, art, regions, aliases in MODULES:
            slug = re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", aliases[0] if aliases else name).encode("ascii", "ignore").decode().lower()).strip("-")
            page = pdf[number - 1]
            # Retain the PDF image transforms and soft masks, but remove text and
            # unrelated artwork. This produces both original views on transparency.
            art_rect = pymupdf.Rect(art)
            image_infos = [info for info in page.get_image_info(xrefs=True)
                           if art_rect.contains(pymupdf.Rect(info["bbox"]).tl)
                           and info["bbox"][2] - info["bbox"][0] < 180]
            if not image_infos:
                raise ValueError(f"No artwork for {name}")
            with pymupdf.open() as isolated:
                isolated.insert_pdf(pdf, from_page=number - 1, to_page=number - 1)
                output_page = isolated[0]
                # Cross-reference numbers change after insert_pdf: identify by bbox.
                kept_bounds = {tuple(info["bbox"]) for info in image_infos}
                for info in output_page.get_image_info(xrefs=True):
                    if tuple(info["bbox"]) not in kept_bounds and info["xref"]:
                        output_page.delete_image(info["xref"])
                for block in output_page.get_text("blocks"):
                    if block[6] == 0:
                        output_page.add_redact_annot(block[:4])
                output_page.apply_redactions(images=0, graphics=0)
                clip = pymupdf.Rect(image_infos[0]["bbox"])
                for info in image_infos[1:]:
                    clip |= pymupdf.Rect(info["bbox"])
                clip += (-3, -3, 3, 3)
                pix = output_page.get_pixmap(matrix=pymupdf.Matrix(4, 4), clip=clip, alpha=True)
                image = Image.frombytes("RGBA", (pix.width, pix.height), pix.samples)
                image.save(OUTPUT / f"{slug}.webp", "WEBP", lossless=True)
            lore = []
            for index, bounds in enumerate(regions):
                extracted = paragraphs(text_pdf.pages[number - 1], bounds)
                if index and name == "Magma Cast Generator":
                    lore[-1] += " " + extracted.pop(0)
                lore.extend(extracted)
            records.append({"id": slug, "name": name, "aliases": aliases,
                            "category": "Генератор" if "Generator" in name else "Вооружение",
                            "page": number, "imageUrl": f"/modules/empire/{slug}.webp",
                            "imageWidth": image.width, "imageHeight": image.height,
                            "paragraphs": lore})
    manifest = {"faction": "Empire", "source": {"title": "The Empire · ORBAT 4.01",
                "url": "https://www.warcradle.com/assets/warcradleGames/dystopianWars/factions/orbat/DW-ORBATS_Empire_Full-4.01_W.pdf",
                "sha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest()}, "modules": records}
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Extracted {len(records)} modules to {OUTPUT}")


if __name__ == "__main__":
    main()
