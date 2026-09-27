"""Build and write the files the map reads.

pois.geojson        one Point per food and drink outlet inside a ward
localities.geojson  one Polygon per ward: residents, per-format counts and
                    density classes, score components, the capacity
                    model's band and drivers, market type, similar wards,
                    menu mix and the recommendation
model_report.json   how each model was evaluated, for "How it works"

The score components ship with the file so the browser can re-weight
scores instantly. Ward boundaries derive from DataMeet's CC BY-SA data,
so localities.geojson carries that licence.
"""

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from localio import CATEGORIES
from localio.ml import Results
from localio.ml.capacity import LABELS
from localio.score import MIN_POIS_TO_SCORE


def pois_collection(pois: pd.DataFrame, menu_types: pd.Series, names: pd.Series) -> dict:
    features = [
        _point(poi["lon"], poi["lat"], {
            "id": poi["id"],
            "name": poi["name"] or None,
            "category": poi["format"],
            "ward": names[poi["ward"]],
            "brand": poi["brand"] or None,
            "menu": menu_types[index],
        })
        for index, poi in pois.iterrows()
    ]
    return {"type": "FeatureCollection", "features": features}


def localities_collection(scored: pd.DataFrame, pois: pd.DataFrame, ml: Results, menu_mix: pd.DataFrame,
                          weights: dict, density_ranges: dict, city: dict, vintage: dict) -> dict:
    features = [
        {"type": "Feature", "geometry": json.loads(row["geojson"]),
         "properties": _ward_properties(key, row, scored, ml, menu_mix)}
        for key, row in scored.iterrows()
    ]
    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "min_pois_to_score": MIN_POIS_TO_SCORE,
        "default_weights": weights,
        "category_counts": {c: int((pois["format"] == c).sum()) for c in CATEGORIES},
        "outlets": int(len(pois)),
        "density_ranges": density_ranges,
        "city": city,
        "capacity_label": ml.report["capacity"]["label"],
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


def _ward_properties(key: str, row: pd.Series, scored: pd.DataFrame, ml: Results, menu_mix: pd.DataFrame) -> dict:
    band = ml.capacity.loc[key]
    multiplier = ml.multiplier.loc[key]
    return {
        "key": key,
        "name": row["name"],
        "corporation": row["corporation"],
        "ward_number": int(row["number"]),
        "admin_zone": row["admin_zone"],
        "aliases": [a for a in row["aliases"] if a != row["name"]],
        "status": "insufficient_data" if row["low_confidence"] else "scored",
        "total_pois": int(row["total_pois"]),
        "population": int(row["population"]),
        "population_method": row["population_method"],
        "area_km2": _num(row["area_km2"], 2),
        "label_point": [row["label_longitude"], row["label_latitude"]],
        "total_per_10k": _num(row["total_per_10k"], 2),
        "total_density_class": int(row["total_density_class"]),
        "residents_per_outlet": round(row["population"] / row["total_pois"]) if row["total_pois"] else None,
        "chain_share": _num(ml.profile.at[key, "chain_share"], 3),
        "late_night_share": _num(row["late_night_count"] / row["hours_known"], 3) if row["hours_known"] else None,
        "hours_known": int(row["hours_known"]),
        "market_type": ml.archetype[key],
        "similar": [scored.at[other, "name"] for other in ml.similar[key]],
        "menu": {kind: round(float(share), 3) for kind, share in menu_mix.loc[key].items() if share > 0},
        "recommendation": row["recommendation"],
        "capacity": {
            "per_km2": [_num(band[q], 1) for q in ("p10", "p50", "p90")],
            "multiplier": [_num(multiplier[q], 2) for q in ("p10", "p50", "p90")],
            "gap": _num(ml.gap[key], 1),
            "drivers": [{**d, "label": LABELS[d["feature"]]} for d in ml.drivers[key]],
        },
        "categories": {c: _category(row, c) for c in CATEGORIES},
    }


def _category(row: pd.Series, c: str) -> dict:
    return {
        "count": int(row[f"{c}_count"]),
        "chain_count": int(row[f"{c}_chain_count"]),
        "independent_count": int(row[f"{c}_independent_count"]),
        "per_10k": _num(row[f"{c}_per_10k"], 2),
        "density_class": int(row[f"{c}_density_class"]),
        "demand_n": _num(row[f"{c}_demand_n"]),
        "supply_n": _num(row[f"{c}_supply_n"]),
        "gap_n": _num(row[f"{c}_gap_n"]),
        "score": _num(row[f"{c}_score"], 2),
    }


def _point(longitude: float, latitude: float, properties: dict) -> dict:
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [round(longitude, 6), round(latitude, 6)]},
        "properties": properties,
    }


def _num(value, digits: int = 4) -> float | None:
    if value is None or (isinstance(value, float) and math.isnan(value)) or pd.isna(value):
        return None
    return round(float(value), digits)
