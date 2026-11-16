#!/usr/bin/env bash
# Fetch the FIRMS yearly country archives (standard-quality MODIS C6.1 and VIIRS 375 m) for one country.
# Public files, no key needed. Usage: pipeline/download.sh Argentina data/raw
set -euo pipefail
COUNTRY="${1:-Argentina}"
OUT="${2:-data/raw}"
BASE="https://firms.modaps.eosdis.nasa.gov/data/country"
mkdir -p "$OUT"
fetch() {  # sensor year
  local s=$1 y=$2 f="$OUT/${1}_${2}_${COUNTRY}.csv"
  if [[ -s "$f" ]]; then return 0; fi
  local code
  code=$(curl -sS -L --retry 4 --retry-delay 5 --max-time 600 -o "$f.part" -w "%{http_code}" "$BASE/$s/$y/${s}_${y}_${COUNTRY}.csv" || echo 000)
  if [[ "$code" == "200" ]]; then mv "$f.part" "$f"; echo "ok $s $y $(wc -l < "$f")"; else rm -f "$f.part"; echo "skip $s $y http=$code"; fi
}
for y in $(seq 2000 2025); do fetch modis "$y"; done
for y in $(seq 2012 2025); do fetch viirs-snpp "$y"; done
for y in $(seq 2017 2025); do fetch viirs-jpss1 "$y"; done
echo DONE
