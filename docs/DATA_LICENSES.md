# Licences

Localio's code is MIT licensed (see [LICENSE](../LICENSE)). The data and tools it uses come under their own terms, listed here.

## Data

| Source | Used for | Terms |
|---|---|---|
| [DataMeet Pune wards](https://github.com/datameet/Pune_wards) (`seed_data/wards/`) | the 140 ward boundaries, PMC ward titles and 2012 voter rolls | [CC BY-SA 2.5 India](https://creativecommons.org/licenses/by-sa/2.5/in/), © DataMeet Trust. Share-alike: `wards.geojson`, derived from these boundaries, carries the same licence. |
| Census of India 2011 | the PMC and PCMC population totals | [Government Open Data Licence – India](https://data.gov.in/government-open-data-license-india) |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) (`seed_data/osm_raw.json`, `osm_context.json`) | food and drink outlets, offices, colleges, stations, place names; basemap tiles | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/), © OpenStreetMap contributors. Attribution is shown on the map. |
| Meta High Resolution Settlement Layer v1.5.2 | a cross-check column in `seed_data/ward_population.csv` (not used for scoring) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), © Meta Platforms and CIESIN |
| [Cushman & Wakefield Pune Retail MarketBeat, Q2 2026](https://www.cushmanwakefield.com/en/india/insights/pune-marketbeat) (`seed_data/rent_high_streets.csv`) | prime rents for ten Pune high streets | Published figures, cited with their source. Not covered by the MIT licence. |
| [Square Yards shop listings](https://www.squareyards.com/rent/shops-for-rent-in-pune) (`seed_data/rent_listings.csv`) | 25 asking rents, for the typical rent | Published figures, cited with their source. Not covered by the MIT licence. |
| [DineOpen](https://www.dineopen.com/blog/restaurant-profit-margins-india-guide.html) (`seed_data/rent_benchmarks.csv`) | shop size and healthy rent share | Published figures, cited with their source. |
| CARTO basemaps (optional) | quieter tiles when a key is set | [CARTO basemap terms](https://carto.com/basemaps) |
| Google Gemini API | writing the chat's replies from Localio's facts, when a key is set | [Gemini API terms](https://ai.google.dev/gemini-api/terms). On the free tier, Google may use prompts and replies to improve its products; Localio sends only the question and public ward figures. |

Earlier versions used a table of 260 outlets from the Google Places API. Google's terms restrict storing and redistributing Places content, so it was removed from the repository and from its history.

## Tools

| Tool | Role | Licence |
|---|---|---|
| Docker Engine and Compose | containers and orchestration | Apache 2.0 |
| PostgreSQL and PostGIS | spatial joins | PostgreSQL Licence, GPL 2.0 |
| Python 3.11 | pipeline | PSF |
| pandas, NumPy | tables and numbers | BSD 3-Clause |
| Shapely | ward geometry, label points | BSD 3-Clause |
| psycopg | Python to PostgreSQL | LGPL 3.0 |
| rasterio | reading the population raster (tools only) | BSD 3-Clause |
| requests | calling Overpass (tools only) | Apache 2.0 |
| nginx | web server | BSD 2-Clause |
| Leaflet 1.9.4 | the map | BSD 2-Clause |
| IBM Plex Sans and Mono | typefaces | SIL Open Font License 1.1 |
| Instrument Serif | display typeface | SIL Open Font License 1.1 |
| pytest, Playwright, axe-core | tests | MIT, Apache 2.0, MPL 2.0 |
| GitHub Actions and Pages | checks and the published site | GitHub terms (hosted service) |
