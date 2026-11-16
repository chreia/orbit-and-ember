"""MODIS-to-VIIRS transfer: estimate what VIIRS S-NPP would have counted, from what MODIS counted.

Why a transfer is needed. VIIRS (375 m pixels) resolves fires that MODIS (1 km) misses, so over the
same ground and the same weeks S-NPP reports about three times as many hotspots as Terra and Aqua
combined, and more where fires are small. Splicing MODIS before 2012 to VIIRS after makes the record
jump; adding every sensor makes it jump again when NOAA-20 arrives. The harmonized unit here is
"hotspots a single S-NPP-class VIIRS observer would detect", so the VIIRS era is used as observed and the
MODIS era is converted.

How it is learned. The overlap years 2012-2017 have both sensors on nominal orbits and the same MODIS
product version as the years being backcast, which later years do not (the MODIS version string and the
static-source flagging change in 2018). For every active 0.1 degree cell and month the methods predict
the S-NPP count from MODIS:

    none        MODIS Terra + Aqua counts as they are (what a plain splice uses before 2012)
    ratio       one national VIIRS/MODIS ratio times the MODIS count
    ratio_local a VIIRS/MODIS ratio per cell, shrunk toward its 1 degree block and then the national
                ratio when the cell has few detections
    gbm         gradient-boosted trees (Tweedie loss) on the cell's MODIS counts, fire radiative power,
                share of small and night detections, neighbouring-cell counts, month, position, and the
                cell's historical VIIRS/MODIS behaviour (out-of-fold), so it can predict VIIRS-only
                small fires where MODIS saw nothing nearby

Counts are first scaled to a full month by each sensor's observing fraction.

    python -m focos.harmonize evaluate     # held-out tests -> data/work/validation_raw.json
    python -m focos.harmonize fit          # final model -> data/work/harmonized.parquet
"""
from __future__ import annotations

import argparse
import json
import os
import time

import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy import ndimage
from scipy.stats import spearmanr

from focos.grid import GRID, month_label
from focos.regions import NONE, assign_cells, load_provinces

WORK = "data/work"
NE_ADMIN1 = "data/raw/ne/ne_10m_admin_1.geojson"
M_VIIRS = 134            # 2012-01
OVERLAP_YEARS = list(range(2012, 2018))
LATER_YEARS = [2018, 2019, 2020, 2021]
MIN_SNPP_AVAIL = 0.9
SHRINK_K = 20.0          # pseudo-count of MODIS detections when shrinking a local ratio

MACRO = {  # Argentina's customary statistical regions, for the leave-one-region-out test
    "Northwest": ["Jujuy", "Salta", "Tucumán", "Catamarca", "Santiago del Estero"],
    "Northeast": ["Formosa", "Chaco", "Misiones", "Corrientes"],
    "Cuyo": ["Mendoza", "San Juan", "San Luis", "La Rioja"],
    "Pampas": ["Buenos Aires", "Ciudad de Buenos Aires", "La Pampa", "Córdoba", "Santa Fe", "Entre Ríos"],
    "Patagonia": ["Neuquén", "Río Negro", "Chubut", "Santa Cruz", "Tierra del Fuego"],
}

GBM_PARAMS = dict(objective="tweedie", tweedie_variance_power=1.25, learning_rate=0.05, num_leaves=63,
                  min_data_in_leaf=200, feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=1,
                  lambda_l2=1.0, verbose=-1, num_threads=18, seed=7)
GBM_ROUNDS = 500


