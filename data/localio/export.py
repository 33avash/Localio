"""Build and write the two GeoJSON files the map reads.

pois.geojson        one Point per POI
localities.geojson  one Polygon per locality catchment, with per-category
                    stats, density classes, normalized score components
                    and default scores

The normalized components ship with the file so the browser can re-weight
scores instantly without a round trip.
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from localio import CATEGORIES
from localio.score import MIN_POIS_TO_SCORE

TIERS = ("low", "medium", "high")


def pois_collection(pois: pd.DataFrame) -> dict:
    features = [
        _point(poi["longitude"], poi["latitude"], {
            "id": poi["poi_id"],
            "name": _text(poi["name"]),
            "category": poi["category"],
            "locality": poi["locality"],
            "avg_rating": _num(poi["avg_rating"], 1),
            "review_count": int(poi["review_count"]),
            "is_chain": bool(poi["is_chain_outlet"]),
        })
        for poi in pois.to_dict("records")
    ]
    return {"type": "FeatureCollection", "features": features}


def localities_collection(scored: pd.DataFrame, pois: pd.DataFrame, weights: dict, density_ranges: dict) -> dict:
    features = [
        {"type": "Feature", "geometry": row["geometry"], "properties": _locality_properties(name, row)}
        for name, row in scored.iterrows()
    ]
    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "min_pois_to_score": MIN_POIS_TO_SCORE,
        "default_weights": weights,
        "category_counts": {c: int((pois["category"] == c).sum()) for c in CATEGORIES},
        "saturation_ranges": {c: _tier_ranges(scored, c) for c in CATEGORIES},
        "density_ranges": density_ranges,
    }
    return {"type": "FeatureCollection", "meta": meta, "features": features}


def write_geojson(collection: dict, path: Path) -> None:
    """Write atomically and world-readable, so nginx never serves a half-written file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with tmp.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(collection, f, ensure_ascii=False, indent=2)
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


def _locality_properties(name: str, row: pd.Series) -> dict:
    categories = {
        c: {
            "count": int(row[f"{c}_count"]),
            "avg_rating": _num(row[f"{c}_avg_rating"], 2),
            "chain_count": int(row[f"{c}_chain_count"]),
            "independent_count": int(row[f"{c}_independent_count"]),
            "saturation": row[f"{c}_saturation"],
            "per_10k": _num(row[f"{c}_per_10k"], 2),
            "density_class": int(row[f"{c}_density_class"]),
            "supply_n": _num(row[f"{c}_supply_n"]),
            "weakness_n": _num(row[f"{c}_weakness_n"]),
            "score": _num(row[f"{c}_score"], 2),
        }
        for c in CATEGORIES
    }
    return {
        "name": name,
        "status": "scored" if row["scored"] else "insufficient_data",
        "total_pois": int(row["total_pois"]),
        "total_reviews": int(row["total_reviews"]),
        "population": int(row["population"]),
        "area_km2": _num(row["area_km2"], 2),
        "label_point": [_num(row["label_longitude"], 5), _num(row["label_latitude"], 5)],
        "total_per_10k": _num(row["total_per_10k"], 2),
        "total_density_class": int(row["total_density_class"]),
        "demand_n": _num(row["demand_n"]),
        "categories": categories,
    }


def _tier_ranges(scored: pd.DataFrame, category: str) -> dict:
    """Actual count range per tier, e.g. {"low": [1, 3]}, for the map legend."""
    counts = scored.groupby(f"{category}_saturation")[f"{category}_count"].agg(["min", "max"])
    return {t: [int(counts.at[t, "min"]), int(counts.at[t, "max"])] for t in TIERS if t in counts.index}


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
