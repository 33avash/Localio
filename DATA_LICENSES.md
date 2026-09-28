# Licences

The code in this repository is MIT licensed (see [LICENSE](LICENSE)). The data and the third-party tools it uses come under their own terms, listed here.

## Data

| Source | Used for | Terms |
|---|---|---|
| Google Places API, collected 2026-09-18 (`seed_data/pune_cafes_qsr.csv`) | the 260 cafes and QSRs | [Google Maps Platform Terms](https://cloud.google.com/maps-platform/terms). Included for coursework. It is **not** covered by this repository's MIT licence, and Google's terms limit storing and redistributing Places content. |
| Meta High Resolution Settlement Layer v1.5.2 | population per catchment (`seed_data/catchments.geojson`) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). © Meta Platforms and CIESIN, Columbia University. |
| OpenStreetMap | basemap tiles | [ODbL](https://www.openstreetmap.org/copyright). Attribution is shown on the map. |
| CARTO basemaps (optional) | Positron tiles when a key is set | [CARTO basemap terms](https://carto.com/basemaps). Attribution is shown on the map. |

## Tools

| Tool | Role | Licence |
|---|---|---|
| Docker Engine and Compose | containers and orchestration | Apache 2.0 |
| Python 3.11 | pipeline runtime | PSF |
| pandas | loading and aggregation | BSD 3-Clause |
| openpyxl | reading `.xlsx` seeds | MIT |
| NumPy | numeric work | BSD 3-Clause |
| rasterio | reading the population raster | BSD 3-Clause |
| Shapely | catchment geometry | BSD 3-Clause |
| pyproj | coordinate transforms | MIT |
| nginx | web server | BSD 2-Clause |
| Leaflet 1.9.4 | the map | BSD 2-Clause |
| IBM Plex Sans and Mono | typefaces | SIL Open Font License 1.1 |
| GitHub Actions | CI | GitHub terms (hosted service) |