# --------------------------------------------------------------------------------------------- data
class Panel:
    """Every active cell x every month, with MODIS features and the S-NPP target where it exists."""

    def __init__(self, work: str = WORK, admin1: str = NE_ADMIN1):
        cm = pd.read_parquet(os.path.join(work, "cellmonth.parquet"))
        self.mav = pd.read_parquet(os.path.join(work, "availability_monthly.parquet"))
        self.avd = pd.read_parquet(os.path.join(work, "availability_daily.parquet"))
        self.n_months = int(self.mav.index.max()) + 1
        self.cells = np.sort(cm["cell"].unique())
        nc, nm = len(self.cells), self.n_months
        lon, lat = GRID.center(self.cells)
        self.lon, self.lat = lon, lat
        self.provinces = load_provinces(admin1)
        self.prov = assign_cells(lon, lat, self.provinces)
        name_to_macro = {p: k for k, ps in MACRO.items() for p in ps}
        prov_names = [p["name"] for p in self.provinces]
        unknown = sorted(set(prov_names) - set(name_to_macro))
        if unknown:
            raise SystemExit(f"provinces missing from MACRO: {unknown}")
        macro_names = list(MACRO)
        self.macro = np.array([macro_names.index(name_to_macro[prov_names[p]]) if p != NONE else -1
                               for p in self.prov])
        self.block = (np.floor(lon).astype(int) + 200) * 1000 + (np.floor(lat).astype(int) + 200)

        ci = np.searchsorted(self.cells, cm["cell"].to_numpy())
        mi = cm["m"].to_numpy()

        def dense(col):
            a = np.zeros((nc, nm), np.float32)
            a[ci, mi] = cm[col].to_numpy()
            return a

        self.raw = {k: dense(k) for k in ["modis_terra", "modis_aqua", "viirs_snpp", "viirs_noaa20",
                                          "viirs_noaa20_fill"]}
        av = {k: self.mav[k].reindex(range(nm)).fillna(0).to_numpy(np.float32) for k in self.mav.columns}
        self.avail = av
        scale_t = np.where(av["modis_terra"] > 0, 1 / np.maximum(av["modis_terra"], 0.3), np.nan)
        scale_a = np.where(av["modis_aqua"] > 0, 1 / np.maximum(av["modis_aqua"], 0.3), np.nan)
        t = self.raw["modis_terra"] * scale_t[None, :]
        a = self.raw["modis_aqua"] * scale_a[None, :]
        self.t, self.a = t, a
        self.has_t = av["modis_terra"] > 0
        self.has_a = av["modis_aqua"] > 0
        frp = dense("modis_terra_frp") + dense("modis_aqua_frp")
        small = dense("modis_terra_small") + dense("modis_aqua_small")
        night = dense("modis_terra_night") + dense("modis_aqua_night")
        n_mod = self.raw["modis_terra"] + self.raw["modis_aqua"]
        with np.errstate(invalid="ignore", divide="ignore"):
            self.frp_mean = np.where(n_mod > 0, frp / np.maximum(n_mod, 1), np.nan).astype(np.float32)
            self.small_frac = np.where(n_mod > 0, small / np.maximum(n_mod, 1), np.nan).astype(np.float32)
            self.night_frac = np.where(n_mod > 0, night / np.maximum(n_mod, 1), np.nan).astype(np.float32)
        # Terra-only descriptors, for the months before Aqua
        tfrp, tsm = dense("modis_terra_frp"), dense("modis_terra_small")
        with np.errstate(invalid="ignore", divide="ignore"):
            nt = self.raw["modis_terra"]
            self.t_frp_mean = np.where(nt > 0, tfrp / np.maximum(nt, 1), np.nan).astype(np.float32)
            self.t_small_frac = np.where(nt > 0, tsm / np.maximum(nt, 1), np.nan).astype(np.float32)

        # neighbourhood sums on the full grid
        self.t3, self.t7 = self._neigh(np.nan_to_num(t), 3), self._neigh(np.nan_to_num(t), 7)
        self.a3, self.a7 = self._neigh(np.nan_to_num(a), 3), self._neigh(np.nan_to_num(a), 7)

        # MODIS climatology of each cell (Terra+Aqua years 2003-2025, MODIS only, so no VIIRS leaks in)
        yrs = self.year_of_month()
        sel = (yrs >= 2003) & (yrs <= 2025)
        ma = np.nan_to_num(t) + np.nan_to_num(a)
        self.clim = ma[:, sel].mean(axis=1).astype(np.float32)
        moy = self.moy()
        self.clim_moy = np.stack([ma[:, sel & (moy == k)].mean(axis=1) for k in range(1, 13)], axis=1)
        tt = np.nan_to_num(t)
        self.clim_t = tt[:, (yrs >= 2001) & (yrs <= 2025)].mean(axis=1).astype(np.float32)

        sn = av["viirs_snpp"]
        self.target_ok = sn >= MIN_SNPP_AVAIL
        self.v = self.raw["viirs_snpp"] / np.maximum(sn, 1e-6)[None, :]

    def _neigh(self, x: np.ndarray, k: int) -> np.ndarray:
        nm = x.shape[1]
        out = np.zeros_like(x)
        iy, ix = self.cells // GRID.nx, self.cells % GRID.nx
        g = np.zeros((GRID.ny, GRID.nx), np.float32)
        for m in range(nm):
            g[:] = 0
            g[iy, ix] = x[:, m]
            s = ndimage.uniform_filter(g, size=k, mode="constant") * (k * k)
            out[:, m] = s[iy, ix]
        return out

    def year_of_month(self) -> np.ndarray:
        return np.array([int(month_label(m)[:4]) for m in range(self.n_months)])

    def moy(self) -> np.ndarray:
        return np.array([int(month_label(m)[5:7]) for m in range(self.n_months)])


