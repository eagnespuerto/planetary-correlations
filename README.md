# Planetary Correlations

A static page for exploring the confirmed exoplanets in the [NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/). Pick any two attributes to plot against each other (semi-major axis, period, radius, mass, density, eccentricity, insolation, star type, star mass, metallicity, distance, number of planets, discovery method and more). The page shows the correlation, a trend line and Solar System reference points.

Below the chart, the known planets are compared with the **Gaia DR3** census of nearby main-sequence stars, which answers questions like:

> Of Gaia DR3 K-type dwarfs within 50 pc, what share host a known sub-Neptune? Or 3 or more known planets?

## How the views work

- **Numeric × numeric** gives a scatter plot with Pearson r, Spearman ρ and a least-squares (power-law on log axes) fit.
- **Category × numeric** gives box plots with medians per category.
- **Category × category** gives a heatmap of counts, or row percentages ("of M-star planets, what % are sub-Neptunes").
- The URL hash stores the current axes, so a view can be shared as a link.

## Data

`scripts/fetch_data.py` (Python 3 standard library only) refreshes the two files in `data/`:

- `planets.json` is the archive's `pscomppars` table (one row per planet, composite parameters).
- `census.json` holds Gaia DR3 counts of main-sequence stars within 25, 50 and 100 pc (parallax/error > 10, two-segment colour–magnitude band), in 0.05 mag BP−RP bins, plus the Gaia colour and parallax of every known host that passes the same cuts.

```bash
python scripts/fetch_data.py
```

## Run locally

The page loads JSON with `fetch`, so open it over HTTP instead of `file://`:

```bash
python -m http.server 8000
```

## Caveats

These are *known* planets. Detection methods are heavily biased, and most stars have never been searched thoroughly, so occurrence percentages here are lower bounds shaped by survey history, not true planet occurrence rates. The page's "Read with care" section has the details.

## Credits

This research has made use of the NASA Exoplanet Archive, which is operated by the California Institute of Technology, under contract with the National Aeronautics and Space Administration under the Exoplanet Exploration Program. This work has made use of data from the European Space Agency (ESA) mission Gaia, processed by the Gaia Data Processing and Analysis Consortium (DPAC). Charts by [Plotly.js](https://plotly.com/javascript/).
