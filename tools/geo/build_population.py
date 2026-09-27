"""Estimate residents per ward and write seed_data/ward_population.csv.

    docker compose run --rm population

DataMeet's wards carry no Census population, and the Census 2011 ward
tables use an older delimitation that doesn't line up with the 2012
wards. So each ward's population is its share of its corporation's
Census 2011 total, where the share comes from:

  PMC   the 2012 electoral roll (voters per ward, pune-wards-info.csv).
        Ward 42 has no voter count and gets the PMC mean.
  PCMC  an equal share. There's no electoral roll for PCMC wards, and
        electoral wards are drawn to hold roughly equal populations
        (PMC's own rolls run 25k-53k voters per ward).

Meta's High Resolution Settlement Layer (HRSL, 30 m, CC BY 4.0) was tried
as the PCMC source and as a check on the voter shares, and failed both:
it correlates with PMC's voter rolls at r = 0.18, gives dense Kothrud
wards a quarter of their voters, and would put one PCMC ward at 134k
people. Its per-ward sum is still written out (hrsl_people) so the
pipeline can report that comparison.
"""

import csv
import json
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.windows import from_bounds
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

SEED = Path("seed_data")
HRSL = (
    "/vsicurl/https://dataforgood-fb-data.s3.amazonaws.com/hrsl-cogs/hrsl_general/v1.5/"
    "cog_globallat_10_lon_70_general-v1.5.2.tif"
)
# Census of India 2011, Primary Census Abstract, municipal corporation totals.
CENSUS_2011 = {"PMC": 3_124_458, "PCMC": 1_727_692}
OUTPUT = SEED / "ward_population.csv"


def main() -> int:
    wards = {
        "PMC": _features(SEED / "wards" / "pune-electoral-wards.geojson"),
        "PCMC": _features(SEED / "wards" / "pcmc-electoral-wards.geojson"),
    }
    hrsl = _hrsl({(corp, ward): geom for corp, features in wards.items() for ward, geom in features.items()})
    voters = _voters()

    rows = []
    rows += _pmc(wards["PMC"], hrsl, voters)
    rows += _pcmc(wards["PCMC"], hrsl)
    with OUTPUT.open("w", encoding="utf-8", newline="\n") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    for corp in CENSUS_2011:
        ours = [r for r in rows if r["corporation"] == corp]
        print(f"population: {corp} {len(ours)} wards, {sum(r['population'] for r in ours):,} people, "
              f"largest {max(r['population'] for r in ours):,} (HRSL raw total {sum(r['hrsl_people'] for r in ours):,})")
    return 0


def _pmc(features, hrsl, voters) -> list[dict]:
    mean_voters = round(sum(voters[w] for w in features if w in voters) / sum(w in voters for w in features))
    counts = {ward: voters.get(ward, mean_voters) for ward in features}
    scale = CENSUS_2011["PMC"] / sum(counts.values())
    return [{
        "corporation": "PMC",
        "wardnum": ward,
        "voters_2012": voters.get(ward, ""),
        "hrsl_people": round(hrsl[("PMC", ward)]),
        "population": round(count * scale),
        "method": "2012 voters scaled to Census 2011" if ward in voters
                  else "PMC mean voters scaled to Census 2011 (no voter count)",
    } for ward, count in sorted(counts.items())]


def _pcmc(features, hrsl) -> list[dict]:
    share = CENSUS_2011["PCMC"] / len(features)
    return [{
        "corporation": "PCMC",
        "wardnum": ward,
        "voters_2012": "",
        "hrsl_people": round(hrsl[("PCMC", ward)]),
        "population": round(share),
        "method": "equal share of Census 2011 (no voter roll)",
    } for ward in sorted(features)]


def _hrsl(shapes: dict) -> dict:
    west, south, east, north = unary_union(list(shapes.values())).bounds
    with rasterio.open(HRSL) as src:
        window = from_bounds(west, south, east, north, src.transform).round_offsets().round_lengths()
        people = np.nan_to_num(src.read(1, window=window))
        grid = src.window_transform(window)
    return {key: float(people[geometry_mask([mapping(geom)], out_shape=people.shape, transform=grid, invert=True)].sum())
            for key, geom in shapes.items()}


def _voters() -> dict[int, int]:
    with (SEED / "wards" / "pune-wards-info.csv").open(encoding="utf-8") as f:
        return {int(r["wardnum"]): int(r["voters"]) for r in csv.DictReader(f)
                if r["wardnum"].strip() and r["voters"].strip().isdigit()}


def _features(path: Path) -> dict:
    """Ward geometries by ward number. PCMC stores wards 58 and 64 in two
    parts ("58_1", "58_2"); the parts are merged into one ward."""
    parts: dict[int, list] = {}
    for f in json.loads(path.read_text(encoding="utf-8"))["features"]:
        ward = int(str(f["properties"]["wardnum"]).split("_")[0])
        parts.setdefault(ward, []).append(shape(f["geometry"]).buffer(0))
    return {ward: unary_union(geoms) for ward, geoms in parts.items()}


if __name__ == "__main__":
    sys.exit(main())