# ----------------------------------------------------------------------------- local VIIRS behaviour
def local_stats(P: Panel, months: np.ndarray, cell_mask: np.ndarray | None = None) -> dict:
    """Shrunk VIIRS/MODIS ratio and VIIRS-only background per cell from the given months (and cells)."""
    ok = np.zeros(P.n_months, bool)
    ok[months] = True
    ok &= P.target_ok & P.has_t & P.has_a
    cm = np.ones(len(P.cells), bool) if cell_mask is None else cell_mask
    ma = np.nan_to_num(P.t[:, ok]) + np.nan_to_num(P.a[:, ok])
    v = P.v[:, ok]
    ma[~cm] = 0
    v = np.where(cm[:, None], v, 0)
    sv, sm = v.sum(1), ma.sum(1)
    r_g = sv.sum() / max(sm.sum(), 1)
    dfb = pd.DataFrame({"b": P.block, "sv": sv, "sm": sm})
    gb = dfb.groupby("b")[["sv", "sm"]].sum()
    r_b_map = (gb["sv"] + SHRINK_K * r_g) / (gb["sm"] + SHRINK_K)
    r_b = r_b_map.reindex(P.block).fillna(r_g).to_numpy()
    r_c = (sv + SHRINK_K * r_b) / (sm + SHRINK_K)
    # VIIRS counted in months with no MODIS detection within the 3x3 neighbourhood
    quiet = (np.nan_to_num(P.t3[:, ok]) + np.nan_to_num(P.a3[:, ok])) == 0
    quiet &= cm[:, None]
    n_q = quiet.sum(1)
    bg_sum = np.where(quiet, v, 0).sum(1)
    bg_g = bg_sum.sum() / max(n_q.sum(), 1)
    dq = pd.DataFrame({"b": P.block, "s": bg_sum, "n": n_q}).groupby("b")[["s", "n"]].sum()
    bg_b = ((dq["s"] + 12 * bg_g) / (dq["n"] + 12)).reindex(P.block).fillna(bg_g).to_numpy()
    bg_c = (bg_sum + 12 * bg_b) / (n_q + 12)
    return {"r_g": float(r_g), "r_c": r_c.astype(np.float32), "bg_c": bg_c.astype(np.float32)}


FEATURES = ["t", "a", "t3", "a3", "t7", "a7", "frp_mean", "small_frac", "night_frac", "moy", "lat", "lon",
            "clim", "clim_moy", "r_c", "bg_c", "avail_t", "avail_a"]
FEATURES_T = ["t", "t3", "t7", "frp_mean", "small_frac", "moy", "lat", "lon", "clim_t", "r_c", "bg_c",
              "avail_t"]


def design(P: Panel, cells_idx: np.ndarray, months: np.ndarray, stats_by_month: dict, terra_only=False):
    """Feature matrix for every (cell in cells_idx) x (month in months)."""
    ci = np.repeat(cells_idx, len(months))
    mi = np.tile(months, len(cells_idx))
    r_c = np.empty(len(ci), np.float32)
    bg_c = np.empty(len(ci), np.float32)
    for key, st in stats_by_month.items():   # key: tuple of months sharing one set of stats
        sel = np.isin(mi, key)
        r_c[sel] = st["r_c"][ci[sel]]
        bg_c[sel] = st["bg_c"][ci[sel]]
    moy = P.moy()[mi]
    if terra_only:
        X = pd.DataFrame({
            "t": P.t[ci, mi], "t3": P.t3[ci, mi], "t7": P.t7[ci, mi],
            "frp_mean": P.t_frp_mean[ci, mi], "small_frac": P.t_small_frac[ci, mi], "moy": moy,
            "lat": P.lat[ci], "lon": P.lon[ci], "clim_t": P.clim_t[ci], "r_c": r_c, "bg_c": bg_c,
            "avail_t": P.avail["modis_terra"][mi],
        })[FEATURES_T]
    else:
        X = pd.DataFrame({
            "t": P.t[ci, mi], "a": P.a[ci, mi], "t3": P.t3[ci, mi], "a3": P.a3[ci, mi],
            "t7": P.t7[ci, mi], "a7": P.a7[ci, mi], "frp_mean": P.frp_mean[ci, mi],
            "small_frac": P.small_frac[ci, mi], "night_frac": P.night_frac[ci, mi], "moy": moy,
            "lat": P.lat[ci], "lon": P.lon[ci], "clim": P.clim[ci], "clim_moy": P.clim_moy[ci, moy - 1],
            "r_c": r_c, "bg_c": bg_c, "avail_t": P.avail["modis_terra"][mi],
            "avail_a": P.avail["modis_aqua"][mi],
        })[FEATURES]
    return X, ci, mi


