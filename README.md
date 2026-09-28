# Localio

Localio turns open location data into site-selection decisions.

It reads where Pune's cafes and quick-service restaurants (QSRs) already are, cross-references how much food-and-beverage demand each locality actually generates, and surfaces the gaps: places with proven footfall but thin competition in your category.

It answers one question, end to end: **"I want to open a cafe (or QSR) in Pune. Where should I look?"**

This is not a general-purpose map dashboard. Every screen moves you toward a ranked, justified shortlist of localities.

## Run it

_Filled in once the containers exist._

## How it works

Two containers, run with Docker Compose:

- `data/` reads the seed file, cleans it, aggregates by locality, scores each locality and writes GeoJSON to `./output/`. It then exits.
- `web/` is nginx serving the map and the files in `./output/`.

## The opportunity score

_Filled in with the scoring code._

## Data

`seed_data/pune_cafes_qsr.csv` has 260 cafes and QSRs across 51 Pune localities, collected via the Google Places API on 2026-09-18.

## License

MIT. See [LICENSE](LICENSE).
