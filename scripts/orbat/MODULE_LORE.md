# Module artwork and lore

The module camera uses faction-specific records. A shared weapon name must never
fall back to another faction's artwork or narrative. Russian lore is the default;
the original English text remains available in the dialog.

Coverage checked against the publisher's faction downloads on 2026-08-31:

| Faction      | Cards | Images | Translated lore | Source pages                                             |
| ------------ | ----: | -----: | --------------: | -------------------------------------------------------- |
| Empire       |    19 |     19 |              19 | ORBAT 4.01, 81–86                                        |
| Alliance     |    16 |     16 |              16 | ORBAT 4.01, 68–71                                        |
| Crown        |    13 |     13 |              13 | ORBAT 4.02a, 70–73                                       |
| Enlightened  |    20 |     19 |              20 | ORBAT 4.01, 60–66                                        |
| Sultanate    |    16 |     16 |              16 | ORBAT 4.01, 65–69                                        |
| Commonwealth |     6 |      6 |               0 | Faction Starter assembly guide, 1 and 5                  |
| Imperium     |     5 |      5 |               0 | Faction Starter assembly guide, 2–4                      |
| Union        |     4 |      4 |               0 | Faction Starter guide, 1; Long Range Squadrons guide, 10 |

The current Commonwealth 4.00a, Imperium 4.00b and Union 4.00a ORBATs do not
include Tools of War sections. Their coverage is **partial**: only unambiguously
identified assembly illustrations are included, with no invented lore. The UI
labels these sources and explains the missing narrative. Modules lacking both
artwork and lore have no camera. Enlightened's Advanced Aetheric Lance has lore
but no separate illustration, so its card explicitly explains the missing image.
Other fixed special weapons and torpedo salvos outside the hardpoint selector
have not been turned into module cards.

Assembly guides use some older weapon names. The illustrated components were
matched to the same hulls/options in the current ORBAT: Commonwealth Rocket
Battery → Zhalo Rocket Battery; Imperium Heavy Arc Gun Battery → Heavy Voltaic
Gun Battery, Heavy Rocket Battery → Stromschlag Rocket Battery, Gustav Heavy
Bombard → Gustav Twin Bombard; Union's large Rocket Battery → Heavy Rocket
Battery and Farragut's Gatling Gun → Chesapeake Gatling Gun. Light and heavy
variants are kept separate. Unique generator upgrades are not silently mapped
to generic generators.

## Reproduction

Install `pymupdf`, `pdfplumber` and `Pillow`. Keep publisher PDFs locally; do not
commit them. Exact download URLs, source SHA-256 hashes and page numbers are
recorded in the manifests. Crop coordinates and supplemental source filenames
are in `module-lore-regions.json`.

```sh
python scripts/orbat/extract-faction-module-lore.py --sources-dir tmp/module-lore/orbats
npx prettier --write "src/assets/module-lore/*.json"
```

Expected filenames are `alliance.pdf`, `crown.pdf`, `enlightened.pdf`,
`sultanate.pdf`, `commonwealth-assembly.pdf`, `imperium-assembly.pdf`,
`union-assembly.pdf` and `union-long-range.pdf`. Use `--faction crown` to refresh
only one faction. Empire retains `extract-module-lore.py` and its original
manifest/translation files.

Original raster transforms and transparency masks are retained. Unrelated
images, typography, assembly arrows and page decoration are removed. Text is
deduplicated before extraction. Crown Fury's continuation in the next column is
included. The stray printed words “heavy hardpoints.” after Enlightened's light
rocket description are omitted as a layout error. Russian translations live in
separate `.ru.json` files and are never overwritten by extraction.

When updating a source, visually review every crop, paragraph ending and page
link. Validate translation IDs and paragraph counts, dimensions and asset
existence. Then run the module lookup, module dialog, ship editor and router
tests, TypeScript, targeted lint and the client build.