def months_of_years(P: Panel, years) -> np.ndarray:
    y = P.year_of_month()
    return np.where(np.isin(y, list(years)))[0]


def fit_gbm(P: Panel, train_years, train_cells: np.ndarray, terra_only=False):
    """Fit on train_years x train_cells with out-of-fold (leave-one-year-out) local statistics."""
    rows_X, rows_y = [], []
    cmask = np.zeros(len(P.cells), bool)
    cmask[train_cells] = True
    for y in train_years:
        mths = months_of_years(P, [y])
        mths = mths[P.target_ok[mths]]
        if not len(mths):
            continue
        st = local_stats(P, months_of_years(P, [o for o in train_years if o != y]), cmask)
        X, ci, mi = design(P, train_cells, mths, {tuple(mths): st}, terra_only)
        rows_X.append(X)
        rows_y.append(P.v[ci, mi])
    X = pd.concat(rows_X, ignore_index=True)
    yv = np.concatenate(rows_y)
    model = lgb.train(GBM_PARAMS, lgb.Dataset(X, yv, free_raw_data=True), num_boost_round=GBM_ROUNDS)
    full_stats = local_stats(P, months_of_years(P, train_years), cmask)
    return model, full_stats


def predict_methods(P: Panel, train_years, train_cells, test_cells, test_months, methods, terra_only=False):
    """Predictions of the S-NPP count for test_cells x test_months under each method."""
    cmask = np.zeros(len(P.cells), bool)
    cmask[train_cells] = True
    st = local_stats(P, months_of_years(P, train_years), cmask)
    ci = np.repeat(test_cells, len(test_months))
    mi = np.tile(test_months, len(test_cells))
    t = np.nan_to_num(P.t[ci, mi])
    a = np.zeros_like(t) if terra_only else np.nan_to_num(P.a[ci, mi])
    if terra_only:  # national Terra-only ratio for the simple baselines
        ok = np.zeros(P.n_months, bool)
        ok[months_of_years(P, train_years)] = True
        ok &= P.target_ok & P.has_t
        r_t = P.v[np.ix_(train_cells, np.where(ok)[0])].sum() / max(
            np.nan_to_num(P.t[np.ix_(train_cells, np.where(ok)[0])]).sum(), 1)
    out = {}
    if "none" in methods:
        out["none"] = t + a
    if "ratio" in methods:
        out["ratio"] = (r_t if terra_only else st["r_g"]) * (t + a)
    if "ratio_local" in methods:
        rc = st["r_c"][ci]
        if terra_only:
            rc = rc * (r_t / st["r_g"])
        out["ratio_local"] = rc * (t + a)
    if "gbm" in methods:
        model, fst = fit_gbm(P, train_years, train_cells, terra_only)
        X, _, _ = design(P, test_cells, test_months, {tuple(test_months): fst}, terra_only)
        out["gbm"] = np.maximum(model.predict(X), 0)
    return out, ci, mi


# ------------------------------------------------------------------------------------------ metrics
MIN_SPREAD = 0.3     # floor on the log-scale spread, so near-constant months do not inflate z
MIN_EXCESS = 5.0     # a month is only unusual if it differs from the usual count by this many hotspots


def anomaly_z(x: np.ndarray) -> np.ndarray:
    """x: (n_years, 12). Robust z per calendar month, as the app computes it."""
    lx = np.log1p(x)
    med = np.median(lx, axis=0)
    mad = np.median(np.abs(lx - med), axis=0)
    return (lx - med) / np.maximum(1.4826 * mad, MIN_SPREAD)


def anomaly_classes(x: np.ndarray) -> np.ndarray:
    """0 below, 1 normal, 2 above, 3 far above; small absolute differences stay normal."""
    z = anomaly_z(x)
    c = np.select([z >= 2, z >= 1, z > -1], [3, 2, 1], 0)
    small = np.abs(x - np.median(x, axis=0)) < MIN_EXCESS
    return np.where(small, 1, c)


