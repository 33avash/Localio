# Localio

Localio turns open location data into site-selection decisions.

It reads where Pune's cafes and quick-service restaurants (QSRs) already are, cross-references how much food-and-beverage demand each locality actually generates, and surfaces the gaps: places with proven footfall but thin competition in your category.

It answers one question, end to end: **"I want to open a cafe (or QSR) in Pune. Where should I look?"**

This is not a general-purpose map dashboard. Every screen moves you toward a ranked, justified shortlist of localities.

![The shortlist step: five Pune localities ranked for a new cafe, each with a score and a one-line reason, and numbered markers over a map of catchments shaded by cafes per 10,000 residents](docs/screenshot.png)

## Scope

**In:** Pune cafes and QSRs; 51 localities; a reproducible containerised pipeline from seed CSV to a scored map; a guided flow that ends in a ranked, explained top 5.

**Out:** other cities and categories, rent and footfall counts from paid sources, and anything live. The seed is a one-off snapshot, so Localio says where the gaps were on 18 September 2026, not where they are today.

## Status

| | What | State |
|---|---|---|
| v1 | Pipeline with validation, two-container Compose setup, three-step map | done |
| v2 part A | Catchments with population, choropleth, fitted map, marker collision, fixed panel footer | done, in review |
| v2 part B | Footfall model and market types (scikit-learn), detail drawer, chat over the localities, test harness, `make verify` | in progress for the final submission |

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) has diagrams of the current and planned setup. [DECISIONS.md](DECISIONS.md) logs the choices behind it.

## Run it

You need Docker with Compose v2.

```
git clone https://github.com/33avash/Localio.git
cd Localio
docker compose up --build
```

Open http://localhost:8080 once the `data` container has exited. Its log should end like this:

```
  ok    top cafe    Deccan Gymkhana 39.8, Wakad 34.7, Shivajinagar 27.5
  ok    top QSR     Koregaon Park 32.2, Deccan Gymkhana 29.9, Kalyani Nagar 26.2
        wrote       output/pois.geojson (259 features)
        wrote       output/localities.geojson (51 features)
```

The map works as it is. For the quieter CARTO Positron basemap, get a free key at [carto.com/basemaps](https://carto.com/basemaps), then:

```
cp .env.example .env        # then paste the key into LOCALIO_CARTO_KEY
docker compose up -d web
```

## Using it

The panel walks you through three steps, and the map follows along.

1. **What are you opening?** Pick cafe or QSR. The map shows every outlet of that kind, with the other kind in grey so you can see where people already go to eat.
2. **What matters most?** Pick a lens: low competition, proven footfall or weak incumbents. The map shades each locality's catchment by how many of your format there are per 10,000 residents. Hatched areas have too few outlets to score.
3. **Your shortlist.** The top five localities for that lens, each with a score and a one-line reason built from its numbers. Click a row to fly to it; hover one to find its marker. You can switch lenses here and the list re-ranks on the spot.

Completed steps in the rail at the top of the panel take you back. On a phone the panel is a sheet under the map; drag its handle to resize it.

The URL keeps your place (for example `#shortlist/qsr/footfall`), so a shortlist can be bookmarked or sent to someone.

## How it works

Two containers, run with Docker Compose (diagram in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)):

- `data/` reads the seed file, cleans it, aggregates by locality, joins each locality's catchment and population, scores each locality and writes GeoJSON to `./output/`. It then exits.
- `web/` is nginx. It serves the map from `web/static/` and the files in `./output/` at `/data/`. It only starts after `data` exits successfully, so it never serves a map without numbers.

A third service, `catchments`, rebuilds the population file. It needs network access, so it sits behind a Compose profile and never runs on `docker compose up`.

`./output/` is a bind mount, not a named volume. A named volume keeps the previous run's files, and the map would quietly show stale numbers. For the same reason nginx sends `/data/` with `Cache-Control: no-store`.

The front end is plain ES modules with no build step. Leaflet 1.9.4 and the IBM Plex fonts are vendored into `web/static/vendor/` (`npm run vendor` in `web/` refreshes them), so building and loading the page never depends on a CDN. Map tiles are the one thing that still comes over the network.

## The opportunity score

Every scored locality gets one score for cafes and another for QSRs. Higher means a better place to open. With the default weights, cafe scores run from -16 to 40 and QSR scores from -3 to 32. The score combines three things:

