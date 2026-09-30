# Architecture

One `docker compose up` goes from committed seed files to a working site. The pipeline runs once and exits; nginx then serves the site and the files the pipeline wrote. The same containers build the published site on GitHub.

![Localio's architecture: seed files go through the data pipeline and its checks into ./output, which nginx and GitHub Pages serve to the browser; the browser asks Gemini to word chat replies from Localio's facts](architecture.png)

The source is [architecture.svg](architecture.svg); edit it and re-export the PNG.

## Containers

| Service | Image | Runs | Job |
|---|---|---|---|
| `db` | `postgis/postgis:17-3.5` | while the stack is up | Spatial joins for the pipeline. Its data lives in tmpfs, so every run starts empty. |
| `data` | `python:3.11-slim` + pandas, shapely, psycopg | once; exits 0 or 1 | Load, join, score, check, write `./output`. |
| `web` | `nginx:alpine` | long-running, port 8080 | Serve the site and `./output` at `/data/`. |
| `e2e` | `mcr.microsoft.com/playwright` | on demand (`test` profile) | Browser tests against `web`. |
| `osm`, `population` | `python:3.11-slim` + requests, rasterio | on demand (`tools` profile) | Rebuild `seed_data/` from the internet. |

## How the pieces connect

- **Start order.** `data` waits for `db` to be healthy; `web` waits for `data` to finish successfully. A failed check means the site never shows bad numbers.
- **No stale state.** The database uses tmpfs, `./output` is a bind mount rather than a named volume, and nginx serves `/data/` with `Cache-Control: no-store`. Every run shows that run's numbers.
- **Atomic writes.** The pipeline writes each file to a `.tmp` sibling and then renames it, so nginx never serves half a file.
- **The browser does the interactive work.** The pipeline ships each ward's four score parts, the default weights and its rent tier. The site turns the user's brief into weights (`web/static/js/score.js`), so any change re-ranks instantly, and the map, the comparison and the chat all work from the same files. A test checks the browser reproduces all 280 of the pipeline's scores.
- **Offline by default.** Seed data, Leaflet and the fonts are committed. The only runtime network use is map tiles, and the map still works without them.

## The chat

Two layers, so answers stay as accurate as the map:

1. **Localio's engine** (`web/static/js/chat.js`) reads the question: the wards it names, and any format, area, budget, shop size or customers ("near colleges", "low competition"). It works out the answer from the ward data, exactly as the map would.
2. **The AI model** (`web/static/js/llm.js`, Gemini: `gemini-3.5-flash-lite`, then `gemini-3.5-flash` if that's busy) gets only the facts for that question: the brief, how the score works, the top 5 for the plan the question implies, and a card of figures for each ward in question. It words the reply under rules to use nothing else, never recalculate, decline off-topic questions and never name itself. It returns the wards it used, which are checked against the data.

With no key, a busy model, a rate limit (8 questions a minute per visitor) or a reply that fails its checks, the engine's own answer is shown. Tests mock the model: they check what it's sent, what's shown, the fallback, and that the page never names it.

The site is static, so the browser calls the model directly and the key is readable in `config.json`. It's written by nginx from `.env` locally and by the Pages workflow from the `GEMINI_API_KEY` repository secret. Use a free-tier key, and in [Google Cloud's credentials page](https://console.cloud.google.com/apis/credentials) restrict it to the site (**Websites**: `https://33avash.github.io/*`, and `http://localhost:8080/*` for local use) and to the Generative Language API.

## Publishing

`.github/workflows/pages.yml` runs on every push to `main`: `docker compose run --rm data` (which starts `db`), then it copies `web/static/` and the three output files into one folder and publishes it to GitHub Pages. If a pipeline check fails, nothing is published. `.github/workflows/checks.yml` runs the pipeline tests and the browser tests on every pull request.

## What the pipeline checks

The pipeline refuses to write anything if:
- the ward count isn't 76 PMC + 64 PCMC,
- any ward has more than 120,000 residents,
- the PMC total isn't within 5% of the Census 2011 figure (3,124,458),
- there are fewer than 1,200 outlets or 200 cafes, or outlets per 10,000 residents fall outside 2–40,
- any score is outside 0–100,
- any recommendation still has an unfilled `{slot}`,
- any ward has no rent tier.
