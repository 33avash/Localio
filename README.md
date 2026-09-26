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

Each locality also gets a **saturation tier** per category: none, low, medium or high. The cut points are the 40th and 75th percentiles of non-zero counts, worked out separately for cafes and QSRs. For cafes that comes to 1–3 low, 4–7 medium and 8+ high. QSRs are sparser: 1 low, 2–3 medium, 4+ high.

### Why localities, not grid cells

The seed data has a `grid_cell_id` column, and a grid looks like the natural unit for a density map. We don't use it. There are about 1.5 POIs per cell, so a cell with 2 cafes and a cell with 0 differ by chance, not by market. Localities hold 0–12 POIs per category. That's enough to tell a crowded area from an empty one, and it matches how people actually talk about where to open ("Baner", not "cell G3707_14779").

### Why demand is log-scaled

Deccan Gymkhana has 121,097 reviews across its outlets. The next highest, Koregaon Park, has 42,736. On a linear scale Deccan Gymkhana would take the top of the range and push every other locality toward zero, so demand would stop separating anything except one outlier. `log10(1 + reviews)` keeps the order but compresses the gap, and the middle of the pack stays readable.

### Checking the numbers

A wrong aggregation still draws a map that looks perfectly fine. So the pipeline checks its own output against known figures before writing anything: 259 POIs, 51 localities, 165 cafes and 94 QSRs, 23 scored localities, and the top three for each category. If any check fails it exits with an error and writes nothing. The expected values live in [data/localio/validate.py](data/localio/validate.py); update them if you swap in a different dataset.

## Data

`seed_data/pune_cafes_qsr.csv` has 260 cafes and QSRs across 51 Pune localities, collected via the Google Places API on 2026-09-18.

It was exported once from the original spreadsheet so that changes show up in diffs. Excel date serials became ISO dates and day-fraction times became `HH:MM`; no values were altered. The pipeline still reads `.xlsx` directly if you point it at one.

One row in the source is blank, and the pipeline drops it and logs why. That leaves 259 POIs: 165 cafes and 94 QSRs.

## License

MIT. See [LICENSE](LICENSE).
