"""Elevation grid of Argentina for the 3D view, from the AWS Terrain Tiles (terrarium PNGs).

At zooms 8 and 9 the tiles carry NASA SRTM (SRTMGL1 v3) on land, with GMTED2010 where SRTM masks water
and ETOPO1 bathymetry offshore; each tile's `x-amz-meta-x-imagery-sources` header lists its sources, and
the attribution written to terrain.json is built from those headers. The tiles are mosaicked (about
0.0055 degrees per pixel at zoom 8, half that at zoom 9) and pixels at or below 0 m are marked as sea when
they reach the open sea (see sea_mask), and each cell gets the mean of the land pixels whose centres fall
inside it. Cells that are mostly sea are 0; land cells that would round to 0 become 1, so 0 always means
sea. Land below sea level, such as the Gran Bajo de San Julian, keeps its negative height. Before any of
this, isolated tile artifacts are replaced by their local median (see despike).

The --hi grid also seeds its sea from the zoom 8 mask of the default grid (see base_sea), so both grids
share their coastline.

Writes web/public/terrain/argentina{suffix}.bin.gz (gzip of int16 little-endian metres, row 0 north,
column 0 west) and web/public/terrain/terrain{suffix}.json; tiles are cached under data/cache/terrain, so
reruns are offline and give byte-identical output. A colour preview goes to
data/cache/terrain/preview{suffix}.png.

    python -m focos.terrain          # 0.05 degree grid from zoom 8: argentina.bin.gz, terrain.json
    python -m focos.terrain --hi     # 0.025 degree grid from zoom 9: argentina-hi.bin.gz, terrain-hi.json
"""
from __future__ import annotations

import argparse
import gzip
import io
import json
import math
import os
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import numpy as np
import requests
from PIL import Image
from scipy import ndimage

LON0, LAT0, LON1, LAT1 = -73.6, -55.0, -53.6, -21.7  # grid edges: west, south, east, north
TILE = 256
NODATA = -32768
LAND_MIN = 0.5  # a cell is land when at least this share of its source pixels is land
BRIDGE_PX = 2  # at zoom 8, water joins the sea across land strips up to 2 * BRIDGE_PX pixels (about 2 km)
DEEPEST_LAND = -120.0  # below Laguna del Carbon (-105 m), the lowest land in South America
ACONCAGUA = (-70.011, -32.653)  # summit, used for the check and the preview marker
WATER_NOTE = ("0 = sea-connected water (ocean, Rio de la Plata, fjords); inland lakes keep their surface "
              "elevation; land below sea level is negative; land that rounds to 0 is stored as 1")
URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
SOURCES_HEADER = "x-amz-meta-x-imagery-sources"

# Attribution required by the tile provider for each source that appears in the tiles used.
# https://github.com/tilezen/joerd/blob/master/docs/attribution.md
ATTRIBUTION = {
    "srtm": "SRTM terrain data courtesy of the U.S. Geological Survey",
    "gmted": "GMTED2010 terrain data courtesy of the U.S. Geological Survey",
    "etopo1": "Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration",
}
REFERENCES = {
    "srtm": "NASA JPL (2013). NASA Shuttle Radar Topography Mission Global 1 arc second V003. "
            "NASA EOSDIS Land Processes DAAC. doi:10.5067/MEaSUREs/SRTM/SRTMGL1.003",
    "gmted": "Danielson, J. J. and Gesch, D. B. (2011). Global Multi-resolution Terrain Elevation Data 2010 "
             "(GMTED2010). U.S. Geological Survey Open-File Report 2011-1073. doi:10.3133/ofr20111073",
    "etopo1": "Amante, C. and Eakins, B. W. (2009). ETOPO1 1 Arc-Minute Global Relief Model. "
              "NOAA Technical Memorandum NESDIS NGDC-24. doi:10.7289/V5C8276M",
}
TILESET = ("Terrain Tiles (Mapzen, a Linux Foundation project), Registry of Open Data on AWS, "
           "https://registry.opendata.aws/terrain-tiles")


