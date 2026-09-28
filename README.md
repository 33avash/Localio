# Localio

**Where in Pune should I open a cafe or a QSR?**

Localio answers that with open data. It scores every one of Pune's 140 wards on two things: how busy the ward is, and how many cafes (or quick-service restaurants) are already there for its residents. You get a ranked top 5 on a map, each ward's likely shop rent, and a chat that answers questions from the same numbers.

![The shortlist: five Pune wards ranked for a new cafe, each with its score and monthly rent, and numbered markers on a map of wards shaded by cafes per 10,000 residents](docs/screenshot.png)

## Run it

You need Docker with Compose v2.

```
git clone https://github.com/33avash/Localio.git
cd Localio
docker compose up --build
```

Open **http://localhost:8080** when the `data` container has finished. No keys or network access are needed apart from map tiles.

To stop it: `docker compose down`.

## Use it

1. **Format.** Cafe or QSR.
2. **Priority.** Busy areas, Balanced, or Low competition.
3. **Shortlist.** The top 5 wards, with the monthly rent for your shop size. Click a ward for the details.
4. **Ask.** Questions like "Tell me about Baner" or "Which areas have no cafes yet?".

## How a ward is scored

| Part | What it measures | How |
|---|---|---|
| **Busyness** | where people live, eat out, work, study and travel | the average of the ward's rank (0 to 1) on residents per km², food and drink outlets per km², and offices, colleges and stations per km² |
| **Competition** | how crowded your format is | your format's outlets per 10,000 residents, as `x / (x + city median)`: 0 with none, 0.5 at the median |

```
score = 100 × (busyness weight × busyness + competition weight × (1 − competition))
```

| Priority | Busyness weight | Competition weight |
|---|---|---|
| Busy areas | 0.8 | 0.2 |
| Balanced | 0.5 | 0.5 |
| Low competition | 0.2 | 0.8 |

Wards with fewer than 10 mapped outlets are scored but kept off the shortlist unless you ask for them. OpenStreetMap maps so few mostly where its coverage is thin, not where the market is empty.

**Rent** = typical Pune shop rent (₹137.5 per sq ft a month, the median of 25 listings) × the ward's tier (0.6× to 1.68×, from Cushman & Wakefield's published high-street rents) × your shop size. Localio doesn't forecast sales or profit; there is no open data to do that honestly.

## How it's built

Four containers, started in order by Docker Compose:

```
db (PostGIS) ──▶ data (Python pipeline, runs once) ──▶ ./output ──▶ web (nginx: map)
                                                              └──▶ api (FastAPI: chat)
```

- **db**: a throwaway PostGIS database. The pipeline uses it to place every outlet in its ward by boundary (`ST_Contains`).
- **data**: reads `seed_data/`, scores the wards, checks the results, and writes `wards.geojson`, `pois.geojson` and `rent.json`. If any check fails it writes nothing, and the site doesn't start.
- **web**: nginx serves the map (Leaflet, plain JavaScript) and the pipeline's output.
- **api**: answers chat questions from each ward's facts, and refuses anything off-topic.

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) has the full picture.

### Repository layout

```
data/        the pipeline (Python) and its tests
api/         the chat service (FastAPI) and its tests
web/         the map: static HTML, CSS and JavaScript, served by nginx
tests/e2e/   browser tests (Playwright)
tools/geo/   one-off tools that rebuild seed_data/ from the internet
seed_data/   every input, committed, so a build never needs the network
scripts/     verify.sh: clean start to all tests in one command
docs/        architecture, the manual QA checklist, the screenshot
```

## Check it works

```
make verify        # or: bash scripts/verify.sh
```

It tears everything down, rebuilds, runs the pipeline's checks, both test suites, the chat evaluation and the browser tests, then prints a summary:

```
localio verify
  ok    clean start
  ok    build, pipeline, health checks
  ok    pipeline checks
  ok    pipeline unit tests
  ok    api unit tests
  ok    chat evaluation
  ok    end-to-end and visual tests
all checks passed
```

GitHub Actions runs the same checks on every pull request.

## Data

| Data | Source | Licence |
|---|---|---|
| 140 ward boundaries (2012) | [DataMeet](https://github.com/datameet/Pune_wards) | CC BY-SA 2.5 IN |
| Residents per ward | Census 2011 totals, shared by 2012 voter rolls (PMC) or equally (PCMC) | Government Open Data Licence |
| 1,702 food and drink outlets inside the wards; offices, colleges, stations | [OpenStreetMap](https://www.openstreetmap.org), via Overpass | ODbL |
| High-street rents | [Cushman & Wakefield](https://www.cushmanwakefield.com/en/india/insights/pune-marketbeat), Q2 2026 | cited figures |
| Shop listings | [Square Yards](https://www.squareyards.com/rent/shops-for-rent-in-pune), 25 listings | cited figures |

[DATA_LICENSES.md](DATA_LICENSES.md) lists every source and tool with its terms. The code is MIT licensed.

## Limits

- **OpenStreetMap misses outlets**, most of all in Pimpri-Chinchwad, so "no cafes" can mean "none mapped yet". Check on the ground.
- **Residents are 2011 figures** on 2012 wards. Pune has grown since, especially at its edges.
- **Rent is a guide, not a quote.** Tiers come from ten published streets; the other wards are estimated from their zone.
- **The score compares wards.** It says where to look first, not what a shop will earn.

## Optional settings

Copy `.env.example` to `.env` to set:

- `GEMINI_API_KEY`, for chat answers written by Gemini instead of templates. Only the question and public ward figures are sent.
- `LOCALIO_CARTO_KEY`, for the quieter CARTO basemap instead of OpenStreetMap tiles.
- `LOCALIO_PORT`, if port 8080 is taken.

## More

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): the containers and how data moves between them
- [DECISIONS.md](DECISIONS.md): the main design choices and why
- [docs/QA.md](docs/QA.md): what to check by hand before a demo
