from __future__ import annotations

import argparse
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render a contiguous ORBAT profile-page range as optimized WebP assets."
    )
    parser.add_argument("input", type=Path, help="Source ORBAT PDF")
    parser.add_argument("output", type=Path, help="Destination directory")
    parser.add_argument("--first-page", type=int, required=True)
    parser.add_argument("--last-page", type=int, required=True)
    parser.add_argument("--dpi", type=int, default=150)
    parser.add_argument("--quality", type=int, default=88)
    parser.add_argument(
        "--pdftoppm",
        default="pdftoppm",
        help="Path to pdftoppm (defaults to resolving it from PATH)",
    )
    return parser.parse_args()


def validate_args(args: argparse.Namespace) -> None:
    if not args.input.is_file():
        raise FileNotFoundError(f"ORBAT PDF not found: {args.input}")
    if args.first_page < 1 or args.last_page < args.first_page:
        raise ValueError("Page range must be positive and ordered")
    if not 72 <= args.dpi <= 300:
        raise ValueError("DPI must be between 72 and 300")
    if not 1 <= args.quality <= 100:
        raise ValueError("WebP quality must be between 1 and 100")


def resolve_pdftoppm(candidate: str) -> str:
    explicit_path = Path(candidate)
    if explicit_path.is_file():
        return str(explicit_path.resolve())

    resolved = shutil.which(candidate)
    if resolved is None:
        raise FileNotFoundError(
            "pdftoppm is required. Pass its path with --pdftoppm or add it to PATH."
        )
    return resolved


def render_pages(args: argparse.Namespace, pdftoppm: str, temporary: Path) -> list[Path]:
    prefix = temporary / "profile"
    subprocess.run(
        [
            pdftoppm,
            "-f",
            str(args.first_page),
            "-l",
            str(args.last_page),
            "-r",
            str(args.dpi),
            "-png",
            str(args.input.resolve()),
            str(prefix),
        ],
        check=True,
    )

    pages = sorted(temporary.glob("profile-*.png"))
    expected_count = args.last_page - args.first_page + 1
    if len(pages) != expected_count:
        raise RuntimeError(f"Expected {expected_count} rendered pages, found {len(pages)}")
    return pages


def convert_pages(args: argparse.Namespace, rendered_pages: list[Path]) -> None:
    args.output.mkdir(parents=True, exist_ok=True)

    for page_number, rendered_path in zip(
        range(args.first_page, args.last_page + 1), rendered_pages, strict=True
    ):
        destination = args.output / f"profile-page-{page_number:03d}.webp"
        with Image.open(rendered_path) as image:
            image.convert("RGB").save(
                destination,
                "WEBP",
                quality=args.quality,
                method=6,
                exact=True,
            )
        print(f"{page_number}: {destination}")


def main() -> None:
    args = parse_args()
    validate_args(args)
    pdftoppm = resolve_pdftoppm(args.pdftoppm)

    with tempfile.TemporaryDirectory(prefix="orbat-profile-pages-") as temporary_directory:
        rendered_pages = render_pages(args, pdftoppm, Path(temporary_directory))
        convert_pages(args, rendered_pages)


if __name__ == "__main__":
    main()
