"""Features for the footfall model, per outlet and per locality.

The model learns from existing outlets and is then asked about a new one
in each locality, so both sides are built by the same code. Neighbourhood
features never count the outlet they describe.
"""

import numpy as np
import pandas as pd
from sklearn.neighbors import BallTree

CITY_CENTRE = (18.5204, 73.8567)
EARTH_RADIUS_M = 6_371_000

FEATURES = (
    "is_qsr",
    "chain",
    "price_level",
    "open_hours",
    "late_night",
    "km_from_centre",
    "log_residents_per_km2",
    "outlets_within_500m",
    "outlets_within_1km",
    "neighbour_log_reviews",
)

# In words, for the Method view and the drawer's "what drives this".
LABELS = {
    "is_qsr": "being a QSR rather than a cafe",
    "chain": "being part of a chain",
    "price_level": "price level",
    "open_hours": "hours open per day",
    "late_night": "staying open late",
    "km_from_centre": "distance from the city centre",
    "log_residents_per_km2": "residents per km² in the catchment",
    "outlets_within_500m": "cafes and QSRs within 500 m",
    "outlets_within_1km": "cafes and QSRs within 1 km",
    "neighbour_log_reviews": "how reviewed nearby outlets are",
}


# How a place feature reads when it's above or below the average outlet's.
PHRASES = {
    "km_from_centre": ("being far from the city centre", "being close to the city centre"),
    "log_residents_per_km2": ("a densely populated catchment", "a thinly populated catchment"),
    "outlets_within_500m": ("many outlets within 500 m", "few outlets within 500 m"),
    "outlets_within_1km": ("many cafes and QSRs within 1 km", "few cafes and QSRs within 1 km"),
    "neighbour_log_reviews": ("well-reviewed neighbours", "little-reviewed neighbours"),
}


def target(pois: pd.DataFrame) -> np.ndarray:
    """log(1 + reviews): review counts span 2 to 60,000, so the log is what's comparable."""
    return np.log1p(pois["review_count"].to_numpy(dtype=float))


def outlet_features(pois: pd.DataFrame, localities: pd.DataFrame) -> pd.DataFrame:
    """One row per existing outlet. Neighbour features exclude the outlet itself."""
    tree, reviews = _outlet_index(pois)
    points = _radians(pois["latitude"], pois["longitude"])
    counts_500 = _neighbour_counts(tree, points, 500, exclude_self=True)
    counts_1k, medians = _neighbour_reviews(tree, reviews, points, exclude_self=True)
    density = pois["locality"].map(_residents_per_km2(localities))
    return pd.DataFrame({
        "is_qsr": (pois["category"] == "fast_food").astype(float),
        "chain": pois["is_chain_outlet"].astype(float),
        "price_level": pois["price_level"],
        "open_hours": pois["daily_open_hours"],
        "late_night": pois["is_late_night"],
        "km_from_centre": _km_from_centre(pois["latitude"], pois["longitude"]),
        "log_residents_per_km2": np.log1p(density),
        "outlets_within_500m": counts_500,
        "outlets_within_1km": counts_1k,
        "neighbour_log_reviews": medians,
    }, index=pois.index)


def new_outlet_features(localities: pd.DataFrame, pois: pd.DataFrame, category: str, standard: dict) -> pd.DataFrame:
    """One row per locality: a standard new outlet of this format at the centre of its outlets."""
    tree, reviews = _outlet_index(pois)
    points = _radians(localities["latitude"], localities["longitude"])
    counts_1k, medians = _neighbour_reviews(tree, reviews, points, exclude_self=False)
    return pd.DataFrame({
        "is_qsr": float(category == "fast_food"),
        "chain": 0.0,
        "price_level": standard["price_level"],
        "open_hours": standard["open_hours"],
        "late_night": 0.0,
        "km_from_centre": _km_from_centre(localities["latitude"], localities["longitude"]),
        "log_residents_per_km2": np.log1p(_residents_per_km2(localities)),
        "outlets_within_500m": _neighbour_counts(tree, points, 500, exclude_self=False),
        "outlets_within_1km": counts_1k,
        "neighbour_log_reviews": medians,
    }, index=localities.index)


def standard_outlet(pois: pd.DataFrame) -> dict:
    """The typical independent outlet: median price and opening hours of independents."""
    independents = pois[~pois["is_chain_outlet"]]
    return {
        "price_level": float(independents["price_level"].median()),
        "open_hours": float(independents["daily_open_hours"].median()),
    }


def _outlet_index(pois: pd.DataFrame) -> tuple[BallTree, np.ndarray]:
    tree = BallTree(_radians(pois["latitude"], pois["longitude"]), metric="haversine")
    return tree, target(pois)


def _neighbour_counts(tree: BallTree, points: np.ndarray, radius_m: float, exclude_self: bool) -> np.ndarray:
    counts = tree.query_radius(points, radius_m / EARTH_RADIUS_M, count_only=True)
    return (counts - 1 if exclude_self else counts).astype(float)


def _neighbour_reviews(tree, reviews, points, exclude_self: bool) -> tuple[np.ndarray, np.ndarray]:
    """Count and median log reviews of outlets within 1 km. NaN median when there are none."""
    neighbours = tree.query_radius(points, 1000 / EARTH_RADIUS_M)
    counts, medians = [], []
    for row, found in enumerate(neighbours):
        others = [i for i in found if not (exclude_self and i == row)]
        counts.append(float(len(others)))
        medians.append(float(np.median(reviews[others])) if others else np.nan)
    return np.array(counts), np.array(medians)


def _residents_per_km2(localities: pd.DataFrame) -> pd.Series:
    return localities["population"] / localities["area_km2"]


def _km_from_centre(latitude: pd.Series, longitude: pd.Series) -> np.ndarray:
    lat, lon = np.radians(latitude.to_numpy(dtype=float)), np.radians(longitude.to_numpy(dtype=float))
    lat0, lon0 = np.radians(CITY_CENTRE[0]), np.radians(CITY_CENTRE[1])
    a = np.sin((lat - lat0) / 2) ** 2 + np.cos(lat) * np.cos(lat0) * np.sin((lon - lon0) / 2) ** 2
    return 2 * EARTH_RADIUS_M / 1000 * np.arcsin(np.sqrt(a))


def _radians(latitude: pd.Series, longitude: pd.Series) -> np.ndarray:
    return np.radians(np.column_stack([latitude.to_numpy(dtype=float), longitude.to_numpy(dtype=float)]))