def aggregate(values: np.ndarray, ci: np.ndarray, mi: np.ndarray, key: np.ndarray) -> pd.Series:
    df = pd.DataFrame({"k": key[ci], "m": mi, "v": values})
    return df.groupby(["k", "m"])["v"].sum()


def level_metrics(pred: np.ndarray, actual: np.ndarray, ci, mi, key, min_actual=0.0) -> dict:
    p = aggregate(pred, ci, mi, key)
    a = aggregate(actual, ci, mi, key)
    keep = (a > min_actual) | (p > min_actual)
    p, a = p[keep], a[keep]
    lr = np.log1p(p.to_numpy()) - np.log1p(a.to_numpy())
    return {
        "log_rmse": float(np.sqrt(np.mean(lr ** 2))),
        "bias_pct": float(100 * (p.sum() - a.sum()) / max(a.sum(), 1)),
        "spearman": float(spearmanr(p.to_numpy(), a.to_numpy()).statistic) if len(p) > 2 else None,
        "n": int(len(p)),
    }


def calendar_metrics(pred, actual, ci, mi, key, P: Panel, years) -> dict:
    """Agreement on what the calendar shows: seasonal shape, peak month and anomaly class."""
    p = aggregate(pred, ci, mi, key).unstack(fill_value=0)
    a = aggregate(actual, ci, mi, key).unstack(fill_value=0)
    yrs_of_m = P.year_of_month()
    moy = P.moy()
    shape_r, peak, agree, n_cls = [], [], 0, 0
    for k in a.index:
        pa = p.loc[k] if k in p.index else pd.Series(0.0, index=a.columns)
        aa = a.loc[k]
        P12 = np.zeros((len(years), 12))
        A12 = np.zeros((len(years), 12))
        for j, y in enumerate(years):
            for c in range(1, 13):
                ms = np.where((yrs_of_m == y) & (moy == c))[0]
                if len(ms) and ms[0] in aa.index:
                    A12[j, c - 1] = aa.get(ms[0], 0)
                    P12[j, c - 1] = pa.get(ms[0], 0)
        for j in range(len(years)):
            if A12[j].sum() >= 30:
                shape_r.append(spearmanr(P12[j], A12[j]).statistic)
                peak.append(int(np.argmax(P12[j]) == np.argmax(A12[j])))
        if A12.sum() >= 30 * len(years):
            ca, cp = anomaly_classes(A12), anomaly_classes(P12)
            agree += int((ca == cp).sum())
            n_cls += ca.size
    return {
        "season_r": float(np.nanmean(shape_r)) if shape_r else None,
        "peak_match": float(np.mean(peak)) if peak else None,
        "anomaly_agreement": float(agree / n_cls) if n_cls else None,
    }


# --------------------------------------------------------------------------------------- evaluation
METHODS = ["none", "ratio", "ratio_local", "gbm"]


def evaluate(P: Panel, out_path: str) -> dict:
    all_cells = np.arange(len(P.cells))
    tests = []
    for y in OVERLAP_YEARS:
        tests.append(("loyo", f"{y}", [o for o in OVERLAP_YEARS if o != y], all_cells, [y], all_cells))
    tests.append(("backcast", "2012-2014", [2015, 2016, 2017], all_cells, [2012, 2013, 2014], all_cells))
    for r, name in enumerate(MACRO):
        tr = np.where(P.macro != r)[0]
        te = np.where(P.macro == r)[0]
        tests.append(("loro", name, OVERLAP_YEARS, tr, OVERLAP_YEARS, te))
    tests.append(("forward", "2018-2021", OVERLAP_YEARS, all_cells, LATER_YEARS, all_cells))

    pooled: dict = {}
    for variant, terra_only in (("terra_aqua", False), ("terra_only", True)):
        for test, fold, tr_years, tr_cells, te_years, te_cells in tests:
            if terra_only and test not in ("loyo", "backcast"):
                continue
            t0 = time.time()
            te_m = months_of_years(P, te_years)
            te_m = te_m[P.target_ok[te_m] & P.has_t[te_m] & (terra_only | P.has_a[te_m])]
            preds, ci, mi = predict_methods(P, tr_years, tr_cells, te_cells, te_m, METHODS, terra_only)
            actual = P.v[ci, mi]
            store = pooled.setdefault((variant, test), {"ci": [], "mi": [], "actual": [],
                                                         **{m: [] for m in METHODS}})
            store["ci"].append(ci)
            store["mi"].append(mi)
            store["actual"].append(actual)
            for m in METHODS:
                store[m].append(preds[m])
            print(f"{variant:10s} {test:8s} {fold:12s} rows={len(ci):>9,} {time.time() - t0:5.1f}s "
                  + " ".join(f"{m}={100 * (preds[m].sum() - actual.sum()) / actual.sum():+.0f}%"
                             for m in METHODS), flush=True)

    held = {}
    for (variant, test), st in pooled.items():
        ci, mi, actual = (np.concatenate(st[k]) for k in ("ci", "mi", "actual"))
        held[(variant, test)] = (ci, mi, actual, {m: np.concatenate(st[m]) for m in METHODS})
    np.savez_compressed(out_path.replace(".json", "_heldout.npz"),
                        **{f"{v}|{t}|{k}": val for (v, t), (ci, mi, act, pr) in held.items()
                           for k, val in {"ci": ci, "mi": mi, "actual": act, **pr}.items()})
    return score(P, held, out_path)


