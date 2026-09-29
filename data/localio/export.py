"""Build and write the files the map and the chat read.

pois.geojson   one point per food and drink outlet inside a ward
wards.geojson  one polygon per ward: residents, counts, density classes,
               the score's parts, rent tier, menu mix and a recommendation
rent.json      the rent constants and their sources

The score's parts ship with the file so the browser can re-weight scores
instantly. Ward boundaries derive from DataMeet's CC BY-SA data, so
wards.geojson carries that licence.
"""

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from localio import CATEGORIES
from localio.score import DEFAULT_PRESET, DRAWS, MIN_OUTLETS, PRECISION, PRESETS, UNMAPPED


def pois_collection(pois: pd.DataFrame, menu_types: pd.Series, names: pd.Series) -> dict:
    features = [
        _point(poi["lon"], poi["lat"], {
            "name": poi["name"] or None,
            "category": poi["format"],
            "ward": names[poi["ward"]],
            "brand": poi["brand"] or None,
            "menu": menu_types[index],
        })
        for index, poi in pois.iterrows()
    ]
    return {"type": "FeatureCollection", "features": features}


def wards_collection(scored: pd.DataFrame, pois: pd.DataFrame, menu_mix: pd.DataFrame, tiers: pd.DataFrame,
                     density_ranges: dict, reference: dict, vintage: dict) -> dict:
    features = [
        {"type": "Feature", "geometry": json.loads(row["geojson"]),
         "properties": _ward(key, row, menu_mix, tiers.loc[key])}
        for key, row in scored.iterrows()
    ]
    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "min_outlets": MIN_OUTLETS,
        "category_counts": {c: int((pois["format"] == c).sum()) for c in CATEGORIES},
        "outlets": int(len(pois)),
        "density_ranges": density_ranges,
        # The score's constants: the site and the chat read them from here.
        "score": {"presets": PRESETS, "default": DEFAULT_PRESET, "reference_per_10k": reference,
                  "unmapped": UNMAPPED},
        "vintage": vintage,
        "licence": "Ward boundaries © DataMeet, CC BY-SA 2.5 IN; outlets © OpenStreetMap contributors, ODbL",
    }
    return {"type": "FeatureCollection", "meta": meta, "features": features}


def write_json(document: dict, path: Path) -> None:
    """Write atomically and world-readable, so nginx never serves a half-written file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with tmp.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(document, f, ensure_ascii=False, indent=1)
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


def _ward(key: str, row: pd.Series, menu_mix: pd.DataFrame, tier: pd.Series) -> dict:
    return {
        "key": key,
        "name": row["name"],
        "corporation": row["corporation"],
        "ward_number": int(row["number"]),
        "aliases": [a for a in row["aliases"] if a != row["name"]],
        "status": "low_confidence" if row["low_confidence"] else "scored",
        "population": int(row["population"]),
        "population_method": row["population_method"],
        "area_km2": num(row["area_km2"], 2),
        "label_point": [row["label_longitude"], row["label_latitude"]],
        "residents_per_km2": round(row["residents_per_km2"]),
        "outlets_per_km2": num(row["outlets_per_km2"], 1),
        "draws": {d: int(row[d]) for d in DRAWS},
        "draws_per_km2": num(row["draws_per_km2"], 2),
        # Percentiles among the 140 wards, 0 to 1; room is per format below.
        "components": {name: num(row[name], PRECISION) for name in ("residents", "eating_out", "daytime")},
        "total_pois": int(row["total_pois"]),
        "total_per_10k": num(row["total_per_10k"], 2),
        "total_density_class": int(row["total_density_class"]),
        "categories": {c: {
            "count": int(row[f"{c}_count"]),
            "per_10k": num(row[f"{c}_per_10k"], 2),
            "density_class": int(row[f"{c}_density_class"]),
            "room": num(row[f"{c}_room"], PRECISION),
            # At the default preset; the browser recomputes for any weights.
            "score": num(row[f"{c}_score"], 6),
        } for c in CATEGORIES},
        "rent": {"tier": tier["rent_tier"], "multiplier": float(tier["rent_multiplier"]),
                 "estimated": bool(tier["rent_estimated"]), "streets": list(tier["rent_streets"])},
        "menu": {kind: round(float(share), 3) for kind, share in menu_mix.loc[key].items() if share > 0},
        "recommendation": row["recommendation"],
    }


def _point(longitude: float, latitude: float, properties: dict) -> dict:
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [round(longitude, 6), round(latitude, 6)]},
        "properties": properties,
    }


def num(value, digits: int = 4) -> float | None:
    if value is None or (isinstance(value, float) and math.isnan(value)) or pd.isna(value):
        return None
    return round(float(value), digits)
