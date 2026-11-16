"""Put detections on a common grid and calendar, and work out when each sensor was observing.

Grid: regular 0.1 degree lon/lat cells (about 11 km by 9 km at these latitudes). Calendar: months,
index 0 = November 2000, the start of the MODIS Terra record.

Availability: a sensor is counted as not observing on a day when it reports no detections at all over
the country although the other sensors' detections imply it should have seen at least `EXPECT_MIN`
(each sensor's expected share comes from the days on which every sensor reported). This separates an
instrument outage from a day without fires, so the calendar can show "not observed" instead of zero.

    python -m focos.grid --det data/work/detections.parquet --out data/work
"""
from __future__ import annotations

import argparse
import os
from dataclasses import dataclass

import numpy as np
import pandas as pd

SENSOR_NAMES = {0: "modis_terra", 1: "modis_aqua", 2: "viirs_snpp", 3: "viirs_noaa20"}
RECORD_START = {0: "2000-11-01", 1: "2002-07-04", 2: "2012-01-20", 3: "2018-04-01"}
START_MONTH = pd.Timestamp("2000-11-01")
EXPECT_MIN = 8.0


@dataclass(frozen=True)
class Grid:
    res: float = 0.1
    lon0: float = -73.6
    lat0: float = -55.0
    nx: int = 200
    ny: int = 333

    def cell(self, lon, lat) -> np.ndarray:
        ix = np.floor((np.asarray(lon, float) - self.lon0) / self.res + 1e-9).astype(np.int64)
        iy = np.floor((np.asarray(lat, float) - self.lat0) / self.res + 1e-9).astype(np.int64)
        if (ix < 0).any() or (ix >= self.nx).any() or (iy < 0).any() or (iy >= self.ny).any():
            raise ValueError("detection outside the grid")
        return iy * self.nx + ix

    def center(self, cell) -> tuple[np.ndarray, np.ndarray]:
        cell = np.asarray(cell, np.int64)
        return (self.lon0 + (cell % self.nx + 0.5) * self.res, self.lat0 + (cell // self.nx + 0.5) * self.res)

    def as_dict(self) -> dict:
        return {"res": self.res, "lon0": self.lon0, "lat0": self.lat0, "nx": self.nx, "ny": self.ny}


GRID = Grid()


def month_index(dates: pd.Series) -> np.ndarray:
    d = pd.DatetimeIndex(dates)
    return ((d.year - START_MONTH.year) * 12 + (d.month - START_MONTH.month)).to_numpy(np.int32)


def month_label(m: int) -> str:
    return (START_MONTH + pd.DateOffset(months=int(m))).strftime("%Y-%m")


def availability(det: pd.DataFrame, end: str) -> pd.DataFrame:
    """Daily table: one boolean column per sensor, True when the sensor was observing."""
    days = pd.date_range(START_MONTH, end, freq="D")
    cnt = det.groupby(["date", "sensor"]).size().unstack("sensor").reindex(days).fillna(0.0)
    for s in SENSOR_NAMES:
        if s not in cnt:
            cnt[s] = 0.0
    cnt = cnt[list(SENSOR_NAMES)]
    in_life = pd.DataFrame({s: days >= pd.Timestamp(RECORD_START[s]) for s in SENSOR_NAMES}, index=days)
    avail = in_life.copy()
    for s in SENSOR_NAMES:
        others = [o for o in SENSOR_NAMES if o != s]
        # sensor s's share relative to the others, from days on which all live sensors reported
        both = in_life[s] & (cnt[s] > 0) & (cnt[others].where(in_life[others]).fillna(0).sum(axis=1) > 0)
        expected = np.zeros(len(days))
        for o in others:
            ok = both & in_life[o] & (cnt[o] > 0)
            if ok.sum() < 30:
                continue
            ratio = cnt.loc[ok, s].sum() / cnt.loc[ok, o].sum()
            expected = np.maximum(expected, np.where(in_life[o], cnt[o].to_numpy() * ratio, 0.0))
        avail[s] = in_life[s] & ~((cnt[s] == 0) & (expected >= EXPECT_MIN))
    avail.index.name = "date"
    return avail


def cell_month_counts(det: pd.DataFrame, avail: pd.DataFrame) -> pd.DataFrame:
    """Used-detection counts per cell, month and sensor, plus MODIS descriptors for the transfer model.

    VIIRS S-NPP counts are split by whether NOAA-20 was the only VIIRS observing that day, so gaps in
    S-NPP can be filled from NOAA-20.
    """
    u = det[det["used"]].copy()
    u["cell"] = GRID.cell(u["lon"], u["lat"])
    u["m"] = month_index(u["date"])
    snpp_up = avail[2].reindex(u["date"]).to_numpy()
    u["n20_fill"] = (u["sensor"] == 3) & ~snpp_up
    u["small"] = u["frp"] < 15.0

    keys = ["cell", "m"]
    out = None
    for s, name in SENSOR_NAMES.items():
        g = u[u["sensor"] == s].groupby(keys)
        part = pd.DataFrame({name: g.size()})
        if s in (0, 1):
            part[f"{name}_frp"] = g["frp"].sum()
            part[f"{name}_small"] = g["small"].sum()
            part[f"{name}_night"] = g["night"].sum()
            part[f"{name}_days"] = g["date"].nunique()
        if s == 3:
            part["viirs_noaa20_fill"] = g["n20_fill"].sum()
        out = part if out is None else out.join(part, how="outer")
    out = out.fillna(0).reset_index()
    for c in out.columns:
        if c not in ("cell", "m"):
            out[c] = out[c].astype(np.float32)
    return out


def monthly_availability(avail: pd.DataFrame) -> pd.DataFrame:
    a = avail.copy()
    a["m"] = month_index(a.index)
    frac = a.groupby("m")[list(SENSOR_NAMES)].mean()
    frac.columns = [SENSOR_NAMES[c] for c in frac.columns]
    return frac


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--det", default="data/work/detections.parquet")
    ap.add_argument("--out", default="data/work")
    ap.add_argument("--end", default="2025-12-31")
    a = ap.parse_args()
    det = pd.read_parquet(a.det)
    det = det[det["sensor"].isin(list(SENSOR_NAMES))]
    av = availability(det, a.end)
    av.astype(np.int8).to_parquet(os.path.join(a.out, "availability_daily.parquet"))
    mav = monthly_availability(av)
    mav.to_parquet(os.path.join(a.out, "availability_monthly.parquet"))
    cm = cell_month_counts(det, av)
    cm.to_parquet(os.path.join(a.out, "cellmonth.parquet"), index=False)
    for s, name in SENSOR_NAMES.items():
        off = (~av[s] & (av.index >= pd.Timestamp(RECORD_START[s]))).sum()
        print(f"{name:13s} days not observing within its record: {off}")
    print(f"cell-months with any detection: {len(cm):,}; active cells: {cm['cell'].nunique():,}")


if __name__ == "__main__":
    main()
