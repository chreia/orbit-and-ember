"""Build the harmonized cell-month record from the final transfer model.

For each active cell and month:

    before VIIRS (to 2011-12)   harmonized = model estimate from MODIS (Terra-only model before Aqua)
    VIIRS era (from 2012-01)    harmonized = S-NPP count on days S-NPP observed
                                           + NOAA-20 count x (S-NPP/NOAA-20 ratio) on days only NOAA-20 did
                                           + model estimate x (share of the month neither VIIRS observed)

The uncertainty of model months is measured, not assumed: held-out predictions from the leave-one-year-
out test are summed over regions of many sizes, and the spread of log(actual / predicted) is tabulated
against the predicted total. The app turns that table into an 80% interval for any region.
"""
from __future__ import annotations

import json
import os

import numpy as np
import pandas as pd

from focos.grid import RECORD_START, month_index
from focos.harmonize import (
    BLEND,
    M_VIIRS,
    OVERLAP_YEARS,
    Panel,
    choose_method,
    design,
    fit_gbm,
    local_stats,
    months_of_years,
)

Z80 = 1.2816


def fill_fractions(P: Panel) -> tuple[np.ndarray, np.ndarray]:
    """Per month: share of days with only NOAA-20 observing, and with no VIIRS observing (VIIRS era)."""
    d = P.avd.copy()
    d.columns = [int(c) for c in d.columns]
    d["m"] = month_index(d.index)
    era = d.index >= pd.Timestamp("2012-01-01")
    only_n20 = (d[2] == 0) & (d[3] == 1) & era
    none = (d[2] == 0) & (d[3] == 0) & era
    g = pd.DataFrame({"m": d["m"], "f": only_n20, "g": none}).groupby("m").mean()
    f = g["f"].reindex(range(P.n_months)).fillna(0).to_numpy()
    gap = g["g"].reindex(range(P.n_months)).fillna(0).to_numpy()
    return f, gap


def n20_ratio(P: Panel) -> float:
    av = P.avail
    ok = (av["viirs_snpp"] >= 0.999) & (av["viirs_noaa20"] >= 0.999)
    return float(P.raw["viirs_snpp"][:, ok].sum() / max(P.raw["viirs_noaa20"][:, ok].sum(), 1))


def heldout(heldout_path: str, variant: str, test: str, method: str):
    z = np.load(heldout_path)
    ci, mi, act = (z[f"{variant}|{test}|{k}"] for k in ("ci", "mi", "actual"))
    if method == "blend":
        pred = 0.5 * (z[f"{variant}|{test}|{BLEND[0]}"] + z[f"{variant}|{test}|{BLEND[1]}"])
    else:
        pred = z[f"{variant}|{test}|{method}"]
    return ci, mi, act, pred


def _pav_decreasing(y: np.ndarray, w: np.ndarray) -> np.ndarray:
    """Weighted pool-adjacent-violators fit that is non-increasing in x."""
    blocks = [[float(v), float(wt), 1] for v, wt in zip(y, w, strict=True)]
    i = 0
    while i < len(blocks) - 1:
        if blocks[i][0] < blocks[i + 1][0]:
            v0, w0, n0 = blocks[i]
            v1, w1, n1 = blocks[i + 1]
            blocks[i] = [(v0 * w0 + v1 * w1) / (w0 + w1), w0 + w1, n0 + n1]
            del blocks[i + 1]
            i = max(i - 1, 0)
        else:
            i += 1
    return np.concatenate([[v] * n for v, _, n in blocks])


def region_months(P: Panel, ci, mi, act, pred):
    """Held-out (predicted, actual) totals for regions a user would select: 0.5 to 8 degree blocks,
    provinces and the whole country."""
    lon, lat = P.lon[ci], P.lat[ci]
    keys = []
    for size in (0.5, 1.0, 2.0, 4.0, 8.0):
        keys.append(np.floor((lon + 80) / size).astype(np.int64) * 10000 + np.floor((lat + 60) / size).astype(np.int64))
    keys += [P.prov[ci].astype(np.int64), np.zeros(len(ci), np.int64)]
    p_all, a_all = [], []
    for key in keys:
        df = pd.DataFrame({"k": key, "m": mi, "p": pred, "a": act}).groupby(["k", "m"]).sum()
        p_all.append(df["p"].to_numpy())
        a_all.append(df["a"].to_numpy())
    return np.concatenate(p_all), np.concatenate(a_all)


