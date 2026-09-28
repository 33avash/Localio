# Architecture

One `docker compose up` goes from committed seed files to a working site. The pipeline runs once and exits; nginx then serves the site and the files the pipeline wrote. The same containers build the published site on GitHub.

```mermaid
flowchart LR
    seed["seed_data/<br/>wards, residents, OSM outlets,<br/>rent figures (committed)"]

    subgraph db["db · postgis/postgis · throwaway"]
        pg[("PostGIS<br/>tmpfs, no volume")]
    end

    subgraph data["data · python:3.11-slim · runs once"]
        direction TB
        load["load seed files"] --> join["place outlets in wards<br/>ST_Contains"]
        join --> count["counts, per 10k residents"]
        count --> score["busyness, competition,<br/>rent tier, recommendation"]
        score --> check{"checks"}
    end

    subgraph out["./output (bind mount)"]
        files["wards.geojson<br/>pois.geojson<br/>rent.json"]
    end

    subgraph web["web · nginx:alpine"]
        site["plan, map, drawer<br/>and chat, in the browser"]
    end

    seed --> load
    load <--> pg
    check -- "all ok" --> files
    check -- "any fail: exit 1" --> stop(["nothing written,<br/>web never starts"])
    files -- "read-only" --> web
    web --> browser(["browser"])
```

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
- **The browser does the interactive work.** The pipeline ships each ward's busyness, competition and rent tier, so changing the plan re-ranks instantly, and the chat answers from the same files with no server.
- **Offline by default.** Seed data, Leaflet and the fonts are committed. The only runtime network use is map tiles, and the map still works without them.

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