@dataclass(frozen=True)
class Spec:
    """Grid step in degrees and the tile zoom it is built from."""

    step: float = 0.05
    zoom: int = 8

    @property
    def nx(self) -> int:
        return round((LON1 - LON0) / self.step)

    @property
    def ny(self) -> int:
        return round((LAT1 - LAT0) / self.step)

    @property
    def lat_n(self) -> float:
        return round(LAT0 + self.ny * self.step, 6)

    @property
    def bridge(self) -> int:
        """Bridge distance in pixels of this zoom, so the gap it closes stays about 2 km."""
        return BRIDGE_PX * 2 ** (self.zoom - 8)

    def check(self) -> None:
        for name, n, extent in (("nx", self.nx, LON1 - LON0), ("ny", self.ny, LAT1 - LAT0)):
            if n < 1 or abs(n * self.step - extent) > 1e-6:
                raise SystemExit(f"step {self.step} does not divide the grid extent "
                                 f"({name}: {extent:.4f} degrees)")
        if not 0 <= self.zoom <= 12:
            raise SystemExit(f"zoom {self.zoom} is outside 0-12")
        if self.step < 360.0 / (TILE * 2 ** self.zoom):
            raise SystemExit(f"zoom {self.zoom} pixels are coarser than step {self.step}; use a higher zoom")


def tile_range(g: Spec) -> tuple[range, range]:
    """Tile columns and rows (web mercator, zoom g.zoom) that cover the grid."""
    n = 2 ** g.zoom

    def tx(lon: float) -> int:
        return int(math.floor((lon + 180.0) / 360.0 * n))

    def ty(lat: float) -> int:
        return int(math.floor((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n))

    return range(tx(LON0), tx(LON0 + g.nx * g.step) + 1), range(ty(g.lat_n), ty(LAT0) + 1)


def decode(png: bytes) -> np.ndarray:
    """Terrarium encoding: metres = R*256 + G + B/256 - 32768."""
    rgb = np.asarray(Image.open(io.BytesIO(png)).convert("RGB"), dtype=np.float32)
    if rgb.shape != (TILE, TILE, 3):
        raise ValueError(f"unexpected tile shape {rgb.shape}")
    return rgb[..., 0] * 256.0 + rgb[..., 1] + rgb[..., 2] / 256.0 - 32768.0


def fetch(session: requests.Session, z: int, x: int, y: int, cache: str) -> tuple[str, str]:
    """Return (png path, imagery sources), downloading the tile once and reusing the cache after."""
    png = os.path.join(cache, f"{z}", f"{x}", f"{y}.png")
    src = png[:-4] + ".sources.txt"
    if os.path.exists(png) and os.path.exists(src):
        try:
            with open(png, "rb") as f:
                decode(f.read())
            with open(src) as f:
                return png, f.read().strip()
        except (OSError, ValueError):
            pass  # unreadable cache entry: fetch it again
    url = URL.format(z=z, x=x, y=y)
    err = ""
    for attempt in range(5):
        try:
            r = session.get(url, timeout=60)
            if r.status_code == 200:
                decode(r.content)
                os.makedirs(os.path.dirname(png), exist_ok=True)
                for path, data in ((png, r.content), (src, r.headers.get(SOURCES_HEADER, "").encode())):
                    with open(path + ".part", "wb") as f:
                        f.write(data)
                    os.replace(path + ".part", path)
                return png, r.headers.get(SOURCES_HEADER, "").strip()
            err = f"HTTP {r.status_code}"
        except (requests.RequestException, OSError, ValueError) as e:
            err = f"{type(e).__name__}: {e}"
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"could not download {url} after 5 attempts ({err})")


def mosaic(g: Spec, cache: str) -> tuple[np.ndarray, int, int, list[str]]:
    """Download (or reuse) every tile and return (elevation mosaic, first column, first row, sources)."""
    xs, ys = tile_range(g)
    jobs = [(x, y) for y in ys for x in xs]
    span = f"x {xs.start}-{xs.stop - 1}, y {ys.start}-{ys.stop - 1}"
    print(f"terrain: {len(jobs)} tiles at zoom {g.zoom} ({span})")
    with requests.Session() as s, ThreadPoolExecutor(max_workers=8) as pool:
        got = list(pool.map(lambda j: fetch(s, g.zoom, j[0], j[1], cache), jobs))
    elev = np.empty((len(ys) * TILE, len(xs) * TILE), np.float32)
    sources = []
    for (x, y), (path, src) in zip(jobs, got, strict=True):
        with open(path, "rb") as f:
            r0, c0 = (y - ys.start) * TILE, (x - xs.start) * TILE
            elev[r0:r0 + TILE, c0:c0 + TILE] = decode(f.read())
        sources.append(src)
    return elev, xs.start * TILE, ys.start * TILE, sources


