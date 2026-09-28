# Seed data sources

## pune_cafes_qsr.csv

260 cafes and QSRs across 51 Pune localities, collected through the Google Places API on 2026-09-18. It's Google Maps Platform content, used here for coursework under Google's terms. It is not covered by this repository's MIT license.

## catchments.geojson

One polygon per locality, with the number of people living in it. Built by `tools/catchments/build_catchments.py`:

```
docker compose run --rm catchments
```

- **Shape:** the locality's Voronoi cell (the land closer to its centre than to any other locality's), cut back to within 2 km of its own outlets. OpenStreetMap has no boundary for the Pune or Pimpri-Chinchwad municipal corporations (checked 2026-09-26), so distance to outlets stands in for city limits. These are catchments, not official wards.
- **Population:** summed from Meta's High Resolution Settlement Layer v1.5.2, 30 m cells. © Meta Platforms and CIESIN, Columbia University, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The tool reads only the Pune window of the tile over HTTP.

The file is committed so the pipeline never needs a network connection. Rebuild it only if the seed's localities change.
