"""Build a page index for rules found in the official DW4 Rules Glossary PDF."""

from __future__ import annotations

import argparse
import gzip
import json
import re
import unicodedata
from pathlib import Path

from pypdf import PdfReader


def normalize(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold().replace("’", "'")
    normalized = re.sub(r"\s*\((?:x|trait)\)\s*$", "", normalized)
    return re.sub(r"[^a-z0-9]+", " ", normalized).strip()


def glossary_titles(catalog_root: Path) -> set[str]:
    index = json.loads((catalog_root / "factions.json").read_text(encoding="utf-8"))
    titles: set[str] = set()
    for faction in index["factions"].values():
        catalog = json.loads(gzip.decompress((catalog_root / faction["path"]).read_bytes()))
        for entity in catalog["entities"].values():
            if entity.get("kind") != "Rule":
                continue
            if entity.get("provenance", {}).get("documentPath") != "Rules Glossary.cat":
                continue
            title = (entity.get("label", {}).get("plainText") or "").strip()
            if title:
                titles.add(title)
    return titles


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--catalog-root", type=Path, default=Path("public/catalog"))
    args = parser.parse_args()

    pages_by_heading: dict[str, set[int]] = {}
    for page_number, page in enumerate(PdfReader(args.pdf).pages, 1):
        for line in (page.extract_text() or "").splitlines():
            heading = normalize(line)
            if heading:
                pages_by_heading.setdefault(heading, set()).add(page_number)

    page_index = {
        title: max(pages_by_heading[normalize(title)])
        for title in sorted(glossary_titles(args.catalog_root), key=str.casefold)
        if normalize(title) in pages_by_heading
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(page_index, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Indexed {len(page_index)} glossary headings.")


if __name__ == "__main__":
    main()
