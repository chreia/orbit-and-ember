"""Build small, local country camera bounds from Natural Earth map units.

Run from any directory with Python 3. The output is used only for map navigation;
historical burned-area values continue to come from GWIS.
"""

from __future__ import annotations

import json
from pathlib import Path
from urllib.request import urlopen


SOURCE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_map_units.geojson"
ROOT = Path(__file__).resolve().parents[1]
HISTORY = ROOT / "web/public/data-global/history.json"
OUT = ROOT / "web/public/data-global/country-focus.json"
ALIASES = {"XKO": ["KOS"], "XNC": ["CYN"], "XAD": ["WSB", "ESB"]}


def coordinates(geometry: dict):
    if geometry["type"] == "Polygon":
        for ring in geometry["coordinates"]:
            yield from ring
    elif geometry["type"] == "MultiPolygon":
        for polygon in geometry["coordinates"]:
            for ring in polygon:
                yield from ring


def main_polygon(geometry: dict) -> dict:
    """Focus the contiguous US; Alaska and Hawaii remain visible by panning."""
    if geometry["type"] != "MultiPolygon":
        return geometry
    polygon = max(
        geometry["coordinates"],
        key=lambda poly: abs(sum(
            poly[0][i][0] * poly[0][i + 1][1] - poly[0][i + 1][0] * poly[0][i][1]
            for i in range(len(poly[0]) - 1)
        )),
    )
    return {"type": "Polygon", "coordinates": polygon}


def bounds(points: list[list[float]]) -> list[float]:
    lons = [p[0] for p in points]
    lats = [p[1] for p in points]
    west, east = min(lons), max(lons)
    # Select the smaller longitude interval for island countries crossing 180°.
    if east - west > 180:
        shifted = [lon if lon >= 0 else lon + 360 for lon in lons]
        if max(shifted) - min(shifted) < east - west:
            west, east = min(shifted), max(shifted)
    return [round(west, 3), round(min(lats), 3), round(east, 3), round(max(lats), 3)]


def main() -> None:
    countries = json.loads(HISTORY.read_text())["countries"]
    with urlopen(SOURCE, timeout=30) as response:
        features = json.load(response)["features"]
    by_field: dict[str, dict[str, list[dict]]] = {field: {} for field in ("GU_A3", "ADM0_A3", "ISO_A3", "ISO_A3_EH")}
    for feature in features:
        props = feature["properties"]
        for field in by_field:
            code = props.get(field)
            if code and code != "-99":
                by_field[field].setdefault(code, []).append(feature)
    focus = {}
    for code in countries:
        matches = []
        for alias in ALIASES.get(code, [code]):
            for field in by_field:
                found = by_field[field].get(alias, [])
                if found:
                    matches.extend(found)
                    break
        # The same feature can be indexed by multiple matching code properties.
        matches = list({id(feature): feature for feature in matches}.values())
        if not matches:
            raise ValueError(f"Missing Natural Earth geometry for {code}")
        points = []
        for feature in matches:
            geometry = main_polygon(feature["geometry"]) if code == "USA" else feature["geometry"]
            points.extend(coordinates(geometry))
        focus[code] = bounds(points)
    OUT.write_text(json.dumps({"source": SOURCE, "bounds": focus}, separators=(",", ":")) + "\n")
    print(f"Wrote {len(focus)} country bounds to {OUT}")


if __name__ == "__main__":
    main()
