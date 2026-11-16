"""Read the FIRMS yearly country archives into one tidy detections table.

Every row keeps what the sensor reported: position, acquisition date and time, satellite, confidence,
fire radiative power, brightness temperature, day/night flag, FIRMS type and product version.
Only vegetation-fire detections (FIRMS type 0) are kept; volcanoes, static land sources such as gas
flares and industry, and offshore detections are not burning activity in the sense of the calendar.

`used` marks the detections that enter the harmonized counts: confidence nominal or high for both
sensors (MODIS confidence >= 30, VIIRS "n" or "h"). Low-confidence VIIRS night detections include the
South Atlantic Anomaly noise over this region, so they are left out of the counts but kept for download.

    python -m focos.ingest --raw data/raw --out data/work/detections.parquet
"""
from __future__ import annotations

import argparse
import glob
import os
import re

import numpy as np
import pandas as pd

SENSORS = {  # sensor code -> (file prefix, satellite label in FIRMS, display name)
    0: ("modis", "Terra", "MODIS Terra"),
    1: ("modis", "Aqua", "MODIS Aqua"),
    2: ("viirs-snpp", "N", "VIIRS S-NPP"),
    3: ("viirs-jpss1", "N20", "VIIRS NOAA-20"),
    4: ("viirs-jpss2", "N21", "VIIRS NOAA-21"),
}
SAT_TO_CODE = {"Terra": 0, "T": 0, "Aqua": 1, "A": 1, "N": 2, "1": 2, "N20": 3, "N21": 4}
VIIRS_CONF = {"l": 1, "n": 2, "h": 3, "low": 1, "nominal": 2, "high": 3}
MODIS_NOMINAL = 30


def read_one(path: str) -> pd.DataFrame:
    d = pd.read_csv(path, dtype={"version": str, "acq_time": str, "confidence": str, "satellite": str})
    viirs = "bright_ti4" in d.columns
    out = pd.DataFrame({
        "lon": d["longitude"].astype("float32"),
        "lat": d["latitude"].astype("float32"),
        "date": pd.to_datetime(d["acq_date"]).dt.date,
        "hhmm": d["acq_time"].astype(str).str.zfill(4).astype("int16"),
        "sensor": d["satellite"].map(SAT_TO_CODE).astype("int8"),
        "frp": d["frp"].astype("float32"),
        "bright": (d["bright_ti4"] if viirs else d["brightness"]).astype("float32"),
        "night": (d["daynight"] == "N"),
        "type": d["type"].fillna(0).astype("int8") if "type" in d else np.zeros(len(d), "int8"),
        "version": d["version"].astype(str),
    })
    if viirs:
        conf = d["confidence"].str.lower().map(VIIRS_CONF)
        out["conf"] = conf.fillna(0).astype("uint8")
        out["used"] = conf.fillna(0).values >= 2
    else:
        conf = pd.to_numeric(d["confidence"], errors="coerce").fillna(0).clip(0, 100)
        out["conf"] = conf.astype("uint8")
        out["used"] = conf.values >= MODIS_NOMINAL
    return out


def ingest(raw_dir: str) -> pd.DataFrame:
    files = sorted(glob.glob(os.path.join(raw_dir, "*.csv")))
    if not files:
        raise SystemExit(f"no CSV files in {raw_dir}")
    parts = []
    for f in files:
        if not re.search(r"(modis|viirs-[a-z0-9]+)_\d{4}_", os.path.basename(f)):
            continue
        parts.append(read_one(f))
    d = pd.concat(parts, ignore_index=True)
    n_all = len(d)
    d = d[d["type"] == 0].drop(columns="type")
    d["used"] = d["used"].astype(bool)
    d["date"] = pd.to_datetime(d["date"])
    d = d.sort_values(["date", "sensor", "hhmm"]).reset_index(drop=True)
    print(f"read {n_all:,} rows from {len(parts)} files; kept {len(d):,} vegetation-fire detections, "
          f"{int(d['used'].sum()):,} used in counts")
    return d


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default="data/raw")
    ap.add_argument("--out", default="data/work/detections.parquet")
    a = ap.parse_args()
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    d = ingest(a.raw)
    d.to_parquet(a.out, index=False)
    print(d.groupby(["sensor"]).agg(n=("used", "size"), used=("used", "sum"),
                                    first=("date", "min"), last=("date", "max")))


if __name__ == "__main__":
    main()
