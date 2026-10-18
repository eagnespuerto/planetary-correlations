"""Fetch NASA Exoplanet Archive + Gaia DR3 data and write compact JSON for the static page.

Outputs:
  data/planets.json  - one row per confirmed planet (pscomppars), columnar
  data/census.json   - Gaia DR3 counts of main-sequence stars, evolved stars and white dwarfs
                       near the Sun, binned by BP-RP, plus Gaia colour, parallax and CMD stage
                       for every known host with a Gaia DR3 ID

Run:  python scripts/fetch_data.py
"""

import csv
import hashlib
import io
import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

NASA_TAP = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
GAIA_TAP = "https://gea.esac.esa.int/tap-server/tap/sync"

PLANET_COLS = [
    "pl_name", "hostname", "gaia_dr3_id", "sy_snum", "sy_pnum", "discoverymethod", "disc_year",
    "pl_orbper", "pl_orbsmax", "pl_orbeccen", "pl_rade", "pl_bmasse", "pl_dens", "pl_insol", "pl_eqt",
    "st_spectype", "st_teff", "st_rad", "st_mass", "st_met", "st_logg", "st_age", "sy_dist",
]

# Distance limits (pc) for the Gaia census. Parallax limit = 1000 / d. "all" has no distance
# limit: every Gaia DR3 source with a good parallax, which is as close to "the whole Milky Way"
# as Gaia gets (a few kpc for most stars, ~0.1% of the Galaxy's stars).
DISTANCES = [25, 50, 100, "all"]

# Evolutionary stage from the Gaia colour-magnitude diagram. The main-sequence band is
# M_G within [-2, +2.5] mag of a two-segment dwarf locus (A0V..M0V: M_G ~ 3.85*(BP-RP) + 1.1;
# redder: M_G ~ 2.65*(BP-RP) + 3.32, after Pecaut & Mamajek).
#   evolved: brighter than the band (subgiants, giants), or blue and between the band and the
#            white-dwarf sequence (hot subdwarfs, which are helium-burning post-giant cores)
#   remnant: white-dwarf sequence, M_G > 2.8*(BP-RP) + 9 and BP-RP < 1.5, with a BP/RP flux-excess
#            cut, since faint sources with blended photometry otherwise pile up below the main sequence
# Anything else (mostly bad photometry) is left unclassified.
_MG = "(phot_g_mean_mag+5*LOG10(parallax)-10)"
_WD_LINE = "2.8*bp_rp+9.0"
STAGE_CUTS = {
    "ms": (f"((bp_rp<1.84 AND {_MG} >= 3.85*bp_rp-0.9 AND {_MG} <= 3.85*bp_rp+3.6) OR "
           f"(bp_rp>=1.84 AND {_MG} >= 2.65*bp_rp+1.32 AND {_MG} <= 2.65*bp_rp+5.82))"),
    "evolved": (f"((bp_rp<1.84 AND {_MG} < 3.85*bp_rp-0.9) OR "
                f"(bp_rp>=1.84 AND {_MG} < 2.65*bp_rp+1.32) OR "
                f"(bp_rp<0 AND {_MG} > 3.85*bp_rp+3.6 AND {_MG} <= {_WD_LINE}))"),
    "remnant": (f"(bp_rp<1.5 AND {_MG} > {_WD_LINE} AND "
                f"phot_bp_rp_excess_factor < 1.3+0.06*bp_rp*bp_rp)"),
}
QUALITY = "parallax_over_error>10 AND bp_rp IS NOT NULL"


def stage_of(bp_rp, abs_g, excess):
    """Python mirror of STAGE_CUTS, used for the host stars."""
    lo, hi = (3.85 * bp_rp - 0.9, 3.85 * bp_rp + 3.6) if bp_rp < 1.84 else (2.65 * bp_rp + 1.32, 2.65 * bp_rp + 5.82)
    wd_line = 2.8 * bp_rp + 9.0
    if abs_g < lo:
        return "evolved"
    if abs_g <= hi:
        return "ms"
    if bp_rp < 0 and abs_g <= wd_line:
        return "evolved"
    if bp_rp < 1.5 and abs_g > wd_line and excess is not None and excess < 1.3 + 0.06 * bp_rp ** 2:
        return "remnant"
    return None


def tap(url, query, lang=None, retries=3):
    params = {"query": query, "format": "csv"} if lang is None else {
        "REQUEST": "doQuery", "LANG": lang, "FORMAT": "csv", "QUERY": query}
    body = urllib.parse.urlencode(params).encode()
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=body), timeout=600) as r:
                text = r.read().decode("utf-8")
            if text.lstrip().startswith("<"):
                raise RuntimeError(f"TAP error:\n{text[:1500]}")
            return list(csv.DictReader(io.StringIO(text)))
        except urllib.error.HTTPError as e:
            if e.code == 408 or attempt == retries - 1:  # 408: query too slow, retrying won't help
                raise
            time.sleep(5 * (attempt + 1))
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(5 * (attempt + 1))


# Whole-catalogue counts are split into HEALPix tiles. Gaia source_id encodes the level-12
# HEALPix index times 2^35, so each tile is one source_id range. Anonymous Gaia queries stop after
# about a minute, so a tile that times out (dense Galactic-plane regions) is split into its four
# children, down to level 5.
TILE_LEVEL, MAX_LEVEL = 1, 5


