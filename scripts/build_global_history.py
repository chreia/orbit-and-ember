"""Aggregate the GWIS MCD64A1 country-profile CSV to monthly burned-area totals.

Download the official 2002–2025 ZIP from the GWIS Country Profile downloads
page, then run: python3 build_global_history.py input.zip output.json
"""

import csv
import json
import sys
import zipfile
from collections import defaultdict
from pathlib import Path


def build(source: Path, target: Path) -> None:
    countries = defaultdict(lambda: {"name": "", "months": [0.0] * 288})
    world = [0.0] * 288
    with zipfile.ZipFile(source) as archive:
        with archive.open(archive.namelist()[0]) as stream:
            rows = csv.DictReader(line.decode("utf-8-sig") for line in stream)
            for row in rows:
                year, month = int(row["year"]), int(row["month"])
                if not (2002 <= year <= 2025 and 1 <= month <= 12):
                    continue
                index = (year - 2002) * 12 + month - 1
                hectares = sum(float(row[key] or 0) for key in (
                    "forest", "savannas", "shrublands_grasslands", "croplands", "other"
                ))
                country = countries[row["gid_0"]]
                country["name"] = row["country"]
                country["months"][index] += hectares
                world[index] += hectares
    result = {
        "source": "European Commission JRC GWIS Country Profile, MODIS MCD64A1 monthly burned area",
        "sourceUrl": "https://gwis.jrc.ec.europa.eu/apps/country.profile/downloads",
        "unit": "hectares burned",
        "startYear": 2002,
        "endYear": 2025,
        "world": [round(value) for value in world],
        "countries": {code: {"name": data["name"], "months": [round(value) for value in data["months"]]}
                      for code, data in sorted(countries.items())},
    }
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {target}: {len(result['countries'])} countries, {len(world)} months")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: build_global_history.py source.zip output.json")
    build(Path(sys.argv[1]), Path(sys.argv[2]))