def despike(elev: np.ndarray, limit: float) -> int:
    """Replace, in place, pixels more than `limit` metres from the median of their 5 x 5 neighbourhood.

    The tiles hold a few isolated build artifacts, such as an 8752 m spike on Isla Santa Ines and holes
    of -856 m in the Puna and -2983 m in Neuquen; no real slope rises 1500 m within two pixels. Returns
    the number of pixels replaced."""
    med = ndimage.median_filter(elev, size=5, mode="nearest")
    bad = np.abs(elev - med) > limit
    elev[bad] = med[bad]
    return int(bad.sum())


def sea_mask(elev: np.ndarray, bridge: int, seed: np.ndarray | None = None) -> np.ndarray:
    """Pixels at or below 0 m that belong to the sea: the ocean, the Rio de la Plata and the Chilean fjords.

    Water pixels are grouped after growing them by `bridge` pixels, because channels such as the eastern
    mouth of the Strait of Magellan or the western arms of the Beagle Channel are narrower than a pixel
    and break up in the tiles. A group is sea when it touches the edge of the mosaic, or when it goes
    deeper than DEEPEST_LAND, which no land does (Seno Otway and Seno Skyring reach the sea only through
    channels far narrower than a pixel), or when it overlaps `seed` (a sea mask from another zoom).
    Closed depressions such as the Gran Bajo de San Julian, the Bajo del Gualicho and the Peninsula Valdes
    salinas stay land."""
    water = elev <= 0
    labels, n = ndimage.label(ndimage.binary_dilation(water, iterations=bridge))
    edge = np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])
    deepest = ndimage.minimum(np.where(water, elev, np.inf), labels, np.arange(n + 1))
    seeds = np.union1d(edge, np.nonzero(deepest < DEEPEST_LAND)[0])
    if seed is not None:
        seeds = np.union1d(seeds, labels[water & seed])
    return water & np.isin(labels, seeds[seeds > 0])


def base_sea(cache: str, g: Spec, col0: int, row0: int, shape: tuple[int, int], limit: float) -> np.ndarray:
    """The sea mask of the default 0.05 degree grid (zoom 8), mapped onto a finer mosaic of zoom g.zoom.

    Used as a seed, it keeps every water area the default grid treats as sea, so channels that break up
    at the finer zoom stay connected and both grids share their coastline."""
    base = Spec()
    elev, c8, r8, _ = mosaic(base, cache)
    if limit > 0:
        despike(elev, limit)
    sea = sea_mask(elev, base.bridge)
    f = 2 ** (g.zoom - base.zoom)
    rows = np.arange(row0, row0 + shape[0]) // f - r8
    cols = np.arange(col0, col0 + shape[1]) // f - c8
    if rows.min() < 0 or cols.min() < 0 or rows.max() >= sea.shape[0] or cols.max() >= sea.shape[1]:
        raise RuntimeError("the zoom 8 mosaic does not cover the finer mosaic")
    return sea[np.ix_(rows, cols)]


def grid(g: Spec, elev: np.ndarray, sea: np.ndarray, col0: int, row0: int) -> tuple[np.ndarray, np.ndarray]:
    """Cell means over land pixels (int16, row 0 north) and the land share of each cell."""
    nx, ny, step, lat_n = g.nx, g.ny, g.step, g.lat_n
    n = TILE * 2 ** g.zoom
    lon = (np.arange(col0, col0 + elev.shape[1]) + 0.5) / n * 360.0 - 180.0
    rows = np.arange(row0, row0 + elev.shape[0]) + 0.5
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1.0 - 2.0 * rows / n))))
    ix = np.floor((lon - LON0) / step).astype(np.int64)
    iy = np.floor((lat_n - lat) / step).astype(np.int64)
    ix[(ix < 0) | (ix >= nx)] = -1
    iy[(iy < 0) | (iy >= ny)] = -1
    cid = iy[:, None] * nx + ix[None, :]
    inside = (iy[:, None] >= 0) & (ix[None, :] >= 0)
    land = inside & ~sea
    total = np.bincount(cid[inside], minlength=nx * ny)
    n_land = np.bincount(cid[land], minlength=nx * ny)
    s_land = np.bincount(cid[land], weights=elev[land].astype(np.float64), minlength=nx * ny)
    if (total == 0).any():
        raise RuntimeError(f"{int((total == 0).sum())} cells received no source pixels; check the tile range")
    share = n_land / total
    out = np.zeros(nx * ny, np.float64)
    is_land = share >= LAND_MIN
    out[is_land] = np.rint(s_land[is_land] / n_land[is_land])
    out[is_land & (out == 0)] = 1.0
    out = np.clip(out, NODATA + 1, 32767).astype(np.int16)
    return out.reshape(ny, nx), share.reshape(ny, nx)