def count_all_sky(cut):
    def count(lo, hi, level):
        q = (f"SELECT t.b, COUNT(*) AS n FROM (SELECT FLOOR(bp_rp*20) AS b FROM gaiadr3.gaia_source "
             f"WHERE source_id >= {lo} AND source_id < {hi} AND {QUALITY} AND {cut}) AS t GROUP BY t.b")
        try:
            return {str(int(float(r["b"]))): int(r["n"]) for r in tap(GAIA_TAP, q, lang="ADQL", retries=4)}
        except urllib.error.HTTPError as e:
            if e.code != 408 or level >= MAX_LEVEL:
                raise
            step = (hi - lo) // 4
            out = {}
            for i in range(4):
                for k, v in count(lo + i * step, lo + (i + 1) * step, level + 1).items():
                    out[k] = out.get(k, 0) + v
            return out

    span = 4 ** (12 - TILE_LEVEL) * 2 ** 35
    tiles = [(t * span, (t + 1) * span, TILE_LEVEL) for t in range(12 * 4 ** TILE_LEVEL)]
    total = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        for part in pool.map(lambda a: count(*a), tiles):
            for k, v in part.items():
                total[k] = total.get(k, 0) + v
    return dict(sorted(total.items(), key=lambda kv: int(kv[0])))


def num(v):
    if v is None or v == "":
        return None
    try:
        f = float(v)
    except ValueError:
        return None
    return None if math.isnan(f) else f


def fetch_planets():
    rows = tap(NASA_TAP, f"select {','.join(PLANET_COLS)} from pscomppars")
    print(f"planets: {len(rows)}")
    cols = {c: [] for c in PLANET_COLS}
    text_cols = {"pl_name", "hostname", "discoverymethod", "st_spectype", "gaia_dr3_id"}
    for r in rows:
        for c in PLANET_COLS:
            v = r[c]
            if c == "gaia_dr3_id":
                v = v.replace("Gaia DR3", "").strip() or None
            elif c in text_cols:
                v = v.strip() or None
            else:
                v = num(v)
                if v is not None and v == int(v) and c in {"sy_snum", "sy_pnum", "disc_year"}:
                    v = int(v)
                elif v is not None:
                    v = float(f"{v:.5g}")
            cols[c].append(v)
    return cols


def census_key():
    """Fingerprint of the census definition. Gaia DR3 is a fixed release, so star counts only
    need re-querying when the cuts change; the scheduled refresh reuses them otherwise."""
    spec = json.dumps({"cuts": STAGE_CUTS, "quality": QUALITY, "bin": 20}, sort_keys=True)
    return hashlib.sha1(spec.encode()).hexdigest()[:12]


def fetch_census(gaia_ids):
    key = census_key()
    old = {}
    old_path = DATA / "census.json"
    if old_path.exists():
        prev = json.loads(old_path.read_text())
        if prev.get("census_key") == key:
            old = prev.get("distances", {})
    census = {"bin_width": 0.05, "census_key": key, "stages": list(STAGE_CUTS), "distances": {}}
    for d in DISTANCES:
        if str(d) in old:
            census["distances"][str(d)] = old[str(d)]
            print(f"gaia census {d}: reused (cuts unchanged)")
            continue
        census["distances"][str(d)] = {}
        for stage, cut in STAGE_CUTS.items():
            if d == "all":
                counts = count_all_sky(cut)
            else:
                q = (f"SELECT t.b, COUNT(*) AS n FROM (SELECT FLOOR(bp_rp*20) AS b FROM gaiadr3.gaia_source "
                     f"WHERE parallax>{1000 / d} AND {QUALITY} AND {cut}) AS t GROUP BY t.b ORDER BY t.b")
                counts = {str(int(float(r["b"]))): int(r["n"]) for r in tap(GAIA_TAP, q, lang="ADQL")}
            census["distances"][str(d)][stage] = counts
            print(f"gaia census {d} {stage}: {sum(counts.values())} objects")

    # Gaia colour, parallax and CMD stage for every host with a Gaia DR3 ID (any distance).
    # Stage is null when the astrometry or colour fails the census quality cut.
    hosts = {}
    ids = sorted({i for i in gaia_ids if i})
    for k in range(0, len(ids), 800):
        chunk = ",".join(ids[k:k + 800])
        q = (f"SELECT source_id, bp_rp, parallax, parallax_over_error, phot_g_mean_mag, phot_bp_rp_excess_factor "
             f"FROM gaiadr3.gaia_source WHERE source_id IN ({chunk})")
        for r in tap(GAIA_TAP, q, lang="ADQL"):
            bp_rp, plx, poe, g, exc = (num(r[c]) for c in (
                "bp_rp", "parallax", "parallax_over_error", "phot_g_mean_mag", "phot_bp_rp_excess_factor"))
            stage = None
            if None not in (bp_rp, plx, poe, g) and poe > 10 and plx > 0:
                stage = stage_of(bp_rp, g + 5 * math.log10(plx) - 10, exc)
            hosts[r["source_id"]] = [None if bp_rp is None else round(bp_rp, 4),
                                     None if plx is None else round(plx, 3), stage]
    print(f"gaia hosts: {len(hosts)}; by stage: "
          + ", ".join(f"{s}={sum(1 for h in hosts.values() if h[2] == s)}" for s in [*STAGE_CUTS, None]))
    census["hosts"] = hosts
    return census


def main():
    DATA.mkdir(exist_ok=True)
    planets = fetch_planets()
    census = fetch_census(planets["gaia_dr3_id"])
    meta = {"fetched": date.today().isoformat(),
            "sources": ["NASA Exoplanet Archive pscomppars", "Gaia DR3 gaia_source (ESA)"]}
    (DATA / "planets.json").write_text(json.dumps({"meta": meta, "cols": planets}, separators=(",", ":")))
    (DATA / "census.json").write_text(json.dumps({"meta": meta, **census}, separators=(",", ":")))
    print("wrote data/planets.json, data/census.json")


if __name__ == "__main__":
    main()
