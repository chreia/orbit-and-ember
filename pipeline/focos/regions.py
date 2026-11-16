"""First-level administrative regions (provinces) from Natural Earth, and the cell-to-province map.

A cell belongs to the province containing its centre; coastal and border cells whose centre falls just
outside every polygon take the nearest province within 0.25 degrees.
"""
from __future__ import annotations

import json

import numpy as np
import shapely
from shapely.geometry import mapping, shape

NONE = 255


def load_provinces(path: str, adm0: str = "ARG") -> list[dict]:
    with open(path) as f:
        fc = json.load(f)
    out = []
    for feat in fc["features"]:
        p = feat["properties"]
        if p.get("adm0_a3") != adm0:
            continue
        out.append({"name": p.get("name") or p.get("name_en"), "geom": shape(feat["geometry"])})
    out.sort(key=lambda r: r["name"])
    for i, r in enumerate(out):
        r["id"] = i
    return out


def assign_cells(lons: np.ndarray, lats: np.ndarray, provinces: list[dict]) -> np.ndarray:
    geoms = [p["geom"] for p in provinces]
    pts = shapely.points(lons, lats)
    tree = shapely.STRtree(geoms)
    pt_idx, poly_idx = tree.query(pts, predicate="within")
    out = np.full(len(pts), NONE, np.uint8)
    out[pt_idx] = poly_idx
    missing = np.where(out == NONE)[0]
    if len(missing):
        near_pt, near_poly = tree.query_nearest(pts[missing], max_distance=0.25, return_distance=False)
        out[missing[near_pt]] = near_poly
    return out


def provinces_geojson(provinces: list[dict], tolerance: float = 0.01) -> dict:
    feats = []
    for p in provinces:
        g = shapely.set_precision(p["geom"].simplify(tolerance, preserve_topology=True), 0.001)
        feats.append({"type": "Feature", "properties": {"id": p["id"], "name": p["name"]}, "geometry": mapping(g)})
    return {"type": "FeatureCollection", "features": feats}
