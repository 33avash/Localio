"""Fetch Localio's OpenStreetMap inputs once and cache them in seed_data/.

    docker compose run --rm osm            # only fetches what isn't cached
    docker compose run --rm osm --refresh  # re-fetch everything

Writes:
  seed_data/osm_raw.json      cafes, QSRs, restaurants, bakeries and ice cream
                              inside the ward area (`out center tags`, so
                              buildings get a centre point)
  seed_data/osm_context.json  what draws people and names places: colleges,
                              offices, stations and place names

The pipeline reads only these files, so a normal build never calls Overpass.
An `area["name"="Pune"]` query matches the whole Pune district and times
out, so every query here uses the bounding box of the wards.
Overpass etiquette: one query at a time, an identifying User-Agent, and a
pause and retry when the server is busy.
"""

import argparse
import json
import sys
import time
from datetime import date
from pathlib import Path

import requests
from shapely.geometry import shape
from shapely.ops import unary_union

SEED = Path("seed_data")
WARDS = [SEED / "wards" / "pune-electoral-wards.geojson", SEED / "wards" / "pcmc-electoral-wards.geojson"]
RAW = SEED / "osm_raw.json"
CONTEXT = SEED / "osm_context.json"

OVERPASS = "https://overpass-api.de/api/interpreter"
HEADERS = {"User-Agent": "Localio/0.3 (github.com/33avash/Localio)", "Accept": "application/json"}
FOOD = "cafe|fast_food|restaurant|bakery|ice_cream"
POI_TAGS = ("amenity", "name", "brand", "cuisine", "opening_hours")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--refresh", action="store_true", help="re-fetch even if the cache exists")
    args = parser.parse_args()

    south, west, north, east = ward_bbox()
    box = f"({south:.5f},{west:.5f},{north:.5f},{east:.5f})"
    today = date.today().isoformat()

    if args.refresh or not RAW.exists():
        query = f'(node["amenity"~"^({FOOD})$"]{box};way["amenity"~"^({FOOD})$"]{box};);out center tags;'
        elements = [poi(e) for e in overpass(query)]
        write(RAW, {"meta": meta(today, query), "elements": elements})
        print(f"osm: {len(elements)} food and drink places -> {RAW}")
    else:
        print(f"osm: {RAW} is cached; use --refresh to re-fetch")

    if args.refresh or not CONTEXT.exists():
        context = {
            "meta": meta(today, f"bounding box {box}"),
            "colleges": points(f'nwr["amenity"~"^(college|university)$"]{box};out center tags;'),
            "offices": points(f'nwr["office"]{box};out center tags;'),
            "stations": points(f'(nwr["railway"~"^(station|halt)$"]{box};nwr["station"="subway"]{box};'
                               f'nwr["amenity"="bus_station"]{box};);out center tags;'),
            "places": points(f'node["place"~"^(suburb|quarter|neighbourhood)$"]{box};out;', keep_place=True),
        }
        write(CONTEXT, context)
        print(f"osm: context -> {CONTEXT} ("
              + ", ".join(f"{len(v)} {k}" for k, v in context.items() if isinstance(v, list)) + ")")
    else:
        print(f"osm: {CONTEXT} is cached; use --refresh to re-fetch")
    return 0


def ward_bbox() -> tuple[float, float, float, float]:
    shapes = [shape(f["geometry"]) for path in WARDS for f in json.loads(path.read_text())["features"]]
    west, south, east, north = unary_union(shapes).bounds
    return south, west, north, east


def overpass(query: str, attempts: int = 5) -> list[dict]:
    body = f"[out:json][timeout:170];{query}"
    for attempt in range(1, attempts + 1):
        try:
            response = requests.post(OVERPASS, data={"data": body}, headers=HEADERS, timeout=200)
            if response.status_code == 200:
                time.sleep(5)
                return response.json()["elements"]
            reason = f"HTTP {response.status_code}"
        except (requests.RequestException, ValueError) as err:
            reason = str(err)
        wait = 30 * attempt
        print(f"osm: Overpass busy ({reason}); retry {attempt}/{attempts} in {wait}s", file=sys.stderr)
        time.sleep(wait)
    raise SystemExit("osm: Overpass didn't answer; try again later")


def centre(element: dict) -> tuple[float, float]:
    if "center" in element:
        return element["center"]["lon"], element["center"]["lat"]
    return element["lon"], element["lat"]


def poi(element: dict) -> dict:
    lon, lat = centre(element)
    tags = {k: v for k, v in element.get("tags", {}).items() if k in POI_TAGS}
    return {"id": f"{element['type']}/{element['id']}", "lon": round(lon, 6), "lat": round(lat, 6), "tags": tags}


def points(query: str, keep_place: bool = False) -> list[list]:
    out = []
    for element in overpass(query):
        lon, lat = centre(element)
        row = [round(lon, 6), round(lat, 6), element.get("tags", {}).get("name", "")]
        if keep_place:
            row.append(element["tags"].get("place", ""))
        out.append(row)
    return out


def meta(today: str, query: str) -> dict:
    return {"source": "OpenStreetMap contributors via the Overpass API", "licence": "ODbL 1.0",
            "retrieved": today, "query": query}


def write(path: Path, document: dict) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(document, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")


if __name__ == "__main__":
    sys.exit(main())
