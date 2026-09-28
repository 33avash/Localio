"""Read Localio's committed inputs from seed_data/. Nothing here goes online.

wards/*.geojson          140 electoral wards: PMC 76 and PCMC 64 (DataMeet, 2012)
wards/*.csv              PMC ward titles and admin zones
ward_population.csv      residents per ward, built by tools/geo/build_population.py
osm_raw.json             food and drink places from OpenStreetMap
osm_context.json         colleges, offices, stations and place names (OpenStreetMap)
rent_high_streets.csv    published prime rents for ten Pune high streets
rent_listings.csv        a sample of Pune shop listings, for typical rent
rent_benchmarks.csv      outlet size and healthy rent share, with sources
"""

import csv
import json
from dataclasses import dataclass
from pathlib import Path

from shapely.geometry import shape
from shapely.ops import unary_union

# OSM amenity -> Localio format. Ice cream parlours and bakeries sit with
# cafes; restaurants count only towards all food and drink.
FORMATS = {"cafe": "cafe", "ice_cream": "cafe", "bakery": "cafe", "fast_food": "fast_food", "restaurant": "restaurant"}


class SourceError(Exception):
    """A seed file is missing or unreadable."""


@dataclass(frozen=True)
class Ward:
    key: str
    corporation: str
    number: int
    title: str
    admin_zone: str
    population: int
    population_method: str
    geometry: object


def load_wards(seed: Path) -> list[Ward]:
    info = _pmc_info(seed / "wards" / "pune-wards-info.csv")
    population = _population(seed / "ward_population.csv")
    wards = []
    for corporation, filename in (("PMC", "pune-electoral-wards.geojson"), ("PCMC", "pcmc-electoral-wards.geojson")):
        parts: dict[int, list] = {}
        zones: dict[int, str] = {}
        for feature in _json(seed / "wards" / filename)["features"]:
            props = feature["properties"]
            # PCMC stores wards 58 and 64 in two parts ("58_1", "58_2").
            number = int(str(props["wardnum"]).split("_")[0])
            parts.setdefault(number, []).append(shape(feature["geometry"]).buffer(0))
            zones[number] = props.get("zone", "")
        for number, geoms in sorted(parts.items()):
            people = population.get((corporation, number))
            if people is None:
                raise SourceError(f"ward_population.csv has no row for {corporation} ward {number}")
            title, admin = info.get(number, ("", "")) if corporation == "PMC" else ("", f"Zone {zones[number]}")
            wards.append(Ward(f"{corporation}-{number:02d}", corporation, number, title, admin,
                              people["population"], people["method"], unary_union(geoms)))
    return wards


def load_pois(seed: Path) -> tuple[list[dict], dict]:
    raw = _json(seed / "osm_raw.json")
    pois = []
    for element in raw["elements"]:
        tags = element["tags"]
        pois.append({
            "id": element["id"],
            "amenity": tags.get("amenity", ""),
            "format": FORMATS.get(tags.get("amenity", ""), ""),
            "name": tags.get("name", ""),
            "brand": tags.get("brand", ""),
            "cuisine": tags.get("cuisine", ""),
            "lon": element["lon"],
            "lat": element["lat"],
        })
    return pois, raw["meta"]


def load_context(seed: Path) -> dict:
    return _json(seed / "osm_context.json")


def load_csv(path: Path) -> list[dict]:
    if not path.is_file():
        raise SourceError(f"{path} not found")
    with path.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _pmc_info(path: Path) -> dict[int, tuple[str, str]]:
    with path.open(encoding="utf-8") as f:
        return {int(r["wardnum"]): (r["title"].strip(), r["adminward"].strip()) for r in csv.DictReader(f) if r["wardnum"].strip()}


def _population(path: Path) -> dict:
    if not path.is_file():
        raise SourceError(f"{path} not found (build it with: docker compose run --rm population)")
    with path.open(encoding="utf-8") as f:
        return {(r["corporation"], int(r["wardnum"])): {"population": int(r["population"]), "method": r["method"]}
                for r in csv.DictReader(f)}


def _json(path: Path) -> dict:
    if not path.is_file():
        raise SourceError(f"{path} not found (fetch it with: docker compose run --rm osm)")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except ValueError as err:
        raise SourceError(f"{path} is not valid JSON: {err}") from err
