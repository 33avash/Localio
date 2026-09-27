"""Opportunity score, for every ward and both formats.

    demand = the capacity model's p50 outlets per km² for the ward's
             surroundings (observed density if the model didn't beat its
             baseline)
    supply = outlets of this format per 10,000 residents
    gap    = unmet demand: the model's p50 outlets per km² minus the
             ward's actual outlets per km²

Each is min-max scaled across all 140 wards, then

    score = 100 * (w_demand * demand - w_supply * supply + w_gap * gap)

Wards with fewer than MIN_POIS_TO_SCORE outlets are scored too, flagged
low-confidence: their supply figures rest on one to three outlets.
"""

import numpy as np
import pandas as pd

from localio import CATEGORIES
from localio.score import DEFAULT_WEIGHTS, MIN_POIS_TO_SCORE, safe_minmax


def score(wards: pd.DataFrame, capacity: pd.DataFrame, weights: dict = DEFAULT_WEIGHTS) -> pd.DataFrame:
    scored = wards.copy()
    scored["low_confidence"] = scored["total_pois"] < MIN_POIS_TO_SCORE
    demand_n = safe_minmax(np.log1p(capacity["p50"]))
    gap_n = safe_minmax(capacity["p50"] - scored["total_pois"] / scored["area_km2"])
    for c in CATEGORIES:
        scored[f"{c}_demand_n"] = demand_n
        scored[f"{c}_supply_n"] = safe_minmax(scored[f"{c}_per_10k"])
        scored[f"{c}_gap_n"] = gap_n
        scored[f"{c}_score"] = 100 * (
            weights["demand"] * demand_n
            - weights["supply"] * scored[f"{c}_supply_n"]
            + weights["gap"] * gap_n
        )
    return scored
