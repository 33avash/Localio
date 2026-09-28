"""Outlets per 10,000 residents, and the classes the map colours them by.

Counts alone favour big catchments: 8 cafes among 300,000 people is a
thinner market than 5 among 20,000. Dividing by population fixes that.

Each format (and all F&B together) gets five quantile classes over its
non-zero values. Zero stays its own class, because "none yet" is the most
interesting answer on the map, not the bottom of a scale.
"""

import numpy as np
import pandas as pd

from localio import CATEGORIES

CLASSES = 5
KEYS = (*CATEGORIES, "total")


def add_density(localities: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Add <key>_per_10k and <key>_density_class columns; return each key's class ranges."""
    dense = localities.copy()
    ranges = {}
    for key in KEYS:
        count = dense["total_pois"] if key == "total" else dense[f"{key}_count"]
        per_10k = count / dense["population"] * 10_000
        classes = _classes(per_10k)
        dense[f"{key}_per_10k"] = per_10k
        dense[f"{key}_density_class"] = classes
        ranges[key] = {
            int(c): [round(float(per_10k[classes == c].min()), 2), round(float(per_10k[classes == c].max()), 2)]
            for c in sorted(classes.unique())
        }
    return dense, ranges


def _classes(values: pd.Series) -> pd.Series:
    """0 for zero, then 1..CLASSES by quantile of the non-zero values."""
    nonzero = values[values > 0]
    if nonzero.empty:
        return pd.Series(0, index=values.index)
    edges = np.unique(np.quantile(nonzero, np.linspace(0, 1, CLASSES + 1)[1:-1]))
    classes = np.searchsorted(edges, values, side="right") + 1
    return pd.Series(np.where(values > 0, classes, 0), index=values.index).astype(int)
