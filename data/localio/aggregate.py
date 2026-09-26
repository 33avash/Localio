"""Roll POIs up to one row per locality.

We aggregate by locality, not grid_cell_id. The grid averages about 1.5
POIs per cell, so a per-cell count is mostly noise. Localities hold
0-12 POIs per category, which is enough to compare.
"""

import pandas as pd

from localio import CATEGORIES


def aggregate(pois: pd.DataFrame) -> pd.DataFrame:
    """One row per locality: centroid, totals, and per-category stats.

    Per-category columns are prefixed with the category, e.g. cafe_count,
    fast_food_avg_rating. avg_rating is NaN when a locality has no rated
    POIs in that category.
    """
    by_locality = pois.groupby("locality")
    localities = pd.DataFrame({
        "latitude": by_locality["latitude"].mean(),
        "longitude": by_locality["longitude"].mean(),
        "total_pois": by_locality.size(),
        "total_reviews": by_locality["review_count"].sum(),
    })

    for category in CATEGORIES:
        in_category = pois[pois["category"] == category].groupby("locality")
        count = in_category.size().reindex(localities.index, fill_value=0)
        chains = in_category["is_chain_outlet"].sum().reindex(localities.index, fill_value=0).astype(int)
        localities[f"{category}_count"] = count
        localities[f"{category}_avg_rating"] = in_category["avg_rating"].mean().reindex(localities.index)
        localities[f"{category}_chain_count"] = chains
        localities[f"{category}_independent_count"] = count - chains

    return localities.sort_index()
