# Localio

**Where in Pune should I open a cafe or a QSR?**

Localio scores all 140 of Pune's wards on two things: how busy each one is, and how many places like yours are already there. Set your plan (format, priority, area, shop size, rent budget) and the map shows the best five wards, with the rent to expect and exactly why each one ranks where it does. A chat answers questions from the same data.

**Try it:** https://33avash.github.io/Localio/

![Localio: a plan on the left (cafe, balanced, all of Pune, 300 sq ft) with the top 5 wards and their scores, and the wards of Pune shaded by cafes per 10,000 residents on the map](docs/screenshot.png)

## Use it

- **Plan.** Pick a format, a priority and an area; type a shop size and a rent budget. The top 5 update as you go, and each score is split into its two parts. Click a ward for the details.
- **Ask.** Questions like *"Why is #1 ranked first?"*, *"Compare Baner and Aundh"* or *"Cafes in PCMC under ₹30k rent"*. Answers use only Localio's data, name the wards they rely on, and can set your plan on the map. Anything off-topic is refused.
- **Share.** The URL holds your plan (for example `#qsr/busy/pcmc?budget=40000`), so a link opens the same shortlist.

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

**Rent** = typical Pune shop rent (₹137.5 per sq ft a month, the median of 25 listings) × the ward's tier (0.6× to 1.68×, from Cushman & Wakefield's published high-street rents) × your shop size. Localio doesn't forecast sales or profit; there's no open data to do that honestly.

Wards with fewer than 10 outlets mapped are kept off the top 5 unless you include them: OpenStreetMap maps so few mostly where its coverage is thin, not where the market is empty.

## Run it yourself

You need Docker with Compose v2.

```
git clone https://github.com/33avash/Localio.git
cd Localio
docker compose up --build
```

Open **http://localhost:8080** once the `data` container has finished (about a minute the first time). No keys or accounts are needed. Stop it with `docker compose down`.

## How it's built

Three containers, started in order by Docker Compose:

```
db (PostGIS) ──▶ data (Python pipeline, runs once) ──▶ ./output ──▶ web (nginx: map + chat)
```

- **db**: a throwaway PostGIS database. The pipeline uses it to place every outlet in its ward by boundary (`ST_Contains`).
- **data**: reads `seed_data/`, scores every ward, runs its checks, and writes `wards.geojson`, `pois.geojson` and `rent.json`. If any check fails it writes nothing and the site doesn't start.
- **web**: nginx serves the map (Leaflet, plain JavaScript) and the pipeline's output. The chat runs in the browser on the same files.

GitHub Actions runs the same pipeline containers to publish the site to GitHub Pages on every push to `main`, and runs every test on every pull request. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) has the full picture.

### Repository layout

```
data/        the pipeline (Python) and its tests
web/         the site: HTML, CSS, JavaScript (map, plan, drawer, chat), served by nginx
tests/e2e/   browser tests (Playwright): the flow, the chat's labelled questions, visuals
tools/geo/   one-off tools that rebuild seed_data/ from the internet
seed_data/   every input, committed, so a build never needs the network
scripts/     verify.sh: clean start to all tests in one command
docs/        architecture, the manual QA checklist, the screenshot
.github/     checks on every pull request; publishing to GitHub Pages
```

## Check it works

```
make verify        # or: bash scripts/verify.sh
```

It tears everything down, rebuilds, and runs the pipeline's checks, its unit tests and the browser tests, then prints a summary:

```
localio verify
  ok    clean start
  ok    build, pipeline, health checks
  ok    pipeline checks
  ok    pipeline unit tests
  ok    browser tests: map, chat, visuals
all checks passed
```

## Data

| Data | Source | Licence |
|---|---|---|
| 140 ward boundaries (2012) | [DataMeet](https://github.com/datameet/Pune_wards) | CC BY-SA 2.5 IN |
| Residents per ward | Census 2011 totals, shared by 2012 voter rolls (PMC) or equally (PCMC) | Government Open Data Licence |
| 1,702 food and drink outlets in the wards; offices, colleges, stations | [OpenStreetMap](https://www.openstreetmap.org), via Overpass | ODbL |
| High-street rents | [Cushman & Wakefield](https://www.cushmanwakefield.com/en/india/insights/pune-marketbeat), Q2 2026 | cited figures |
| Shop listings | [Square Yards](https://www.squareyards.com/rent/shops-for-rent-in-pune), 25 listings | cited figures |

[DATA_LICENSES.md](DATA_LICENSES.md) lists every source and tool with its terms. The code is MIT licensed.

## Limits

- **OpenStreetMap misses outlets**, most of all in Pimpri-Chinchwad, so "no cafes" can mean "none mapped yet". Check on the ground.
- **Residents are 2011 figures** on 2012 wards. Pune has grown since, especially at its edges.
- **Rent is a guide, not a quote.** Tiers come from ten published streets; the other wards are estimated from their zone.
- **The score compares wards.** It says where to look first, not what a shop will earn.
- **The chat is rule-based.** It understands the questions it was built and tested for; for anything else it says what it can answer rather than guess.

## More

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): the containers, the pipeline's checks, and publishing
- [DECISIONS.md](DECISIONS.md): the main design choices and why
- [docs/QA.md](docs/QA.md): what to check by hand before a demo
- [seed_data/SOURCES.md](seed_data/SOURCES.md): every input and how to refresh it
