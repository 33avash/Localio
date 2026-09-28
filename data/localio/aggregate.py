"""Roll outlets up to one row per ward.

Each outlet was placed in its ward by ST_Contains in PostGIS (db.py), never
by matching names. Formats are cafes (cafe and ice cream) and QSRs
(fast_food); restaurants count only towards all food and drink.
"""

import json
import re

import pandas as pd
from shapely.geometry import shape
from shapely.ops import polylabel

from localio import CATEGORIES


def aggregate(wards: pd.DataFrame, pois: pd.DataFrame, pcmc_places: dict[str, str], nearest_places: dict[str, str]) -> pd.DataFrame:
    """One row per ward: name, residents, area, label point and per-format counts."""
    frame = wards.copy()
    outlet_names = pois.groupby("ward")["name"].apply(lambda names: " | ".join(names).lower())
    frame["name"] = [_name(key, row, pcmc_places, nearest_places, outlet_names.get(key, ""))
                     for key, row in frame.iterrows()]
    label = frame["geojson"].map(_label_point)
    frame["label_longitude"] = label.map(lambda p: p[0])
    frame["label_latitude"] = label.map(lambda p: p[1])

    by_ward = pois.groupby("ward")
    frame["total_pois"] = by_ward.size().reindex(frame.index, fill_value=0)
    frame["restaurant_count"] = pois[pois["format"] == "restaurant"].groupby("ward").size().reindex(frame.index, fill_value=0)
    frame["chain_count"] = pois[pois["brand"] != ""].groupby("ward").size().reindex(frame.index, fill_value=0)
    hours = pois[pois["opening_hours"] != ""]
    frame["hours_known"] = hours.groupby("ward").size().reindex(frame.index, fill_value=0)
    frame["late_night_count"] = hours[hours["opening_hours"].map(late_night)].groupby("ward").size() \
        .reindex(frame.index, fill_value=0)
    for category in CATEGORIES:
        in_category = pois[pois["format"] == category].groupby("ward")
        count = in_category.size().reindex(frame.index, fill_value=0)
        chains = in_category["brand"].apply(lambda b: int((b != "").sum())).reindex(frame.index, fill_value=0)
        frame[f"{category}_count"] = count
        frame[f"{category}_chain_count"] = chains
        frame[f"{category}_independent_count"] = count - chains
    return frame


def late_night(opening_hours: str) -> bool:
    """Open past 23:00 on any day, or round the clock. OSM hours are free text,
    so anything unparseable counts as not late."""
    if "24/7" in opening_hours:
        return True
    closes = re.findall(r"-\s*(\d{1,2}):(\d{2})", opening_hours)
    return any(int(h) >= 23 or int(h) <= 4 for h, _ in closes)


def _name(key: str, row: pd.Series, pcmc_places: dict[str, str], nearest: dict[str, str], outlet_names: str) -> str:
    """PMC wards have official titles. PCMC wards don't, so they take the OSM
    place inside them that the ward's own outlets name most often ("Subway
    Wakad"), then the first suburb inside, then the nearest place."""
    if row["corporation"] == "PMC" and row["title"]:
        return row["title"]
    inside = row["aliases"]
    if inside:
        mentions = {place: outlet_names.count(place.lower()) for place in inside}
        best = max(inside, key=lambda place: (mentions[place], place == pcmc_places.get(key)))
        return f"{best} (PCMC {row['number']})"
    return f"Near {nearest[key]} (PCMC {row['number']})"


def _label_point(geojson: str) -> tuple[float, float]:
    """Pole of inaccessibility: always inside the ward, even a concave one."""
    geom = shape(json.loads(geojson))
    if geom.geom_type == "MultiPolygon":
        geom = max(geom.geoms, key=lambda part: part.area)
    point = polylabel(geom, tolerance=0.00005)
    return round(point.x, 5), round(point.y, 5)
