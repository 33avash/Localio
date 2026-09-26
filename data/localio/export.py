"""Build and write the files the map reads.

pois.geojson        one Point per POI, with its menu type
localities.geojson  one Polygon per locality catchment: per-format stats,
                    density classes, normalized score components, the
                    footfall model's estimate, market type and the
                    recommendation sentence
model_report.json   how each model was evaluated, for the Method view

The normalized components ship with the file so the browser can re-weight
scores instantly without a round trip.
"""

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from localio import CATEGORIES
from localio.ml import Results
from localio.ml.features import LABELS
from localio.score import MIN_POIS_TO_SCORE


def pois_collection(pois: pd.DataFrame, menu_types: pd.Series) -> dict:
    features = [
        _point(poi["longitude"], poi["latitude"], {
            "id": poi["poi_id"],
            "name": _text(poi["name"]),
            "category": poi["category"],
            "locality": poi["locality"],
            "avg_rating": _num(poi["avg_rating"], 1),
            "review_count": int(poi["review_count"]),
            "is_chain": bool(poi["is_chain_outlet"]),
            "menu": menu_types[index],
        })
        for index, poi in pois.iterrows()
    ]
    return {"type": "FeatureCollection", "features": features}


def localities_collection(scored: pd.DataFrame, pois: pd.DataFrame, ml: Results, menu_mix: pd.DataFrame,
                          weights: dict, density_ranges: dict, city: dict) -> dict:
    features = [
        {"type": "Feature", "geometry": row["geometry"], "properties": _locality_properties(name, row, ml, menu_mix)}
        for name, row in scored.iterrows()
    ]
    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "min_pois_to_score": MIN_POIS_TO_SCORE,
        "default_weights": weights,
        "category_counts": {c: int((pois["category"] == c).sum()) for c in CATEGORIES},
        "density_ranges": density_ranges,
        "city": city,
        "demand_source": ml.report["footfall"]["demand_source"],
    }
    return {"type": "FeatureCollection", "meta": meta, "features": features}


def write_json(document: dict, path: Path) -> None:
    """Write atomically and world-readable, so nginx never serves a half-written file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with tmp.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(document, f, ensure_ascii=False, indent=2)
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


def _locality_properties(name: str, row: pd.Series, ml: Results, menu_mix: pd.DataFrame) -> dict:
    categories = {c: _category(name, row, c, ml) for c in CATEGORIES}
    shares = menu_mix.loc[name]
    return {
        "name": name,
        "status": "insufficient_data" if row["low_confidence"] else "scored",
        "total_pois": int(row["total_pois"]),
        "total_reviews": int(row["total_reviews"]),
        "population": int(row["population"]),
        "area_km2": _num(row["area_km2"], 2),
        "label_point": [_num(row["label_longitude"], 5), _num(row["label_latitude"], 5)],
        "total_per_10k": _num(row["total_per_10k"], 2),
        "total_density_class": int(row["total_density_class"]),
        "residents_per_outlet": round(row["population"] / row["total_pois"]),
        "chain_share": _num(ml.profile.at[name, "chain_share"], 3),
        "late_night_share": _num(ml.profile.at[name, "late_night_share"], 3),
        "market_type": ml.archetype[name],
        "similar": ml.similar[name],
        "menu": {kind: round(float(share), 3) for kind, share in shares.items() if share > 0},
        "recommendation": row["recommendation"],
        "categories": categories,
    }


def _category(name: str, row: pd.Series, c: str, ml: Results) -> dict:
    stats = {
        "count": int(row[f"{c}_count"]),
        "avg_rating": _num(row[f"{c}_avg_rating"], 2),
        "chain_count": int(row[f"{c}_chain_count"]),
        "independent_count": int(row[f"{c}_independent_count"]),
        "per_10k": _num(row[f"{c}_per_10k"], 2),
        "density_class": int(row[f"{c}_density_class"]),
        "demand_n": _num(row[f"{c}_demand_n"]),
        "supply_n": _num(row[f"{c}_supply_n"]),
        "weakness_n": _num(row[f"{c}_weakness_n"]),
        "score": _num(row[f"{c}_score"], 2),
    }
    if c in ml.footfall:
        estimate = ml.footfall[c].loc[name]
        stats["footfall"] = {
            "reviews": _reviews(estimate["log"]),
            "low": _reviews(estimate["low"]),
            "high": _reviews(estimate["high"]),
            "drivers": [{**d, "label": LABELS[d["feature"]]} for d in ml.drivers[c][name]],
        }
    return stats


def _reviews(log_value: float) -> int:
    """Back from log(1 + reviews) to a whole review count."""
    return max(0, round(math.expm1(log_value)))


def _point(longitude: float, latitude: float, properties: dict) -> dict:
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [round(longitude, 6), round(latitude, 6)]},
        "properties": properties,
    }


def _num(value, digits: int = 4) -> float | None:
    return None if pd.isna(value) else round(float(value), digits)


def _text(value) -> str | None:
    return None if pd.isna(value) else str(value)
