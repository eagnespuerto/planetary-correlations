# Planetary Correlations

[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![data refresh](https://github.com/eagnespuerto/planetary-correlations/actions/workflows/refresh-data.yml/badge.svg)](https://github.com/eagnespuerto/planetary-correlations/actions/workflows/refresh-data.yml)
[![made with](https://img.shields.io/badge/made%20with-JavaScript-F7DF1E?logo=javascript&logoColor=white)](https://github.com/eagnespuerto/planetary-correlations)
[![website](https://img.shields.io/badge/website-live-brightgreen)](https://eagnespuerto.github.io/planetary-correlations/)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-support%20me-FF5E5B?logo=kofi&logoColor=white)](https://ko-fi.com/eagnespuerto)
[![Linktree](https://img.shields.io/badge/Linktree-soitsagnes-43E55E?logo=linktree&logoColor=white)](https://linktr.ee/soitsagnes)

A static page for exploring the confirmed exoplanets in the [NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/). Pick any two attributes to plot against each other (semi-major axis, period, radius, mass, density, eccentricity, insolation, star type, star mass, metallicity, distance, number of planets, discovery method and more). The page shows the correlation, a trend line and Solar System reference points.

Below the chart, the known planets are compared with the **Gaia DR3** census of stars and white dwarfs, split into main-sequence, evolved (non-main-sequence) and remnant objects. It answers questions like:

> Of Gaia DR3 K-type main-sequence stars within 50 pc, what share host a known sub-Neptune? Of all stellar remnants across the whole Milky Way, how many host 2 or more planets?

That section can show bars by spectral class (as a share, # of host stars or # of Gaia objects), or a probability distribution over Gaia colour comparing the stars with the planet hosts. Pie charts underneath break the stars and hosts down by class and by stage.

## How the views work

- **Numeric × numeric** gives a scatter plot with Pearson r, Spearman ρ and a least-squares (power-law on log axes) fit.
- **Category × numeric** gives box plots with medians per category.
- **Category × category** gives a heatmap of counts, or row percentages ("of M-star planets, what % are sub-Neptunes").
- The URL hash stores the current axes, so a view can be shared as a link.

## Data

`scripts/fetch_data.py` (Python 3 standard library only) refreshes the two files in `data/`:

- `planets.json` is the archive's `pscomppars` table (one row per planet, composite parameters).
- `census.json` holds Gaia DR3 counts in 0.05 mag BP−RP bins within 25, 50 and 100 pc and across all of Gaia DR3 ("whole Milky Way"). Every count requires parallax/error > 10, and each one is split by position on the colour–magnitude diagram into main sequence, evolved and remnant (white dwarf). The file also holds the Gaia colour, parallax and stage of every known host with a Gaia DR3 ID.

Gaia DR3 is a fixed release, so the star counts are cached in `census.json` under a fingerprint of the cuts. A refresh only re-queries the planets and hosts unless the cuts change. A full re-query of the whole-galaxy counts runs as asynchronous Gaia jobs that scan the entire catalogue, which can take some time.

```bash
python scripts/fetch_data.py
```

A GitHub Actions workflow (`.github/workflows/refresh-data.yml`) runs this on the 1st and 15th of each month. When the data has changed, it opens a pull request. You can also start it by hand from the Actions tab.

## Run locally

The page loads JSON with `fetch`, so open it over HTTP instead of `file://`:

```bash
python -m http.server 8000
```

## Caveats

These are *known* planets. Detection methods are heavily biased, and most stars have never been searched thoroughly, so occurrence percentages here are lower bounds shaped by survey history, not true planet occurrence rates. The page's "Read with care" section has the details.

## Credits

This research has made use of the NASA Exoplanet Archive, which is operated by the California Institute of Technology, under contract with the National Aeronautics and Space Administration under the Exoplanet Exploration Program. This work has made use of data from the European Space Agency (ESA) mission Gaia, processed by the Gaia Data Processing and Analysis Consortium (DPAC). Charts by [Plotly.js](https://plotly.com/javascript/).