- **Demand**: how busy the area is for food and drink overall. We use the total number of Google reviews across every cafe and QSR in the locality as a stand-in for footfall.
- **Supply**: how many places of *your* category are already there. More competitors pull the score down.
- **Weakness**: how beatable those competitors are. It's 5 minus their average rating, so a strip of 3.8-star cafes scores higher than a strip of 4.7-star ones. If there are no rated competitors, we use a neutral 0.5.

Each of the three is scaled to 0–1 across the scored localities, then combined:

```
score = 100 × (0.45 × demand − 0.40 × supply + 0.15 × weakness)
```

The map lets you swap those weights for one of three lenses (low competition, proven footfall, weak incumbents). The browser re-ranks instantly because the pipeline ships the scaled components, not just the final score.

Only localities with at least 4 cafes and QSRs combined are scored. Below that, one extra outlet swings the numbers too much to mean anything. Those localities still appear on the map, marked as not enough data.

The map shades each catchment by **outlets per 10,000 residents** rather than raw counts, because 8 cafes among 300,000 people is a thinner market than 5 among 20,000. Non-zero values fall into five quantile classes, worked out separately for cafes, QSRs and both together. Zero gets its own grey class: "none yet" is an answer, not the bottom of a scale.

### Why localities, not grid cells

The seed data has a `grid_cell_id` column, and a grid looks like the natural unit for a density map. We don't use it. There are about 1.5 POIs per cell, so a cell with 2 cafes and a cell with 0 differ by chance, not by market. Localities hold 0–12 POIs per category. That's enough to tell a crowded area from an empty one, and it matches how people actually talk about where to open ("Baner", not "cell G3707_14779").

### Why demand is log-scaled

Deccan Gymkhana has 121,097 reviews across its outlets. The next highest, Koregaon Park, has 42,736. On a linear scale Deccan Gymkhana would take the top of the range and push every other locality toward zero, so demand would stop separating anything except one outlier. `log10(1 + reviews)` keeps the order but compresses the gap, and the middle of the pack stays readable.

### Checking the numbers

A wrong aggregation still draws a map that looks perfectly fine. So the pipeline checks its own output against known figures before writing anything: 259 POIs, 51 localities, 165 cafes and 94 QSRs, a catchment with people in it for every locality, 23 scored localities, and the top three for each category. If any check fails it exits with an error and writes nothing. The expected values live in [data/localio/validate.py](data/localio/validate.py); update them if you swap in a different dataset.

## Data

`seed_data/pune_cafes_qsr.csv` has 260 cafes and QSRs across 51 Pune localities, collected via the Google Places API on 2026-09-18.

It was exported once from the original spreadsheet so that changes show up in diffs. Excel date serials became ISO dates and day-fraction times became `HH:MM`; no values were altered. The pipeline still reads `.xlsx` directly if you point it at one.

One row in the source is blank, and the pipeline drops it and logs why. That leaves 259 POIs: 165 cafes and 94 QSRs.

`seed_data/catchments.geojson` gives each locality an area and a population. The area is its Voronoi cell, cut back to within 2 km of its own outlets; OpenStreetMap has no municipal boundary for Pune to clip to. The population comes from Meta's High Resolution Settlement Layer (30 m cells, CC BY 4.0): 5.15 million people across the 51 catchments. [seed_data/SOURCES.md](seed_data/SOURCES.md) explains how the file is built and how to rebuild it.

## Troubleshooting

**The page says it has to be served over HTTP.** You opened `web/static/index.html` straight from disk. Browsers block module scripts and `fetch()` on `file://`, so the page can't load its code or its data. Use http://localhost:8080.

**"Could not load map data".** The `data` container hasn't finished, or it failed a check. `docker compose logs data` shows which. A failed check exits non-zero and writes nothing, and `web` won't start in that case.

**Port 8080 is taken.** Pick another port: `LOCALIO_PORT=8090 docker compose up`, or set `LOCALIO_PORT` in `.env`.

**Grey map, or a "Basemap unavailable" note.** Tiles need an internet connection. Without one, the map falls back to a flat background, and markers, popups and the shortlist all keep working.

**"API KEY REQUIRED" across the map.** CARTO started requiring a key on 23 September 2026. Localio only asks CARTO for tiles when `LOCALIO_CARTO_KEY` is set, so this means the key is wrong or expired. Clear it to go back to OpenStreetMap tiles.

## License

The code is MIT. See [LICENSE](LICENSE). The data and tools come under their own terms, listed in [DATA_LICENSES.md](DATA_LICENSES.md). In particular, the Google Places seed is included for coursework and is not MIT licensed.
