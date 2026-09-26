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

Everything works without any keys. Two are optional, set in `.env` (copy `.env.example`):

- `LOCALIO_CARTO_KEY`, free from [carto.com/basemaps](https://carto.com/basemaps), for the quieter CARTO Positron basemap.
- `GEMINI_API_KEY`, free from [Google AI Studio](https://aistudio.google.com/apikey), so Gemini Flash writes the chat's answers instead of templates. Google may use free-tier prompts to improve its products; Localio sends only the question and public locality figures.

After changing `.env`, run `docker compose up -d web api`.

## Check it works

```
make verify          # or, without make: bash scripts/verify.sh
```

It tears everything down and rebuilds from scratch, then waits for the health checks. It runs the pipeline's own checks, both pytest suites, the chat evaluation, and the Playwright end-to-end and visual tests in their official container. A run on 26 September 2026:

```
localio verify
  ok    clean start                        1s
  ok    build, pipeline, health checks     10s
  ok    pipeline checks                    0s
  ok    pipeline unit tests                4s
  ok    api unit tests                     8s
  ok    chat evaluation                    5s
  ok    end-to-end and visual tests        36s
all checks passed
```

The Playwright tests check the whole flow: tiles or the fallback notice; outlet dots; Cafe → Continue; a different leader per lens; exactly five markers with none within 30px; a shortlist row opening the drawer; the chat citing a locality it names; "who won the world cup" refused; keyboard-only navigation; and 4.5:1 contrast. The visual tests compare every step at 1440, 1024 and 390px against committed baselines. Narrowing the panel by 32px fails 8 of the 12, which is the point. GitHub Actions runs the same checks on every pull request. [docs/QA.md](docs/QA.md) lists what still needs a person and a real browser before a demo.

## Using it

The panel walks you through three steps, and the map follows along.

1. **What are you opening?** Pick cafe or QSR. The map shows every outlet of that kind, with the other kind in grey so you can see where people already go to eat.
2. **What matters most?** Pick a lens: low competition, proven footfall or weak incumbents. The map shades each locality's catchment by how many of your format there are per 10,000 residents. Hatched areas have too few outlets to score.
3. **Your shortlist.** The top five localities for that lens, each with a score, a bar to compare it against the leader, and a one-line reason built from its numbers. Switch lenses and the scores count to their new values. Filters cap how many competitors you'll accept, or bring in the low-confidence areas.

Click any area, numbered marker or shortlist row to open its **detail drawer**. It has residents and residents per outlet against the city median, both formats side by side, the menu mix, chains against independents, the late-night share, and the footfall model's estimate with its range and what drives it. It ends with a one-sentence recommendation. **How it works**, at the top of the panel, shows what each model does and how it was checked.

4. **Ask.** Type a question ("Is Baner a good place for a QSR?", "Which areas have no cafes yet?"). Answers use only Localio's numbers, and the localities they rely on appear as chips that open the drawer. Questions that aren't about opening a cafe or QSR in Pune get a polite refusal instead of an invented answer.

Completed steps in the rail at the top of the panel take you back. On a phone the panel is a sheet under the map; drag its handle to resize it.

The URL keeps your place (for example `#shortlist/qsr/footfall`), so a shortlist can be bookmarked or sent to someone.

## How it works

Three containers, run with Docker Compose (diagram in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)):

- `data/` reads the seed file, cleans it, aggregates by locality, joins each locality's catchment and population, scores each locality and writes GeoJSON to `./output/`. It then exits.
- `web/` is nginx. It serves the map from `web/static/` and the files in `./output/` at `/data/`. It only starts after `data` exits successfully, so it never serves a map without numbers.
- `api/` is a FastAPI service for the chat, proxied by nginx at `/api/`. It reads the same `./output/` files. nginx resolves it per request, so if `api` is down the map still works and the chat says so.

A third service, `catchments`, rebuilds the population file. It needs network access, so it sits behind a Compose profile and never runs on `docker compose up`.

`./output/` is a bind mount, not a named volume. A named volume keeps the previous run's files, and the map would quietly show stale numbers. For the same reason nginx sends `/data/` with `Cache-Control: no-store`.

The front end is plain ES modules with no build step. Leaflet 1.9.4 and the IBM Plex fonts are vendored into `web/static/vendor/` (`npm run vendor` in `web/` refreshes them), so building and loading the page never depends on a CDN. Map tiles are the one thing that still comes over the network.

## The opportunity score

Every locality gets one score for cafes and another for QSRs. Higher means a better place to open. With the default weights, cafe scores run from -16 to 43 and QSR scores from -15 to 36. The score combines three things:

- **Demand**: how busy a new outlet of your format would be here, as predicted by the footfall model below.
- **Supply**: how many places of *your* format are already there **per 10,000 residents**. More competitors per head pull the score down.
- **Weakness**: how beatable those competitors are. It's 5 minus their average rating, so a strip of 3.8-star cafes scores higher than a strip of 4.7-star ones. If there are no rated competitors, it's a neutral 0.5.

Each of the three is scaled to 0–1 across all 51 localities, then combined:

```
score = 100 × (0.45 × demand − 0.40 × supply + 0.15 × weakness)
```

The map lets you swap those weights for one of three lenses (low competition, proven footfall, weak incumbents). The browser re-ranks instantly because the pipeline ships the scaled components, not just the final score.

Localities with fewer than 4 cafes and QSRs are scored too, but flagged low-confidence. They're hatched on the map and left off the shortlist, because their numbers rest on one or two outlets.

The map shades each catchment by **outlets per 10,000 residents** rather than raw counts, because 8 cafes among 300,000 people is a thinner market than 5 among 20,000. Non-zero values fall into five quantile classes, worked out separately for cafes, QSRs and both together. Zero gets its own grey class: "none yet" is an answer, not the bottom of a scale.

## Machine learning, and what it's used for

The pipeline trains three things with scikit-learn. Each answers a question the hand-weighted score can't, and each is checked before it's used. The Method view in the app shows the same numbers.

**1. Footfall model: "how busy would my new outlet be here?"** Google gives no visit counts, so each outlet's review count stands in for footfall, and the model predicts `log(1 + reviews)`. Its inputs are the outlet's type (format, chain, price level, hours, late-night) and its surroundings: distance from the centre, residents per km², cafes and QSRs within 500 m and 1 km, and how reviewed those neighbours are. None of these counts the outlet itself.

It's validated by holding out whole localities, five folds of `GroupKFold`, so every error is measured on places the model has never seen. A random split would leak neighbourhood context and flatter it.

| Model | Mean abs. error (log reviews) | R² | Rank correlation |
|---|---|---|---|
| Median baseline | 1.300 | −0.01 | −0.10 |
| **Ridge regression** | **1.211** | **0.12** | **0.36** |
| Gradient boosting | 1.245 | 0.00 | 0.34 |

Ridge is used because it beats the baseline, and only because it does: if it didn't, the pipeline would fall back to observed reviews and say so in its log. Gradient boosting, the obvious upgrade, does worse with 259 outlets. The signal is real but modest, so the app always shows the model's 80% range next to its estimate, and that range is wide.

For each locality the model is asked about a standard new independent outlet (price level 2, 13 hours a day, not open late) of each format. That prediction becomes the demand term. Because Ridge is linear, each prediction splits exactly into what each feature added, and the three biggest place-related parts become the "what drives this" line in the app. The strongest effects are the number of cafes and QSRs within 1 km (+0.25 log reviews per standard deviation) and how reviewed nearby outlets are (+0.17).

**2. Market types: "what kind of market is this, and where else is like it?"** k-means groups the 51 localities by outlets per head, chain share, price, late-night share, rating, predicted demand and cafe share. k runs from 3 to 6 and is chosen by silhouette score; that gives 5 types, but a silhouette of 0.24 means the groups overlap a lot. They describe the city, they don't predict anything. Each locality also lists the three localities with the most similar profile.

**3. Retrieval and refusal for the chat.** Each locality becomes a short card of plain sentences built from its numbers. An open embedding model (`BAAI/bge-small-en-v1.5`, run with fastembed on ONNX, no GPU) turns the cards and each question into vectors. A question is answered only if it names a locality, uses a domain word (cafe, QSR, footfall, competition…), or sits close to some locality's card. "Best area for…" and "no cafes yet" questions are answered from the scores, because similarity can't rank by a number. Everything else uses the closest cards. Gemini Flash then writes up to three sentences from those cards only; any locality it cites that wasn't retrieved is dropped. With no key, or if Gemini fails, the answer comes from templates over the same cards.

It's checked on 41 labelled questions in `api/tests/ask_cases.jsonl`. All 11 off-topic ones are refused, and all 30 on-topic ones cite an expected locality. The most similar off-topic question ("What's the weather in Pune today?") scores 0.53 against the cards, below the 0.62 floor. `docker compose run --rm api python -m localio_api.evaluate` reruns it.

Menu types (coffee, chai, burgers and so on) are tagged by rules, not a model: a table for 36 of the 37 chain brands (Platesman is left to the name rules rather than guessed) and keywords in outlet names. 2.7% of outlets end up as "Other".

### Why localities, not grid cells

The seed data has a `grid_cell_id` column, and a grid looks like the natural unit for a density map. We don't use it. There are about 1.5 POIs per cell, so a cell with 2 cafes and a cell with 0 differ by chance, not by market. Localities hold 0–12 POIs per category. That's enough to tell a crowded area from an empty one, and it matches how people actually talk about where to open ("Baner", not "cell G3707_14779").

### Why demand is log-scaled

Deccan Gymkhana has 121,097 reviews across its outlets. The next highest, Koregaon Park, has 42,736. On a linear scale Deccan Gymkhana would take the top of the range and push every other locality toward zero, so demand would stop separating anything except one outlier. `log10(1 + reviews)` keeps the order but compresses the gap, and the middle of the pack stays readable.

### Checking the numbers

A wrong aggregation still draws a map that looks perfectly fine. So the pipeline checks its own output against known figures before writing anything: 259 POIs, 51 localities, 165 cafes and 94 QSRs, a catchment with people in it for every locality, and the top three for each category under the original v1 score (kept only for this check). Then it checks the v2 output: every score a real number within ±100, the low-confidence count printed, menu "Other" under 8%, and no recommendation sentence with an unfilled slot. If any check fails it exits with an error and writes nothing. `docker compose run --rm data python -m pytest tests` runs the unit tests. The expected values live in [data/localio/validate.py](data/localio/validate.py); update them if you swap in a different dataset.

## Data

`seed_data/pune_cafes_qsr.csv` has 260 cafes and QSRs across 51 Pune localities, collected via the Google Places API on 2026-09-18.

It was exported once from the original spreadsheet so that changes show up in diffs. Excel date serials became ISO dates and day-fraction times became `HH:MM`; no values were altered. The pipeline still reads `.xlsx` directly if you point it at one.

One row in the source is blank, and the pipeline drops it and logs why. That leaves 259 POIs: 165 cafes and 94 QSRs.

`seed_data/catchments.geojson` gives each locality an area and a population. The area is its Voronoi cell, cut back to within 2 km of its own outlets; OpenStreetMap has no municipal boundary for Pune to clip to. The population comes from Meta's High Resolution Settlement Layer (30 m cells, CC BY 4.0): 5.15 million people across the 51 catchments. [seed_data/SOURCES.md](seed_data/SOURCES.md) explains how the file is built and how to rebuild it.

## Troubleshooting

**The page says it has to be served over HTTP.** You opened `web/static/index.html` straight from disk. Browsers block module scripts and `fetch()` on `file://`, so the page can't load its code or its data. Use http://localhost:8080.

**"Could not load map data".** The `data` container hasn't finished, or it failed a check. `docker compose logs data` shows which. A failed check exits non-zero and writes nothing, and `web` won't start in that case.

**The chat says it isn't reachable.** The `api` container isn't running or is still starting (it takes a few seconds to load the embedding model). `docker compose ps` shows it; `docker compose logs api` says why.

**Port 8080 is taken.** Pick another port: `LOCALIO_PORT=8090 docker compose up`, or set `LOCALIO_PORT` in `.env`.

**Grey map, or a "Basemap unavailable" note.** Tiles need an internet connection. Without one, the map falls back to a flat background, and markers, popups and the shortlist all keep working.

**"API KEY REQUIRED" across the map.** CARTO started requiring a key on 23 September 2026. Localio only asks CARTO for tiles when `LOCALIO_CARTO_KEY` is set, so this means the key is wrong or expired. Clear it to go back to OpenStreetMap tiles.

## License

The code is MIT. See [LICENSE](LICENSE). The data and tools come under their own terms, listed in [DATA_LICENSES.md](DATA_LICENSES.md). In particular, the Google Places seed is included for coursework and is not MIT licensed.
