from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import urllib.request
import unicodedata

from PIL import Image
from pypdf import PdfReader


SOURCES = {
    "alliance": "https://www.warcradle.com/assets/warcradleGames/dystopianWars/factions/orbat/DW-ORBATS_Alliance-4.01-Beta_W.pdf",
    "commonwealth": "https://www.warcradle.com/assets/warcradleGames/dystopianWars/factions/orbat/DW-ORBATS_Commonwealth-400a_W.pdf",
    "crown": "https://www.warcradle.com/assets/warcradleGames/dystopianWars/factions/orbat/DW-ORBATS_Crown_Full-4.02a.pdf",
    "empire": "https://www.warcradle.com/assets/warcradleGames/dystopianWars/factions/orbat/DW-ORBATS_Empire_Full-4.01_W.pdf",
    "enlightened": "https://www.warcradle.com/assets/warcradleGames/dystopianWars/factions/orbat/DW-ORBATS_Enlightened-v4.01-Beta2_W.pdf",
    "imperium": "https://www.warcradle.com/assets/warcradleGames/dystopianWars/factions/orbat/DW-ORBATS_Imperium-400b_W.pdf",
    "sultanate": "https://www.warcradle.com/assets/warcradleGames/dystopianWars/factions/orbat/DW-ORBATS_Sultanate-4.01_W.pdf",
    "union": "https://www.warcradle.com/assets/warcradleGames/dystopianWars/factions/orbat/DW-ORBATS_Union-4.00a_W.pdf",
}


def compact(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return re.sub(r"[^a-z0-9]+", "", normalized.encode("ascii", "ignore").decode().lower())


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def catalog_units(root: Path, slug: str) -> list[str]:
    index = json.loads((root / "dist/client/catalog/factions.json").read_text("utf-8"))
    faction = next(
        value for value in index["factions"].values() if compact(value["label"]) == slug
    )
    archive = root / "dist/client/catalog" / faction["path"]
    payload = json.loads(gzip.decompress(archive.read_bytes()).decode("utf-8"))
    return sorted(
        {
            entity["label"]["plainText"]
            for entity in payload["entities"].values()
            if entity["kind"] == "Unit" and entity["label"]["plainText"]
        }
    )


def index_lines(reader: PdfReader) -> list[str]:
    lines: list[str] = []
    for page in reader.pages[1:6]:
        text = page.extract_text() or ""
        if "UNIT INDEX" in text or "TABLE OF CONTENTS" in text:
            lines.extend(line.strip() for line in text.splitlines() if line.strip())
    return lines


def page_map(reader: PdfReader, units: list[str]) -> dict[str, int]:
    lines = index_lines(reader)
    total_pages = len(reader.pages)
    result: dict[str, int] = {}
    for unit in units:
        token = compact(unit)
        matches = [line for line in lines if token and token in compact(line)]
        for line in matches:
            numbers = [int(value) for value in re.findall(r"\d+", line)]
            candidates = [value for value in numbers if 10 <= value <= total_pages]
            if candidates:
                result[token] = candidates[-1]
                break
    return result


def renderer() -> str:
    configured = os.environ.get("PDFTOPPM")
    candidate = configured or shutil.which("pdftoppm") or shutil.which("pdftoppm.exe")
    if not candidate:
        raise RuntimeError("pdftoppm was not found. Install Poppler or set PDFTOPPM.")
    return candidate


def render_pages(
    executable: str,
    source: Path,
    pages: set[int],
    output: Path,
    temporary: Path,
) -> None:
    if not pages:
        return
    output.mkdir(parents=True, exist_ok=True)
    ascii_pdf = temporary / "source.pdf"
    shutil.copyfile(source, ascii_pdf)
    prefix = temporary / "page"
    command = [
        executable,
        "-f",
        str(min(pages)),
        "-l",
        str(max(pages)),
        "-scale-to-x",
        "1240",
        "-scale-to-y",
        "-1",
        "-jpeg",
        "-jpegopt",
        "quality=90",
        str(ascii_pdf),
        str(prefix),
    ]
    subprocess.run(command, check=True)
    for image_path in temporary.glob("page-*.jpg"):
        page = int(image_path.stem.rsplit("-", 1)[-1])
        if page not in pages:
            continue
        with Image.open(image_path) as image:
            image.save(output / f"{page}.webp", "WEBP", quality=86, method=6)


def download(url: str, target: Path, refresh: bool) -> None:
    if target.exists() and not refresh:
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "DystopianWarsBuilder/1.0"})
    with urllib.request.urlopen(request) as response, target.open("wb") as output:
        shutil.copyfileobj(response, output)


def main() -> None:
    parser = argparse.ArgumentParser(description="Publish complete ORBAT profile pages.")
    parser.add_argument("--refresh", action="store_true", help="Download the current PDFs again.")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    pdf_root = root / "tmp/pdfs"
    asset_root = root / "public/orbat-cards"
    manifest: dict[str, dict] = {"cards": {}, "sources": {}}
    executable = renderer()

    for slug, url in SOURCES.items():
        pdf = pdf_root / ("empire-4.01.pdf" if slug == "empire" else f"{slug}.pdf")
        download(url, pdf, args.refresh)
        reader = PdfReader(str(pdf))
        cards = page_map(reader, catalog_units(root, slug))
        with tempfile.TemporaryDirectory(prefix=f"dwb-{slug}-") as temporary_name:
            render_pages(
                executable,
                pdf,
                set(cards.values()),
                asset_root / slug,
                Path(temporary_name),
            )
        manifest["cards"][slug] = {
            name: f"/orbat-cards/{slug}/{page}.webp" for name, page in sorted(cards.items())
        }
        manifest["sources"][slug] = {
            "mappedCards": len(cards),
            "sha256": sha256(pdf),
            "url": url,
        }
        print(f"{slug}: {len(cards)} cards")

    target = root / "src/assets/orbat-card-manifest.json"
    target.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", "utf-8")


if __name__ == "__main__":
    main()