def uncertainty_table(heldout_path: str, P: Panel, variant: str, method: str) -> list[list[float]]:
    """[[predicted_total, s]]: Z80*s is the 80th percentile of |log((a+0.5)/(p+0.5))| among held-out
    region-months (leave one year out) whose predicted total is near that value, smoothed to be
    non-increasing in the total. The interval p*exp(+-Z80*s) is then checked on the backcast test."""
    ci, mi, act, pred = heldout(heldout_path, variant, "loyo", method)
    p, a = region_months(P, ci, mi, act, pred)
    keep = p >= 0.5
    p, a = p[keep], a[keep]
    lr = np.abs(np.log((a + 0.5) / (p + 0.5)))
    edges = 10 ** np.arange(-0.5, 5.6, 0.5)
    xs, ss, ws = [], [], []
    for lo, hi in zip(edges[:-1], edges[1:], strict=True):
        sel = (p >= lo) & (p < hi)
        if sel.sum() < 30:
            continue
        xs.append(float(np.sqrt(lo * hi)))
        ss.append(float(np.quantile(lr[sel], 0.8) / Z80))
        ws.append(float(sel.sum()))
    ss = _pav_decreasing(np.array(ss), np.array(ws))
    return [[x, float(v)] for x, v in zip(xs, ss, strict=True)]


def coverage(heldout_path: str, P: Panel, variant: str, test: str, pts, method: str) -> float:
    """Share of held-out region-months (same region set as the table) whose actual total falls inside
    the 80% interval."""
    ci, mi, act, pred = heldout(heldout_path, variant, test, method)
    p, a = region_months(P, ci, mi, act, pred)
    keep = p >= 0.5
    p, a = p[keep], a[keep]
    s = np.interp(np.log10(p), np.log10([q[0] for q in pts]), [q[1] for q in pts])
    lo, hi = interval(p, s)
    return float(np.mean((a >= lo) & (a <= hi)))


def interval(x, s):
    """80% interval for a model total x with spread s, in the same offset-log space as the errors."""
    x = np.asarray(x, float)
    return np.maximum(0.0, (x + 0.5) * np.exp(-Z80 * s) - 0.5), (x + 0.5) * np.exp(Z80 * s) - 0.5


def ratio_predictions(P: Panel, local: bool) -> np.ndarray:
    """National or local VIIRS/MODIS ratio times the MODIS count, every cell and month."""
    st = local_stats(P, months_of_years(P, OVERLAP_YEARS))
    t, a = np.nan_to_num(P.t), np.nan_to_num(P.a)
    ok = np.zeros(P.n_months, bool)
    ok[months_of_years(P, OVERLAP_YEARS)] = True
    ok &= P.target_ok & P.has_t
    r_t = P.v[:, ok].sum() / max(t[:, ok].sum(), 1)          # Terra-only national ratio
    r = st["r_c"][:, None] if local else st["r_g"]
    out = r * (t + a)
    terra_only = P.has_t & ~P.has_a
    out[:, terra_only] = (r * (r_t / st["r_g"]) * t)[:, terra_only]
    out[:, ~(P.has_t | P.has_a)] = np.nan
    return out.astype(np.float32)


def gbm_predictions(P: Panel) -> tuple[np.ndarray, dict]:
    all_cells = np.arange(len(P.cells))
    months = np.arange(P.n_months)
    pred = np.full((len(P.cells), P.n_months), np.nan, np.float32)
    model, fst = fit_gbm(P, OVERLAP_YEARS, all_cells, terra_only=False)
    m_ta = months[P.has_t & P.has_a]
    X, ci, mi = design(P, all_cells, m_ta, {tuple(m_ta): fst})
    pred[ci, mi] = np.maximum(model.predict(X), 0)
    imp = dict(zip(X.columns, model.feature_importance("gain").round(1).tolist(), strict=True))
    model_t, fst_t = fit_gbm(P, OVERLAP_YEARS, all_cells, terra_only=True)
    m_t = months[P.has_t & ~P.has_a]
    if len(m_t):
        X, ci, mi = design(P, all_cells, m_t, {tuple(m_t): fst_t}, terra_only=True)
        pred[ci, mi] = np.maximum(model_t.predict(X), 0)
    # Aqua-only months (Terra down for a whole month) use the Terra+Aqua model with Terra = 0
    m_a = months[~P.has_t & P.has_a]
    if len(m_a):
        X, ci, mi = design(P, all_cells, m_a, {tuple(m_a): fst})
        pred[ci, mi] = np.maximum(model.predict(X), 0)
    return pred, imp


