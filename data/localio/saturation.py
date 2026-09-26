"""How crowded a locality already is in one category.

Tiers come from the 40th and 75th percentiles of non-zero counts, computed
per category, so "high" means high relative to other localities that have
at least one outlet of that kind. Zero is its own tier: a total gap.
"""

import numpy as np
import pandas as pd

from localio import CATEGORIES

PERCENTILES = (40, 75)


def thresholds(counts: pd.Series) -> tuple[float, float] | None:
    """(p40, p75) of the non-zero counts, or None if every count is zero."""
    nonzero = counts[counts > 0]
    if nonzero.empty:
        return None
    low, high = np.percentile(nonzero, PERCENTILES)
    return float(low), float(high)


def tier(count: int, cutoffs: tuple[float, float] | None) -> str:
    if count == 0 or cutoffs is None:
        return "none"
    low, high = cutoffs
    if count <= low:
        return "low"
    if count <= high:
        return "medium"
    return "high"


def assign_tiers(localities: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Add a {category}_saturation column; return the cutoffs used per category."""
    tiered = localities.copy()
    cutoffs = {}
    for category in CATEGORIES:
        counts = tiered[f"{category}_count"]
        cutoffs[category] = thresholds(counts)
        tiered[f"{category}_saturation"] = counts.map(lambda n, c=cutoffs[category]: tier(n, c))
    return tiered, cutoffs