def score_keys(P: Panel) -> dict:
    return {
        "cell-month": np.arange(len(P.cells)),
        "block-month": P.block,
        "province-month": P.prov.astype(int),
        "national-month": np.zeros(len(P.cells), int),
    }


BLEND = ("gbm", "ratio_local")   # fixed equal weights, chosen before seeing blended scores


def with_blend(preds: dict) -> dict:
    if all(k in preds for k in BLEND):
        preds = {**preds, "blend": 0.5 * (preds[BLEND[0]] + preds[BLEND[1]])}
    return preds


def choose_method(rows: list[dict]) -> str:
    """The product's method: lowest mean province-month log error over the leave-one-year-out and
    backcast tests (Terra+Aqua), the two tests that mimic reconstructing earlier years."""
    def err(m):
        sel = [r["log_rmse"] for r in rows if r["variant"] == "terra_aqua" and r["method"] == m
               and r["level"] == "province-month" and r["test"] in ("loyo", "backcast")]
        return float(np.mean(sel)) if sel else np.inf
    return min(sorted({r["method"] for r in rows if r["method"] != "none"}), key=err)


def score(P: Panel, held: dict, out_path: str) -> dict:
    """Metrics for every (variant, test, method, level) from pooled held-out predictions."""
    rows = []
    for (variant, test), (ci, mi, actual, preds) in held.items():
        preds = with_blend(preds)
        years = sorted(set(P.year_of_month()[np.unique(mi)]))
        for m in preds:
            for level, key in score_keys(P).items():
                r = {"variant": variant, "method": m, "test": test, "level": level,
                     **level_metrics(preds[m], actual, ci, mi, key)}
                if level in ("province-month", "national-month"):
                    r.update(calendar_metrics(preds[m], actual, ci, mi, key, P, years))
                rows.append(r)
    res = {"rows": rows}
    with open(out_path, "w") as f:
        json.dump(res, f, indent=1)
    return res


def rescore(P: Panel, out_path: str) -> dict:
    """Recompute the metrics from saved held-out predictions with the current metric definitions."""
    z = np.load(out_path.replace(".json", "_heldout.npz"))
    held = {}
    for k in z.files:
        v, t, name = k.split("|")
        if name != "ci":
            continue
        held[(v, t)] = (z[f"{v}|{t}|ci"], z[f"{v}|{t}|mi"], z[f"{v}|{t}|actual"],
                        {m: z[f"{v}|{t}|{m}"] for m in METHODS})
    return score(P, held, out_path)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["evaluate", "rescore", "fit", "uncertainty"])
    ap.add_argument("--work", default=WORK)
    a = ap.parse_args()
    t0 = time.time()
    P = Panel(a.work)
    print(f"panel: {len(P.cells):,} cells x {P.n_months} months ({time.time() - t0:.0f}s)", flush=True)
    if a.cmd == "evaluate":
        evaluate(P, os.path.join(a.work, "validation_raw.json"))
    elif a.cmd == "rescore":
        rescore(P, os.path.join(a.work, "validation_raw.json"))
    elif a.cmd == "uncertainty":
        from focos.product import refresh_uncertainty
        refresh_uncertainty(P, a.work)
    else:
        from focos.product import build_product
        build_product(P, a.work)


if __name__ == "__main__":
    main()
