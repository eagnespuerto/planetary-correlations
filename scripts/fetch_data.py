"""Fetch NASA Exoplanet Archive + Gaia DR3 data and write compact JSON for the static page.

Outputs:
  data/planets.json  - one row per confirmed planet (pscomppars), columnar
  data/census.json   - Gaia DR3 main-sequence star counts near the Sun, binned by BP-RP,
                       plus Gaia photometry for every known host inside those volumes

Run:  python scripts/fetch_data.py
"""

import csv
import io
import json
import math
import time
import urllib.parse
import urllib.request
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

# Distance limits (pc) for the Gaia census. Parallax limit = 1000 / d.
DISTANCES = [25, 50, 100]

# Main-sequence band in the Gaia CMD: M_G within [-2, +2.5] mag of a two-segment dwarf locus
# (A0V..M0V: M_G ~ 3.85*(BP-RP) + 1.1; redder: M_G ~ 2.65*(BP-RP) + 3.32, after Pecaut & Mamajek).
# Rejects giants (far brighter) and white dwarfs (far fainter).
_MG = "(phot_g_mean_mag+5*LOG10(parallax)-10)"
MS_CUT = (f"((bp_rp<1.84 AND {_MG} >= 3.85*bp_rp-0.9 AND {_MG} <= 3.85*bp_rp+3.6) OR "
          f"(bp_rp>=1.84 AND {_MG} >= 2.65*bp_rp+1.32 AND {_MG} <= 2.65*bp_rp+5.82))")
QUALITY = "parallax_over_error>10 AND bp_rp IS NOT NULL"


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
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(5 * (attempt + 1))


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


def fetch_census(gaia_ids):
    census = {"bin_width": 0.05, "distances": {}}
    for d in DISTANCES:
        plx = 1000 / d
        q = (f"SELECT t.b, COUNT(*) AS n FROM (SELECT FLOOR(bp_rp*20) AS b FROM gaiadr3.gaia_source "
             f"WHERE parallax>{plx} AND {QUALITY} AND {MS_CUT}) AS t GROUP BY t.b ORDER BY t.b")
        rows = tap(GAIA_TAP, q, lang="ADQL")
        census["distances"][str(d)] = {str(int(float(r["b"]))): int(r["n"]) for r in rows}
        print(f"gaia census {d} pc: {sum(int(r['n']) for r in rows)} stars")

    # Gaia photometry for hosts, with the same cuts at the widest distance.
    hosts = {}
    ids = sorted({i for i in gaia_ids if i})
    plx = 1000 / max(DISTANCES)
    for k in range(0, len(ids), 800):
        chunk = ",".join(ids[k:k + 800])
        q = (f"SELECT source_id, bp_rp, parallax FROM gaiadr3.gaia_source WHERE source_id IN ({chunk}) "
             f"AND parallax>{plx} AND {QUALITY} AND {MS_CUT}")
        for r in tap(GAIA_TAP, q, lang="ADQL"):
            hosts[r["source_id"]] = [round(float(r["bp_rp"]), 4), round(float(r["parallax"]), 3)]
    print(f"gaia hosts passing cuts within {max(DISTANCES)} pc: {len(hosts)}")
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