def attribution(sources: list[str]) -> tuple[dict[str, int], list[str]]:
    """Count tiles per source family from the headers; fail on any family without a known attribution."""
    counts: dict[str, int] = {}
    for header in sources:
        for fam in {part.strip().split("/")[0] for part in header.split(",") if part.strip()}:
            counts[fam] = counts.get(fam, 0) + 1
    if not counts:
        raise RuntimeError(f"no tile carried a {SOURCES_HEADER} header; cannot verify the attribution")
    unknown = sorted(set(counts) - set(ATTRIBUTION))
    if unknown:
        raise RuntimeError(f"tiles use sources without a recorded attribution: {unknown}; "
                           "add them to ATTRIBUTION and REFERENCES")
    return dict(sorted(counts.items())), [f for f in ATTRIBUTION if f in counts]


def cell(g: Spec, lon: float, lat: float) -> tuple[int, int]:
    """(row, column) of the cell containing a point."""
    return int(math.floor((g.lat_n - lat) / g.step)), int(math.floor((lon - LON0) / g.step))


def render(g: Spec, z: np.ndarray) -> np.ndarray:
    """Hypsometric colours with hillshade and sea in blue, one RGB pixel per cell (uint8)."""
    lat = g.lat_n - (np.arange(g.ny) + 0.5) * g.step
    dy = g.step * 110_574.0
    dx = g.step * 111_320.0 * np.cos(np.radians(lat))[:, None]
    zf = z.astype(np.float32)
    gy, gx = np.gradient(zf)
    gx, gy = gx / dx, -gy / dy  # east and north slopes
    az, alt = np.radians(315.0), np.radians(45.0)
    shade = np.sin(alt) + np.cos(alt) * (-gx * np.sin(az) - gy * np.cos(az))
    shade = np.clip(shade / np.sqrt(1.0 + gx ** 2 + gy ** 2), 0.0, 1.0)
    stops = np.array([0, 200, 600, 1500, 3000, 4500, 6500], np.float32)
    cols = np.array([[70, 130, 70], [140, 170, 90], [205, 190, 120], [170, 120, 70],
                     [120, 90, 70], [200, 200, 200], [255, 255, 255]], np.float32)
    rgb = np.stack([np.interp(zf, stops, cols[:, k]) for k in range(3)], axis=-1)
    rgb *= (0.45 + 0.55 * shade)[..., None]
    rgb[z == 0] = (40, 90, 140)
    rgb[z == NODATA] = (255, 0, 255)
    return rgb.astype(np.uint8)


