"""Extract reviewed module regions from local publisher PDFs.

Requires pymupdf, pdfplumber, Pillow. No downloads or generated illustrations.
Usage: python scripts/orbat/extract-faction-module-lore.py --sources-dir tmp/module-lore/orbats
Empire retains its original extractor. Missing images/lore remain explicitly absent.
"""

from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import re
import sys

import pdfplumber
import pymupdf
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('empire_extract', Path(__file__).with_name('extract-module-lore.py'))
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)


def artwork(doc, record, destination, assembly=False):
    if not record['art']:
        return {'imageUrl': None, 'imageWidth': None, 'imageHeight': None}
    with pymupdf.open() as isolated:
        isolated.insert_pdf(doc, from_page=record['page']-1, to_page=record['page']-1)
        page = isolated[0]
        art = pymupdf.Rect(record['art'])
        if record.get('renderClip'):
            # Assembly diagrams may be vector drawings, including exploded views.
            clip = art
        else:
            images = [i for i in page.get_image_info(xrefs=True)
                      if art.contains(pymupdf.Rect(i['bbox']).tl)
                      and i['bbox'][2] - i['bbox'][0] < 180]
            if not images:
                raise ValueError(f"No artwork: {record['name']}")
            kept = {tuple(i['bbox']) for i in images}
            for info in page.get_image_info(xrefs=True):
                if tuple(info['bbox']) not in kept and info['xref']:
                    page.delete_image(info['xref'])
            # Keep only the original raster art, including its soft mask. Remove
            # rules, caption text and assembly arrows crossing the crop boundary.
            page.add_redact_annot(page.rect, fill=None)
            page.apply_redactions(images=0, graphics=2)
            clip = pymupdf.Rect(images[0]['bbox'])
            for info in images[1:]:
                clip |= pymupdf.Rect(info['bbox'])
            clip += (-3, -3, 3, 3)
        pix = page.get_pixmap(matrix=pymupdf.Matrix(4, 4), clip=clip, alpha=True)
        image = Image.frombytes('RGBA', (pix.width, pix.height), pix.samples)
        image.save(destination, 'WEBP', lossless=True)
    return {'imageUrl': '/' + destination.relative_to(ROOT/'public').as_posix(),
            'imageWidth': image.width, 'imageHeight': image.height}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources-dir', type=Path, required=True)
    parser.add_argument('--faction')
    args = parser.parse_args()
    config = json.loads(Path(__file__).with_name('module-lore-regions.json').read_text(encoding='utf-8'))
    target = ROOT/'src/assets/module-lore'
    target.mkdir(parents=True, exist_ok=True)
    for faction, pack in config.items():
        if args.faction and faction != args.faction:
            continue
        source = args.sources_dir / pack.get('file', f'{faction}.pdf')
        out = ROOT/'public/modules'/faction
        out.mkdir(parents=True, exist_ok=True)
        records = []
        with pymupdf.open(source) as doc, pdfplumber.open(source) as textdoc:
            for record in pack['modules']:
                slug = re.sub('[^a-z0-9]+', '-', record['name'].lower()).strip('-')
                paras = []
                for bounds in record['regions']:
                    paras.extend(helpers.paragraphs(textdoc.pages[record['page']-1], bounds))
                # Some PDF heading boxes overlap the first line's crop boundary.
                if paras:
                    paras[0] = re.sub('^' + re.escape(record['name']) + r'\s+', '', paras[0], flags=re.I)
                # Publisher's stray section heading is printed inside this paragraph.
                if faction == 'enlightened' and slug == 'light-rocket-battery':
                    paras[-1] = paras[-1].removesuffix(' heavy hardpoints.')
                paras = [p.replace('state-of-theart', 'state-of-the-art').replace('state-ofthe-art', 'state-of-the-art') for p in paras]
                extra_source = {}
                if record.get('file'):
                    if paras:
                        raise ValueError('Supplemental assembly sources must not contain lore regions')
                    extra_path = args.sources_dir / record['file']
                    with pymupdf.open(extra_path) as extra_doc:
                        art = artwork(extra_doc, record, out/f'{slug}.webp', assembly=True)
                    extra_source = {'source': {**record['source'], 'sha256':hashlib.sha256(extra_path.read_bytes()).hexdigest()}}
                else:
                    art = artwork(doc, record, out/f'{slug}.webp', pack['source']['kind']=='assembly')
                records.append({'id':slug, 'name':record['name'], 'aliases':record['aliases'],
                                'category':'Генератор' if 'Generator' in record['name'] else 'Вооружение',
                                'page':record['page'], **art, **extra_source,
                                'paragraphs':paras})
        manifest = {'faction':faction.title(), 'source':{**pack['source'], 'sha256':hashlib.sha256(source.read_bytes()).hexdigest()}, 'modules':records}
        (target/f'{faction}.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
        print(f'{faction}: {len(records)} modules, {sum(bool(r["imageUrl"]) for r in records)} images')


if __name__ == '__main__':
    main()
