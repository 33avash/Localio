"""Roll outlets up to one row per ward: its name, label point and counts.

Each outlet was placed in its ward by ST_Contains in PostGIS (db.py), never
by matching names.
"""

import json

import pandas as pd
from shapely.geometry import shape
from shapely.ops import polylabel

from localio import CATEGORIES


def aggregate(wards: pd.DataFrame, pois: pd.DataFrame, suburbs: dict[str, str], nearest: dict[str, str]) -> pd.DataFrame:
    frame = wards.copy()
    outlet_names = pois.groupby("ward")["name"].apply(lambda names: " | ".join(names).lower())
    frame["name"] = [_name(key, row, suburbs, nearest, outlet_names.get(key, "")) for key, row in frame.iterrows()]
    label = frame["geojson"].map(_label_point)
    frame["label_longitude"] = label.map(lambda p: p[0])
    frame["label_latitude"] = label.map(lambda p: p[1])
    frame["total_pois"] = pois.groupby("ward").size().reindex(frame.index, fill_value=0)
    for category in CATEGORIES:
        frame[f"{category}_count"] = pois[pois["format"] == category].groupby("ward").size() \
            .reindex(frame.index, fill_value=0)
    return frame


def _name(key: str, row: pd.Series, suburbs: dict[str, str], nearest: dict[str, str], outlet_names: str) -> str:
    """PMC wards have official titles. PCMC wards don't, so they take the OSM
    place inside them that their own outlets name most often ("Subway
    Wakad"), then the ward's main suburb, then the nearest place."""
    if row["corporation"] == "PMC" and row["title"]:
        return row["title"]
    inside = row["aliases"]
    if inside:
        mentions = {place: outlet_names.count(place.lower()) for place in inside}
        best = max(inside, key=lambda place: (mentions[place], place == suburbs.get(key)))
        return f"{best} (PCMC {row['number']})"
    return f"Near {nearest[key]} (PCMC {row['number']})"


def _label_point(geojson: str) -> tuple[float, float]:
    """Pole of inaccessibility: always inside the ward, even a concave one."""
    geom = shape(json.loads(geojson))
    if geom.geom_type == "MultiPolygon":
        geom = max(geom.geoms, key=lambda part: part.area)
    point = polylabel(geom, tolerance=0.00005)
    return round(point.x, 5), round(point.y, 5)