def preview(g: Spec, z: np.ndarray, path: str) -> None:
    """Whole grid at about 800 pixels wide, with Aconcagua marked in red."""
    rgb = render(g, z)
    ay, ax = cell(g, *ACONCAGUA)
    r = max(1, round(0.1 / g.step))
    rgb[max(ay - r, 0):ay + r + 1, max(ax - r, 0):ax + r + 1] = (230, 30, 30)
    k = max(1, round(800 / g.nx))
    img = Image.fromarray(rgb).resize((g.nx * k, g.ny * k), Image.NEAREST)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    img.save(path)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--cache", default="data/cache/terrain", help="tile cache directory")
    ap.add_argument("--out", default="web/public/terrain", help="output directory for the two files")
    ap.add_argument("--step", type=float, default=0.05, help="cell size in degrees (default 0.05)")
    ap.add_argument("--zoom", type=int, default=8, help="tile zoom to average from (default 8)")
    ap.add_argument("--suffix", default="", help="appended to output and preview names (write --suffix=-x)")
    ap.add_argument("--despike", type=float, default=1500.0,
                    help="replace source pixels more than this many metres from their 5 x 5 median "
                         "(default 1500, 0 = off)")
    ap.add_argument("--hi", action="store_true",
                    help="desktop grid: --step 0.025 --zoom 9 --suffix=-hi")
    ap.add_argument("--preview", help="preview PNG path (default data/cache/terrain/preview{suffix}.png)")
    a = ap.parse_args()
    if a.hi:
        a.step, a.zoom, a.suffix = 0.025, 9, "-hi"
    g = Spec(a.step, a.zoom)
    g.check()
    a.preview = a.preview or os.path.join(a.cache, f"preview{a.suffix}.png")

    tiles = os.path.join(a.cache, "terrarium")
    elev, col0, row0, sources = mosaic(g, tiles)
    counts, fams = attribution(sources)
    n_spikes = despike(elev, a.despike) if a.despike > 0 else 0
    seed = base_sea(tiles, g, col0, row0, elev.shape, a.despike) if g.zoom > Spec().zoom else None
    sea = sea_mask(elev, g.bridge, seed)
    del sources, seed
    z, share = grid(g, elev, sea, col0, row0)
    del elev, sea
    extra = ""
    if g.zoom > Spec().zoom:
        extra += (f" Water that is sea in the zoom {Spec().zoom} mask of the {Spec().step} degree grid also "
                  f"counts as sea, so channels that break up at zoom {g.zoom} stay connected and both grids "
                  f"share their coastline.")
    if a.despike > 0:
        extra += (f" Before averaging, {n_spikes} isolated source pixels more than {a.despike:.0f} m from "
                  f"the median of their 5 x 5 neighbourhood (tile artifacts) were replaced by that median.")
    cols = g.step / (360.0 / (TILE * 2 ** g.zoom))
    rows_n, rows_s = cols / math.cos(math.radians(g.lat_n)), cols / math.cos(math.radians(LAT0))

    meta = {
        "lon0": LON0, "lat0": LAT0, "step": g.step, "nx": g.nx, "ny": g.ny,
        "units": "m", "rows": "north-to-south", "value": "mean",
        "water": WATER_NOTE,
        "source": f"{TILESET}, terrarium tiles at zoom {g.zoom}. Land from NASA SRTM (SRTMGL1 v3); "
                  "the sources present in the tiles used: " + ", ".join(fams) + ".",
        "licence": "Source data are public domain; the tile provider requires this attribution: "
                   + "; ".join(ATTRIBUTION[f] for f in fams)
                   + ". https://github.com/tilezen/joerd/blob/master/docs/attribution.md",
        "citation": f"{TILESET}. " + " ".join(REFERENCES[f] + "." for f in fams),
        "dtype": "int16", "byte_order": "little", "nodata": NODATA,
        "method": f"Mean of the land pixels whose centres fall in the cell (zoom {g.zoom}, about "
                  f"{cols:.0f} x {rows_n:.0f} pixels per cell in the north to {cols:.0f} x {rows_s:.0f} "
                  f"in the south). Pixels at or below 0 m count as sea when they reach the open sea across "
                  f"gaps of up to {2 * g.bridge} pixels, or lie in a closed basin deeper than "
                  f"{DEEPEST_LAND:.0f} m (below any land in South America); a cell with under "
                  f"{LAND_MIN:.0%} land is 0. Land cells that round to 0 are stored as 1, so 0 always "
                  f"means sea. Land below sea level keeps its negative height, and inland lakes keep their "
                  f"surface height." + extra,
        "source_tiles": counts,
    }
    os.makedirs(a.out, exist_ok=True)
    blob = gzip.compress(z.astype("<i2").tobytes(), compresslevel=9, mtime=0)
    bin_path = os.path.join(a.out, f"argentina{a.suffix}.bin.gz")
    json_path = os.path.join(a.out, f"terrain{a.suffix}.json")
    for path, data in ((bin_path, blob), (json_path, (json.dumps(meta, indent=2) + "\n").encode())):
        with open(path + ".part", "wb") as f:
            f.write(data)
        os.replace(path + ".part", path)
    preview(g, z, a.preview)

    ay, ax = cell(g, *ACONCAGUA)
    land = z != 0
    print(f"terrain: grid {g.ny} x {g.nx}, {land.mean():.1%} land cells, range {z.min()} to {z.max()} m")
    top = z[ay, ax]
    higher = int((z > top).sum())
    print(f"terrain: Aconcagua summit cell ({ax}, {ay}) = {top} m, {higher} of {z.size} cells higher")
    print(f"terrain: tiles per source {counts}; mean land share of sea cells {share[~land].mean():.2f}; "
          f"{n_spikes} spike pixels replaced")
    print(f"terrain: wrote {bin_path} ({len(blob):,} bytes), {json_path}, preview {a.preview}")


if __name__ == "__main__":
    main()
