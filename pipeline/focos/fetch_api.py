"""Fetch detections after the yearly archive ends, from the FIRMS area API, into archive-shaped CSVs.

Needs a free FIRMS map key in the environment variable FIRMS_MAP_KEY (never printed). For each sensor,
standard-quality (SP) days are used where they exist and near-real-time (NRT) days fill the rest.
Detections are clipped to the country outline. NRT files carry no static-source type, so detections in
0.01 degree cells where the archive flagged static land sources (type 2) in two or more years are marked
type 2 and dropped later with the rest.

    FIRMS_MAP_KEY=... python -m focos.fetch_api --start 2026-01-01 --end 2026-11-14
"""
from __future__ import annotations

import argparse
import glob
import io
import json
import os
import time

import numpy as np
import pandas as pd
import requests
import shapely
from shapely.geometry import shape

API = "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{src}/{bbox}/{days}/{date}"
SENSORS = {  # archive file prefix -> (SP source, NRT source)
    "modis": ("MODIS_SP", "MODIS_NRT"),
    "viirs-snpp": ("VIIRS_SNPP_SP", "VIIRS_SNPP_NRT"),
    "viirs-jpss1": ("VIIRS_NOAA20_SP", "VIIRS_NOAA20_NRT"),
    "viirs-jpss2": ("VIIRS_NOAA21_SP", "VIIRS_NOAA21_NRT"),
}
COLS_MODIS = ["latitude", "longitude", "brightness", "scan", "track", "acq_date", "acq_time", "satellite",
              "instrument", "confidence", "version", "bright_t31", "frp", "daynight", "type"]
COLS_VIIRS = ["latitude", "longitude", "bright_ti4", "scan", "track", "acq_date", "acq_time", "satellite",
              "instrument", "confidence", "version", "bright_ti5", "frp", "daynight", "type"]


def get(src: str, bbox: str, date: pd.Timestamp, days: int, key: str) -> pd.DataFrame:
    url = API.format(key=key, src=src, bbox=bbox, days=days, date=date.strftime("%Y-%m-%d"))
    for attempt in range(5):
        try:
            r = requests.get(url, timeout=120)
            if r.status_code == 200:
                txt = r.text
                if not txt.strip() or txt.lower().startswith(("invalid", "error")):
                    return pd.DataFrame()
                return pd.read_csv(io.StringIO(txt), dtype={"acq_time": str, "version": str, "confidence": str})
        except requests.RequestException:
            pass
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"FIRMS API failed for {src} {date.date()} (status {r.status_code})")


def static_cells(raw_dir: str) -> set[tuple[int, int]]:
    seen: dict[tuple[int, int], set[str]] = {}
    for f in glob.glob(os.path.join(raw_dir, "*_20*_*.csv")):
        if "_api" in f:
            continue
        d = pd.read_csv(f, usecols=["latitude", "longitude", "type", "acq_date"])
        d = d[d["type"] == 2]
        yr = os.path.basename(f).split("_")[1]
        for k in zip(np.floor(d["longitude"] * 100).astype(int), np.floor(d["latitude"] * 100).astype(int), strict=True):
            seen.setdefault(k, set()).add(yr)
    return {k for k, ys in seen.items() if len(ys) >= 2}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2026-01-01")
    ap.add_argument("--end", default=pd.Timestamp.utcnow().strftime("%Y-%m-%d"))
    ap.add_argument("--bbox", default="-73.6,-55.1,-53.6,-21.8")
    ap.add_argument("--country", default="Argentina")
    ap.add_argument("--adm0", default="ARG")
    ap.add_argument("--admin0", default="data/raw/ne/ne_10m_admin_0.geojson")
    ap.add_argument("--raw", default="data/raw")
    a = ap.parse_args()
    key = os.environ.get("FIRMS_MAP_KEY")
    if not key:
        raise SystemExit("set FIRMS_MAP_KEY")
    with open(a.admin0) as f:
        geom = next(shape(ft["geometry"]) for ft in json.load(f)["features"]
                    if ft["properties"].get("ADM0_A3") == a.adm0)
    shapely.prepare(geom)
    static = static_cells(a.raw)
    start, end = pd.Timestamp(a.start), pd.Timestamp(a.end)
    for prefix, (sp, nrt) in SENSORS.items():
        frames = {}
        for src in (sp, nrt):
            parts, d = [], start
            while d <= end:
                days = int(min(5, (end - d).days + 1))
                parts.append(get(src, a.bbox, d, days, key))
                d += pd.Timedelta(days=days)
            frames[src] = pd.concat([p for p in parts if len(p)], ignore_index=True) if any(len(p) for p in parts) else pd.DataFrame()
        s, n = frames[sp], frames[nrt]
        if len(s) and len(n):
            n = n[~n["acq_date"].isin(set(s["acq_date"]))]
        d = pd.concat([x for x in (s, n) if len(x)], ignore_index=True) if (len(s) or len(n)) else pd.DataFrame()
        if not len(d):
            print(f"{prefix}: no data")
            continue
        inside = shapely.contains_xy(geom, d["longitude"].to_numpy(), d["latitude"].to_numpy())
        d = d[inside].copy()
        if "type" not in d:
            d["type"] = 0
        k = list(zip(np.floor(d["longitude"] * 100).astype(int), np.floor(d["latitude"] * 100).astype(int), strict=True))
        d.loc[[c in static for c in k], "type"] = 2
        cols = COLS_MODIS if prefix == "modis" else COLS_VIIRS
        for c in cols:
            if c not in d:
                d[c] = np.nan
        out = os.path.join(a.raw, f"{prefix}_{start.year}_{a.country}_api.csv")
        d[cols].to_csv(out, index=False)
        print(f"{prefix}: {len(d):,} detections ({len(s):,} SP rows, {len(n):,} NRT rows before clipping) -> {out}")


if __name__ == "__main__":
    main()
