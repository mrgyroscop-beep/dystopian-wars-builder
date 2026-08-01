# Catalogue importer seam

KAN-30 will place the Node-only `.gst`/`.cat` downloader and parser here. It may
write versioned artifacts to `data/generated`, but it must never be imported by
`src` or `worker` and must not enter the browser or Worker bundle.

No importer implementation or third-party game data is included in KAN-29.
