"""Opportunity score per (locality, category).

    demand   = log10(1 + total reviews across all F&B POIs in the locality)
    supply   = number of POIs in this category in the locality
    weakness = 5 - mean rating of this category's POIs (0.5 if none rated)

Each component is min-max normalized across scored localities, then

    score = 100 * (w_d * demand_n - w_s * supply_n + w_w * weakness_n)

Demand is log-scaled because one locality has ~121k reviews, about 3x the
next. On a linear scale it would pin the maximum and squash every other
locality toward zero.
"""

import numpy as np
import pandas as pd

from localio import CATEGORIES

MIN_POIS_TO_SCORE = 4
DEFAULT_WEIGHTS = {"demand": 0.45, "supply": 0.40, "weakness": 0.15}
UNRATED_WEAKNESS = 0.5


def safe_minmax(values: pd.Series) -> pd.Series:
    """Scale to 0-1. A flat or empty series maps to 0.0 instead of dividing by zero."""
    low, high = values.min(), values.max()
    if pd.isna(low) or high == low:
        return pd.Series(0.0, index=values.index)
    return (values - low) / (high - low)


def score(localities: pd.DataFrame, weights: dict = DEFAULT_WEIGHTS) -> pd.DataFrame:
    """Add normalized components and scores for localities with enough data.

    Localities under MIN_POIS_TO_SCORE get scored=False and NaN components;
    they stay in the frame so the map can still show them.
    """
    scored = localities.copy()
    scored["scored"] = scored["total_pois"] >= MIN_POIS_TO_SCORE
    eligible = scored[scored["scored"]]

    scored["demand_n"] = safe_minmax(np.log10(1 + eligible["total_reviews"]))
    for category in CATEGORIES:
        supply = eligible[f"{category}_count"].astype(float)
        weakness = (5 - eligible[f"{category}_avg_rating"]).fillna(UNRATED_WEAKNESS)
        scored[f"{category}_supply_n"] = safe_minmax(supply)
        scored[f"{category}_weakness_n"] = safe_minmax(weakness)
        scored[f"{category}_score"] = 100 * (
            weights["demand"] * scored["demand_n"]
            - weights["supply"] * scored[f"{category}_supply_n"]
            + weights["weakness"] * scored[f"{category}_weakness_n"]
        )
    return scored


def ranked(scored: pd.DataFrame, category: str) -> pd.Series:
    """Scores for one category, best first. Ties break alphabetically."""
    column = scored.loc[scored["scored"], f"{category}_score"]
    return column.sort_index().sort_values(ascending=False, kind="stable")