def build_product(P: Panel, work: str) -> None:
    months = np.arange(P.n_months)
    with open(os.path.join(work, "validation_raw.json")) as f:
        method = choose_method(json.load(f)["rows"])
    imp: dict = {}
    if method in ("gbm", "blend"):
        pred_gbm, imp = gbm_predictions(P)
    if method == "gbm":
        pred = pred_gbm
    elif method == "blend":
        pred = 0.5 * (pred_gbm + ratio_predictions(P, local=True))
    else:
        pred = ratio_predictions(P, local=(method == "ratio_local"))
    print(f"product method: {method}", flush=True)

    f_fill, f_gap = fill_fractions(P)
    r20 = n20_ratio(P)
    H = np.where(np.isnan(pred), 0, pred).astype(np.float32)
    viirs = months >= M_VIIRS
    H[:, viirs] = (P.raw["viirs_snpp"][:, viirs] + r20 * P.raw["viirs_noaa20_fill"][:, viirs]
                   + f_gap[viirs][None, :] * np.nan_to_num(pred[:, viirs]))

    source = []
    for m in months:
        if m >= M_VIIRS:
            source.append("viirs_fill" if (f_fill[m] + f_gap[m]) > 0.0 else "viirs")
        elif P.has_t[m] and P.has_a[m]:
            source.append("model")
        elif P.has_t[m] or P.has_a[m]:
            source.append("model_terra" if P.has_t[m] else "model")
        else:
            source.append("none")

    heldout = os.path.join(work, "validation_raw_heldout.npz")
    unc = uncertainty_table(heldout, P, "terra_aqua", method)
    unc_t = uncertainty_table(heldout, P, "terra_only", method)
    cov = {"backcast": coverage(heldout, P, "terra_aqua", "backcast", unc, method),
           "loyo": coverage(heldout, P, "terra_aqua", "loyo", unc, method)}

    np.savez_compressed(os.path.join(work, "harmonized.npz"), cells=P.cells, H=H, pred=pred,
                        prov=P.prov, source=np.array(source))
    meta = {"method": method, "n20_ratio": r20, "uncertainty": unc, "uncertainty_terra_only": unc_t, "coverage80": cov,
            "feature_gain": imp, "f_fill": f_fill.tolist(), "f_gap": f_gap.tolist(),
            "record_start": RECORD_START}
    with open(os.path.join(work, "harmonized_meta.json"), "w") as f:
        json.dump(meta, f, indent=1)
    tot_pre = H[:, :M_VIIRS].sum()
    print(f"N20 ratio {r20:.3f}; uncertainty {unc}; 80% coverage {cov}")
    print(f"harmonized national total pre-2012 {tot_pre:,.0f}; VIIRS era {H[:, M_VIIRS:].sum():,.0f}")
    print("feature gain:", sorted(imp.items(), key=lambda kv: -kv[1])[:8])


def refresh_uncertainty(P: Panel, work: str) -> None:
    """Recompute the interval table and its coverage without refitting."""
    path = os.path.join(work, "harmonized_meta.json")
    with open(path) as f:
        meta = json.load(f)
    heldout = os.path.join(work, "validation_raw_heldout.npz")
    m = meta["method"]
    meta["uncertainty"] = uncertainty_table(heldout, P, "terra_aqua", m)
    meta["uncertainty_terra_only"] = uncertainty_table(heldout, P, "terra_only", m)
    meta["coverage80"] = {t: coverage(heldout, P, "terra_aqua", t, meta["uncertainty"], m) for t in ("backcast", "loyo")}
    with open(path, "w") as f:
        json.dump(meta, f, indent=1)
    print("uncertainty", meta["uncertainty"], "coverage", meta["coverage80"])
