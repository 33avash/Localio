"""Opportunity score v2, for every locality and both formats.

    demand   = the footfall model's log reviews for a standard new outlet
               of this format (v1's observed log reviews if the model
               didn't beat its baseline)
    supply   = outlets of this format per 10,000 residents
    weakness = 5 - mean rating of this format's outlets (0.5 if none rated)

Each is min-max scaled across all 51 localities and combined with v1's
weights. Localities with fewer than MIN_POIS_TO_SCORE outlets now get a
score too, flagged low-confidence: the model can say something about
them, but little of it comes from their own outlets.
"""

import numpy as np
import pandas as pd

from localio import CATEGORIES
from localio.score import DEFAULT_WEIGHTS, MIN_POIS_TO_SCORE, UNRATED_WEAKNESS, safe_minmax


def score_v2(localities: pd.DataFrame, demand: dict[str, pd.Series], weights: dict = DEFAULT_WEIGHTS) -> pd.DataFrame:
    """Add <c>_demand_n, <c>_supply_n, <c>_weakness_n, <c>_score and low_confidence."""
    scored = localities.copy()
    scored["low_confidence"] = scored["total_pois"] < MIN_POIS_TO_SCORE
    for c in CATEGORIES:
        weakness = (5 - scored[f"{c}_avg_rating"]).fillna(UNRATED_WEAKNESS)
        scored[f"{c}_demand_n"] = safe_minmax(demand[c])
        scored[f"{c}_supply_n"] = safe_minmax(scored[f"{c}_per_10k"])
        scored[f"{c}_weakness_n"] = safe_minmax(weakness)
        scored[f"{c}_score"] = 100 * (
            weights["demand"] * scored[f"{c}_demand_n"]
            - weights["supply"] * scored[f"{c}_supply_n"]
            + weights["weakness"] * scored[f"{c}_weakness_n"]
        )
    return scored


def observed_demand(localities: pd.DataFrame) -> pd.Series:
    """v1's demand: log reviews across every outlet in the locality."""
    return np.log10(1 + localities["total_reviews"])
