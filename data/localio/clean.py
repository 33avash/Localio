"""Drop rows that can't be placed on the map and coerce the numbers we use.

opening_time and closing_time are deliberately left as raw text: nothing
downstream reads them and their formats are inconsistent.
"""

from collections import Counter

import pandas as pd

from localio import CATEGORIES

KEY_COLUMNS = ("latitude", "longitude", "category", "locality")
NUMERIC_COLUMNS = ("latitude", "longitude", "avg_rating", "review_count", "is_chain_outlet")
TEXT_COLUMNS = ("name", "category", "locality")


def clean(raw: pd.DataFrame) -> tuple[pd.DataFrame, Counter]:
    """Return the usable POIs and a count of dropped rows per reason."""
    pois = raw.copy()
    for col in TEXT_COLUMNS:
        pois[col] = pois[col].str.strip().replace("", pd.NA)
    for col in NUMERIC_COLUMNS:
        pois[col] = pd.to_numeric(pois[col], errors="coerce")

    missing = pois[list(KEY_COLUMNS)].isna()
    reasons = missing.apply(lambda row: "missing " + ", ".join(c for c in KEY_COLUMNS if row[c]), axis=1)
    unknown = ~missing.any(axis=1) & ~pois["category"].isin(CATEGORIES)
    reasons[unknown] = "unknown category " + pois.loc[unknown, "category"].map(repr)

    keep = ~missing.any(axis=1) & ~unknown
    dropped = Counter(reasons[~keep])

    pois = pois[keep].copy()
    pois["review_count"] = pois["review_count"].fillna(0).astype(int)
    pois["is_chain_outlet"] = pois["is_chain_outlet"].fillna(0).astype(bool)
    return pois.reset_index(drop=True), dropped
