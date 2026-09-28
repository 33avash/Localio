"""Attach each locality's catchment: population, area and a label point.

seed_data/catchments.geojson is built once by tools/catchments, which needs
network access, and is committed. This step only reads that local file.
"""

import json
from pathlib import Path

import pandas as pd


class CatchmentError(Exception):
    """The catchments file is missing or unreadable."""


def load_catchments(path: Path) -> dict[str, dict]:
    """Catchment features keyed by locality name."""
    if not path.is_file():
        raise CatchmentError(f"catchments file not found: {path} (build it with: docker compose run --rm catchments)")
    try:
        features = json.loads(path.read_text(encoding="utf-8"))["features"]
    except (ValueError, KeyError) as err:
        raise CatchmentError(f"{path} is not a catchments GeoJSON file: {err}") from err
    return {feature["properties"]["name"]: feature for feature in features}


def attach(localities: pd.DataFrame, catchments: dict[str, dict]) -> pd.DataFrame:
    """Add population, area_km2, label point and geometry columns. Unmatched localities get NaN."""
    joined = localities.copy()
    features = [catchments.get(name) for name in joined.index]
    matched = [feature["properties"] if feature else {} for feature in features]
    joined["geometry"] = [feature["geometry"] if feature else None for feature in features]
    joined["population"] = [c.get("population") for c in matched]
    joined["area_km2"] = [c.get("area_km2") for c in matched]
    joined["label_longitude"] = [c["label_point"][0] if c else None for c in matched]
    joined["label_latitude"] = [c["label_point"][1] if c else None for c in matched]
    for col in ("population", "area_km2", "label_longitude", "label_latitude"):
        joined[col] = pd.to_numeric(joined[col])
    return joined
