# Seed data

Every input the pipeline reads. All of it is committed, so a build never needs the network.

| File | What it is | Where it comes from |
|---|---|---|
| `wards/` | 76 PMC and 64 PCMC ward boundaries (2012), PMC ward titles and voter rolls | [DataMeet](https://github.com/datameet/Pune_wards); see [wards/README.md](wards/README.md) |
| `ward_population.csv` | residents per ward | `docker compose run --rm population` |
| `osm_raw.json` | 1,979 food and drink places in the wards' bounding box | `docker compose run --rm osm` |
| `osm_context.json` | colleges, offices, stations and place names | `docker compose run --rm osm` |
| `rent_high_streets.csv` | prime rents for ten Pune high streets, their tier and the wards they run through | Cushman & Wakefield Pune Retail MarketBeat, Q2 2026 |
| `rent_listings.csv` | 25 Pune shop listings, for the typical rent per sq ft | Square Yards, first page of Pune shop listings, 28 Sep 2026 |
| `rent_benchmarks.csv` | default shop size, healthy rent share, and the emerging-tier multiplier | DineOpen; the multiplier is marked as an assumption |

## How residents per ward are built

DataMeet's wards carry no Census population, and the Census 2011 ward tables use older boundaries. So each ward gets a share of its corporation's Census 2011 total:

- **PMC** (3,124,458 people): shared by the 2012 voter roll. Ward 42 has no voter count and gets the PMC average.
- **PCMC** (1,727,692 people): shared equally. There's no voter roll, and electoral wards are drawn to hold similar numbers of people.

The `hrsl_people` column is Meta's HRSL population estimate for each ward. It was tried and rejected as a source (it agrees poorly with the voter rolls), and is kept only for comparison.

## Refreshing the data

The tools need network access and overwrite files here. The pipeline then uses the new files on its next run.

```
docker compose run --rm osm --refresh     # re-fetch from OpenStreetMap
docker compose run --rm population        # rebuild residents per ward
```
