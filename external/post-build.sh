#!/usr/bin/env bash
# Move all dist output except index.html and cache.json into dist/convert/
# Run from repo root after build (e.g. bash external/post-build.sh).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p dist/convert
for f in dist/*; do
  [ -e "$f" ] || continue
  base=$(basename "$f")
  [ "$base" = "index.html" ] && continue
  [ "$base" = "cache.json" ] && continue
  [ "$base" = "convert" ] && continue
  mv "$f" dist/convert/
done
