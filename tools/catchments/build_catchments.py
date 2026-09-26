"""Build seed_data/catchments.geojson: one polygon per locality, with population.

Run it with `docker compose run --rm catchments`. It needs network access,
so its output is committed and the normal pipeline never goes online.

A catchment is the land closer to this locality's centre than to any other
locality's (its Voronoi cell), cut back to within 2 km of the locality's own
outlets so edge localities don't claim farmland. OpenStreetMap has no PMC or
PCMC boundary relation (checked September 2026), so distance to outlets
stands in for city limits.

Population is summed from Meta's High Resolution Settlement Layer (v1.5.2,
30 m cells, CC BY 4.0), reading only the Pune window of the tile over HTTP.
"""

import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.features import geometry_mask
from rasterio.windows import from_bounds
from shapely import MultiPoint, Point, voronoi_polygons
from shapely.geometry import mapping
from shapely.ops import polylabel, transform, unary_union

from localio.aggregate import aggregate
from localio.clean import clean
from localio.load import load_table

SEED = Path("seed_data/pune_cafes_qsr.csv")
OUTPUT = Path("seed_data/catchments.geojson")
HRSL = (
    "/vsicurl/https://dataforgood-fb-data.s3.amazonaws.com/hrsl-cogs/hrsl_general/v1.5/"
    "cog_globallat_10_lon_70_general-v1.5.2.tif"
)
REACH_M = 2000
UTM_43N = "EPSG:32643"

to_utm = Transformer.from_crs("EPSG:4326", UTM_43N, always_xy=True).transform
to_wgs84 = Transformer.from_crs(UTM_43N, "EPSG:4326", always_xy=True).transform


def main() -> int:
    pois, _ = clean(load_table(SEED))
    localities = aggregate(pois)

    centres = {name: Point(to_utm(row.longitude, row.latitude)) for name, row in localities.iterrows()}
    cells = _voronoi_cells(centres)
    catchments = {}
    for name, cell in cells.items():
        own = pois[pois["locality"] == name]
        outlets = MultiPoint([to_utm(lon, lat) for lon, lat in zip(own["longitude"], own["latitude"])])
        catchments[name] = cell.intersection(outlets.convex_hull.buffer(REACH_M))

    populations = _population(catchments)
    features = [_feature(name, shape_utm, populations[name]) for name, shape_utm in catchments.items()]

    empty = [f["properties"]["name"] for f in features if f["properties"]["population"] <= 0]
    if empty:
        print(f"catchments: no population found for {', '.join(empty)}", file=sys.stderr)
        return 1

    collection = {
        "type": "FeatureCollection",
        "meta": {
            "built_on": date.today().isoformat(),
            "reach_m": REACH_M,
            "population_source": "Meta High Resolution Settlement Layer v1.5.2 (CC BY 4.0)",
        },
        "features": features,
    }
    with OUTPUT.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(collection, f, ensure_ascii=False, indent=1)
        f.write("\n")

    total = sum(populations.values())
    areas = [f["properties"]["area_km2"] for f in features]
    print(f"catchments: {len(features)} localities, {total:,.0f} people, "
          f"{min(areas):.1f}-{max(areas):.1f} km2 each -> {OUTPUT}")
    return 0


def _voronoi_cells(centres: dict) -> dict:
    """Map each locality to the Voronoi cell containing its centre."""
    points = MultiPoint(list(centres.values()))
    cells = list(voronoi_polygons(points, extend_to=points.envelope.buffer(20_000)).geoms)
    return {name: next(cell for cell in cells if cell.contains(centre)) for name, centre in centres.items()}


def _population(catchments: dict) -> dict:
    """Sum HRSL people inside each catchment, reading one window for all of them."""
    shapes = {name: transform(to_wgs84, geom) for name, geom in catchments.items()}
    west, south, east, north = unary_union(list(shapes.values())).bounds
    with rasterio.open(HRSL) as src:
        window = from_bounds(west, south, east, north, src.transform).round_offsets().round_lengths()
        people = np.nan_to_num(src.read(1, window=window))
        window_transform = src.window_transform(window)
    totals = {}
    for name, geom in shapes.items():
        inside = geometry_mask([mapping(geom)], out_shape=people.shape, transform=window_transform, invert=True)
        totals[name] = float(people[inside].sum())
    return totals


def _feature(name: str, geom_utm, population: float) -> dict:
    label = transform(to_wgs84, polylabel(geom_utm, tolerance=10))
    area_km2 = geom_utm.area / 1e6
    outline = transform(to_wgs84, geom_utm.simplify(15))
    return {
        "type": "Feature",
        "geometry": _rounded(mapping(outline)),
        "properties": {
            "name": name,
            "population": round(population),
            "area_km2": round(area_km2, 2),
            "label_point": [round(label.x, 5), round(label.y, 5)],
        },
    }


def _rounded(geometry: dict) -> dict:
    """Five decimal places is about 1 m, plenty for a catchment edge."""
    def walk(coords):
        if isinstance(coords[0], (int, float)):
            return [round(coords[0], 5), round(coords[1], 5)]
        return [walk(c) for c in coords]
    return {"type": geometry["type"], "coordinates": walk(geometry["coordinates"])}


if __name__ == "__main__":
    sys.exit(main())
