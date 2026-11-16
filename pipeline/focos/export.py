"""Write the static bundle the web app reads (format: docs/DATA_CONTRACT.md).

    python -m focos.export --work data/work --out web/public/data
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
from datetime import UTC, datetime

import numpy as np
import pandas as pd

from focos.grid import GRID, RECORD_START, SENSOR_NAMES, month_label
from focos.harmonize import M_VIIRS, MACRO, OVERLAP_YEARS
from focos.product import interval
from focos.regions import load_provinces, provinces_geojson

THRESH = 0.02   # model-estimated cell-months below this are dropped from the table (mass reported)
SERIES = ["modis_terra", "modis_aqua", "viirs_snpp", "viirs_noaa20"]
LABELS = {"modis_terra": "MODIS Terra", "modis_aqua": "MODIS Aqua", "viirs_snpp": "VIIRS S-NPP",
          "viirs_noaa20": "VIIRS NOAA-20"}

SOURCES = [
    {"name": "MODIS Collection 6.1 active fire detections (MCD14ML), distributed by NASA FIRMS",
     "doi": "10.5067/FIRMS/MODIS/MCD14ML", "url": "https://firms.modaps.eosdis.nasa.gov/"},
    {"name": "VIIRS S-NPP 375 m active fire detections, distributed by NASA FIRMS",
     "doi": "10.5067/FIRMS/VIIRS/VNP14IMGT_NRT.002", "url": "https://firms.modaps.eosdis.nasa.gov/"},
    {"name": "VIIRS NOAA-20 375 m active fire detections, distributed by NASA FIRMS",
     "doi": "10.5067/FIRMS/VIIRS/VJ114IMGT_NRT.002", "url": "https://firms.modaps.eosdis.nasa.gov/"},
    {"name": "VIIRS/NPP Active Fires 6-Min L2 Swath 375m V002 (VNP14IMG), NASA LP DAAC",
     "doi": "10.5067/VIIRS/VNP14IMG.002", "url": "https://doi.org/10.5067/VIIRS/VNP14IMG.002"},
    {"name": "VIIRS/JPSS1 Active Fires 6-Min L2 Swath 375m V002 (VJ114IMG), NASA LP DAAC",
     "doi": "10.5067/VIIRS/VJ114IMG.002", "url": "https://doi.org/10.5067/VIIRS/VJ114IMG.002"},
    {"name": "Giglio, Schroeder and Justice (2016). The collection 6 MODIS active fire detection algorithm "
             "and fire products. Remote Sensing of Environment 178.",
     "doi": "10.1016/j.rse.2016.02.054", "url": "https://doi.org/10.1016/j.rse.2016.02.054"},
    {"name": "Schroeder, Oliva, Giglio and Csiszar (2014). The New VIIRS 375 m active fire detection data "
             "product. Remote Sensing of Environment 143.",
     "doi": "10.1016/j.rse.2013.12.008", "url": "https://doi.org/10.1016/j.rse.2013.12.008"},
    {"name": "Natural Earth admin-1 boundaries (public domain)", "url": "https://www.naturalearthdata.com/"},
]


def _write_arrays(path: str, arrays: list[tuple[str, np.ndarray]]) -> list[dict]:
    """Concatenate typed arrays (4-byte aligned) and write them gzip-compressed to `path`.

    Offsets refer to the decompressed bytes. The reader sniffs the gzip magic bytes, so the file also
    works if a host decompresses it in transit.
    """
    meta, off, buf = [], 0, bytearray()
    for name, a in arrays:
        a = np.ascontiguousarray(a)
        pad = (-off) % 4
        if pad:
            buf += b"\0" * pad
            off += pad
        buf += a.astype(a.dtype.newbyteorder("<"), copy=False).tobytes()
        meta.append({"name": name, "dtype": str(a.dtype), "offset": off, "length": int(a.size)})
        off += a.nbytes
    with open(path, "wb") as f:
        f.write(gzip.compress(bytes(buf), compresslevel=9, mtime=0))
    return meta


def build_table(work: str, out: str, cells: np.ndarray, H: np.ndarray, prov: np.ndarray) -> dict:
    cm = pd.read_parquet(os.path.join(work, "cellmonth.parquet"))
    nc, nm = H.shape
    raw = {s: np.zeros((nc, nm), np.uint16) for s in SERIES}
    ci = np.searchsorted(cells, cm["cell"].to_numpy())
    for s in SERIES:
        raw[s][ci, cm["m"].to_numpy()] = np.minimum(cm[s].to_numpy(), 65535).astype(np.uint16)
    any_raw = np.zeros((nc, nm), bool)
    for s in SERIES:
        any_raw |= raw[s] > 0
    keep = any_raw | (H >= THRESH)
    dropped = float(H[~keep].sum())
    kc, km = np.nonzero(keep)            # row-major: sorted by cell, then month
    starts = np.zeros(nc + 1, np.uint32)
    np.add.at(starts, kc + 1, 1)
    starts = np.cumsum(starts).astype(np.uint32)
    arrays = [("cell_id", cells.astype(np.uint32)), ("cell_province", prov.astype(np.uint8)),
              ("cell_start", starts), ("month", km.astype(np.uint16)),
              ("harmonized", H[kc, km].astype(np.float32))]
    arrays += [(s, raw[s][kc, km]) for s in SERIES]
    meta = _write_arrays(os.path.join(out, "table.bin.gz"), arrays)
    print(f"table: {nc:,} cells, {len(kc):,} entries; dropped model mass {dropped:,.1f} "
          f"({100 * dropped / H.sum():.3f}% of all harmonized hotspots)")
    return {"file": "table.bin.gz", "n_cells": int(nc), "n_entries": int(len(kc)), "arrays": meta,
            "dropped_fraction": dropped / float(H.sum())}


def build_points(work: str, out: str) -> dict:
    det = pd.read_parquet(os.path.join(work, "detections.parquet"))
    versions = sorted(det["version"].unique().tolist())
    vidx = {v: i for i, v in enumerate(versions)}
    os.makedirs(os.path.join(out, "points"), exist_ok=True)
    years = {}
    for y, d in det.groupby(det["date"].dt.year):
        flags = d["night"].to_numpy().astype(np.uint8) | (d["used"].to_numpy().astype(np.uint8) << 1)
        arrays = [("lon", d["lon"].to_numpy(np.float32)), ("lat", d["lat"].to_numpy(np.float32)),
                  ("frp", d["frp"].to_numpy(np.float32)), ("bright", d["bright"].to_numpy(np.float32)),
                  ("day", d["date"].dt.dayofyear.to_numpy(np.uint16)), ("hhmm", d["hhmm"].to_numpy(np.uint16)),
                  ("sensor", d["sensor"].to_numpy(np.uint8)), ("conf", d["conf"].to_numpy(np.uint8)),
                  ("flags", flags), ("version", d["version"].map(vidx).to_numpy(np.uint8))]
        path = os.path.join(out, "points", f"{y}.bin.gz")
        meta = _write_arrays(path, arrays)
        years[str(y)] = {"n": int(len(d)), "bytes": os.path.getsize(path), "arrays": meta}
    with open(os.path.join(out, "points", "index.json"), "w") as f:
        json.dump({"versions": versions, "sensors": {"0": "Terra", "1": "Aqua", "2": "N", "3": "N20"},
                   "years": years}, f)
    total = sum(v["bytes"] for v in years.values())
    print(f"points: {sum(v['n'] for v in years.values()):,} detections in {len(years)} files, {total / 1e6:.0f} MB")
    return {"years": [int(min(years)), int(max(years))], "file_pattern": "points/{year}.bin.gz",
            "index": "points/index.json"}


def outage_runs(work: str) -> dict:
    avd = pd.read_parquet(os.path.join(work, "availability_daily.parquet"))
    out = {}
    for c in avd.columns:
        s = int(c)
        life = avd.index >= pd.Timestamp(RECORD_START[s])
        off = (avd[c] == 0) & life
        runs, start = [], None
        for day, v in zip(avd.index, off, strict=True):
            if v and start is None:
                start = day
            if not v and start is not None:
                runs.append([start.strftime("%Y-%m-%d"), (day - pd.Timedelta(days=1)).strftime("%Y-%m-%d")])
                start = None
        if start is not None:
            runs.append([start.strftime("%Y-%m-%d"), avd.index[-1].strftime("%Y-%m-%d")])
        out[SENSOR_NAMES[s]] = runs
    return out


def presets(provinces: list[dict]) -> list[dict]:
    pid = {p["name"]: p["id"] for p in provinces}
    out = [{"id": "country", "name": "All of Argentina", "name_es": "Toda la Argentina", "kind": "all"},
           {"id": "delta", "name": "Paraná Delta wetlands", "name_es": "Humedales del Delta del Paraná", "kind": "bbox", "bbox": [-60.8, -34.3, -58.4, -32.6]},
           {"id": "ibera", "name": "Iberá wetlands", "name_es": "Esteros del Iberá", "kind": "bbox", "bbox": [-58.0, -29.0, -56.5, -27.6]},
           {"id": "cordoba", "name": "Córdoba hills", "name_es": "Sierras de Córdoba", "kind": "bbox", "bbox": [-65.2, -32.6, -64.1, -30.4]},
           {"id": "andes", "name": "Andean Patagonia forests", "name_es": "Bosques andino-patagónicos", "kind": "bbox", "bbox": [-72.0, -43.6, -71.0, -40.8]},
           {"id": "chaco", "name": "Dry Chaco (Santiago del Estero)", "name_es": "Chaco Seco (Santiago del Estero)", "kind": "province",
            "province": pid.get("Santiago del Estero")},
           {"id": "lapampa", "name": "La Pampa grasslands", "name_es": "Pastizales de La Pampa", "kind": "province", "province": pid.get("La Pampa")}]
    return [p for p in out if p.get("kind") != "province" or p.get("province") is not None]


def build_validation(work: str, cells, H, prov, provinces, meta) -> dict:
    with open(os.path.join(work, "validation_raw.json")) as f:
        raw = json.load(f)
    z = np.load(os.path.join(work, "validation_raw_heldout.npz"))
    cm = pd.read_parquet(os.path.join(work, "cellmonth.parquet"))
    mav = pd.read_parquet(os.path.join(work, "availability_monthly.parquet"))
    nm = H.shape[1]
    labels = [month_label(m) for m in range(nm)]
    nat = cm.groupby("m")[SERIES].sum().reindex(range(nm)).fillna(0)

    # held-out national monthly series, overlap years
    mi, act = z["terra_aqua|loyo|mi"], z["terra_aqua|loyo|actual"]
    ms = np.unique(mi)
    def nat_sum(v):
        return pd.Series(v).groupby(mi).sum().reindex(ms).fillna(0).round(1).tolist()
    national = {"months": [labels[m] for m in ms], "viirs_snpp": nat_sum(act),
                "modis_terra": nat["modis_terra"].reindex(ms).tolist(),
                "modis_aqua": nat["modis_aqua"].reindex(ms).tolist(),
                "predicted": {**{k: nat_sum(z[f"terra_aqua|loyo|{k}"]) for k in ("none", "ratio", "ratio_local", "gbm")},
                              "blend": nat_sum(0.5 * (z["terra_aqua|loyo|gbm"] + z["terra_aqua|loyo|ratio_local"]))}}

    # annual national series
    unc = meta["uncertainty"]
    unc_t = meta["uncertainty_terra_only"]
    with open(os.path.join(work, "_sources.json")) as f:
        src = json.load(f)
    tot = H.sum(axis=0)
    lo, hi = tot.copy(), tot.copy()
    for m in range(nm):
        if src[m] in ("model", "model_terra"):
            pts = unc_t if src[m] == "model_terra" else unc
            s = np.interp(np.log10(max(tot[m], 0.5)), np.log10([p[0] for p in pts]), [p[1] for p in pts])
            lo[m], hi[m] = interval(tot[m], s)
    years = list(range(2001, 2026))
    yr = np.array([int(lab[:4]) for lab in labels])
    def ysum(v):
        return [round(float(np.asarray(v)[yr == y].sum()), 1) for y in years]
    naive = nat[SERIES].sum(axis=1).to_numpy()
    def from_year(vals, first):
        return [v if y >= first else None for y, v in zip(years, vals, strict=True)]
    annual = {"years": years, "naive_merge": ysum(naive),
              "modis_only": ysum(nat["modis_terra"] + nat["modis_aqua"]),
              "viirs_snpp": from_year(ysum(nat["viirs_snpp"]), 2012),
              "viirs_noaa20": from_year(ysum(nat["viirs_noaa20"]), 2018),
              "harmonized": ysum(tot), "harmonized_lo": ysum(lo), "harmonized_hi": ysum(hi)}

    ratio_years = list(range(2012, 2026))
    rby = [round(float(nat["viirs_snpp"][yr == y].sum() / max((nat["modis_terra"] + nat["modis_aqua"])[yr == y].sum(), 1)), 3)
           for y in ratio_years]
    cmo = cm[(cm["m"] >= M_VIIRS) & (cm["m"] < M_VIIRS + 12 * len(OVERLAP_YEARS))].copy()
    cmo["prov"] = prov[np.searchsorted(cells, cmo["cell"].to_numpy())]
    g = cmo.groupby("prov")[SERIES].sum()
    rbp = [{"province": int(p), "name": provinces[int(p)]["name"],
            "viirs_per_modis": round(float(r["viirs_snpp"] / max(r["modis_terra"] + r["modis_aqua"], 1)), 3),
            "n_modis": int(r["modis_terra"] + r["modis_aqua"])} for p, r in g.iterrows() if int(p) < 255]
    rbp.sort(key=lambda r: -r["viirs_per_modis"])

    rows = raw["rows"]
    chosen = meta["method"]

    return {
        "protocol": [
            "VIIRS S-NPP and MODIS both observed Argentina from 2012 onward. In those overlap years the true "
            "S-NPP count is known, so each harmonization method can be scored by hiding VIIRS and predicting it "
            "from MODIS alone, which is exactly what the method has to do for 2000 to 2011.",
            "Models are trained on 2012 to 2017: both sensors were on their nominal orbits, and the MODIS product "
            "version matches the one used for the years being reconstructed. The MODIS version and its static-"
            "source flagging change in 2018, so later years are used only as a forward check.",
            "Four tests. Leave one year out: train on five of the six overlap years, predict the sixth. Backcast: "
            "train on 2015 to 2017, predict 2012 to 2014, the closest analogue to reconstructing earlier years. "
            "Leave one region out: train without one of Argentina's five macro-regions and predict it. Forward: "
            "train on 2012 to 2017 and predict 2018 to 2021, across the MODIS version change.",
            "Every score is computed on predictions for data the method never saw. Counts are compared at four "
            "scales: 0.1 degree cells, 1 degree blocks, provinces and the whole country, by month.",
        ],
        "methods": [
            {"id": "none", "label": "No harmonization", "description": "MODIS Terra plus Aqua counts as they are. This is what a plain splice of the two records shows before 2012."},
            {"id": "ratio", "label": "National ratio", "description": "One VIIRS-to-MODIS ratio for the whole country, multiplied by the MODIS count."},
            {"id": "ratio_local", "label": "Local ratio", "description": "A VIIRS-to-MODIS ratio for each cell, pulled toward its 1 degree block and then the national ratio when the cell has few detections."},
            {"id": "gbm", "label": "Transfer model", "description": "Gradient-boosted trees that predict the S-NPP count of each cell and month from MODIS counts, fire radiative power, the share of small and night detections, neighbouring cells, season, position and the cell's past VIIRS-to-MODIS behaviour. It can predict small fires that only VIIRS sees."},
            {"id": "blend", "label": "Blend", "description": "The average of the transfer model and the local ratio, with equal weights fixed in advance. The two err in different places, so their average is steadier."},
        ],
        "tests": [
            {"id": "loyo", "label": "Leave one year out", "description": "2012 to 2017, six folds."},
            {"id": "backcast", "label": "Backcast", "description": "Train 2015 to 2017, predict 2012 to 2014."},
            {"id": "loro", "label": "Leave one region out", "description": "Five folds: " + ", ".join(MACRO) + "."},
            {"id": "forward", "label": "Forward", "description": "Train 2012 to 2017, predict 2018 to 2021 (new MODIS version)."},
        ],
        "metrics": rows,
        "metric_defs": {
            "log_rmse": "Typical error in log space: the root mean square of log(1 + predicted) minus log(1 + actual). 0.10 is roughly a 10% error.",
            "bias_pct": "Total predicted minus total actual, as a percent of actual. Negative means the method undercounts.",
            "spearman": "Rank correlation between predicted and actual counts across all region-months.",
            "season_r": "Within each region and year, the rank correlation of the twelve monthly values: does the method get the shape of the fire season right?",
            "peak_match": "Share of region-years where the method picks the same peak month as VIIRS.",
            "anomaly_agreement": "Share of region-months given the same anomaly class (below, normal, above, far above) from the predicted and the actual series.",
        },
        "chosen_method": chosen,
        "national_series": national,
        "annual_national": annual,
        "ratio_by_year": {"years": ratio_years, "viirs_per_modis": rby},
        "ratio_by_province": rbp,
        "uncertainty": {"points": unc, "points_terra_only": unc_t, "coverage80": meta["coverage80"]},
        "noaa20_per_snpp": round(1 / meta["n20_ratio"], 4),
        "outages": outage_runs(work),
        "feature_gain": meta["feature_gain"],
        "availability_monthly": {k: mav[k].reindex(range(nm)).fillna(0).round(3).tolist() for k in mav.columns},
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="data/work")
    ap.add_argument("--out", default="web/public/data")
    ap.add_argument("--admin1", default="data/raw/ne/ne_10m_admin_1.geojson")
    ap.add_argument("--skip-points", action="store_true")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    hz = np.load(os.path.join(a.work, "harmonized.npz"))
    cells, H, prov, source = hz["cells"], hz["H"], hz["prov"], hz["source"].tolist()
    with open(os.path.join(a.work, "_sources.json"), "w") as f:
        json.dump(source, f)
    with open(os.path.join(a.work, "harmonized_meta.json")) as f:
        meta = json.load(f)
    provinces = load_provinces(a.admin1)
    mav = pd.read_parquet(os.path.join(a.work, "availability_monthly.parquet"))
    nm = H.shape[1]
    labels = [month_label(m) for m in range(nm)]

    table = build_table(a.work, a.out, cells, H, prov)
    mpath = os.path.join(a.out, "manifest.json")
    if a.skip_points and os.path.exists(mpath):
        with open(mpath) as f:
            points = json.load(f)["points"]
    else:
        points = build_points(a.work, a.out)
    with open(os.path.join(a.out, "provinces.geojson"), "w") as f:
        json.dump(provinces_geojson(provinces), f, separators=(",", ":"))
    val = build_validation(a.work, cells, H, prov, provinces, meta)
    with open(os.path.join(a.out, "validation.json"), "w") as f:
        json.dump(val, f, separators=(",", ":"))

    first = {s: RECORD_START[k][:7] for k, s in SENSOR_NAMES.items()}
    manifest = {
        "version": 1,
        "generated": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "country": "Argentina",
        "bbox": [-73.6, -55.1, -53.6, -21.8],
        "grid": GRID.as_dict(),
        "months": {"start": labels[0], "n": nm, "labels": labels, "last_complete": labels[-1]},
        "series": [{"id": "harmonized", "label": "Harmonized (VIIRS-equivalent)", "dtype": "float32"}]
                  + [{"id": s, "label": LABELS[s], "dtype": "uint16", "first": first[s], "last": labels[-1]}
                     for s in SERIES],
        "availability": {k: mav[k].reindex(range(nm)).fillna(0).round(3).tolist() for k in SERIES},
        "month_source": source,
        "uncertainty": {"z80": 1.2816, "points": meta["uncertainty"],
                        "points_terra_only": meta["uncertainty_terra_only"]},
        "provinces": [{"id": p["id"], "name": p["name"]} for p in provinces],
        "presets": presets(provinces),
        "baseline": {"first_year": 2001, "last_year": 2025},
        "table": table,
        "points": points,
        "boundaries": "provinces.geojson",
        "validation": "validation.json",
        "sources": SOURCES,
        "harmonization": {"unit": "Hotspots a single VIIRS S-NPP observer would detect (nominal and high confidence, vegetation fires)",
                          "method": val["chosen_method"], "train_years": [2012, 2017],
                          "noaa20_per_snpp": round(1 / meta["n20_ratio"], 4)},
    }
    with open(os.path.join(a.out, "manifest.json"), "w") as f:
        json.dump(manifest, f, separators=(",", ":"))
    print("chosen method on held-out province-months:", val["chosen_method"])


if __name__ == "__main__":
    main()
