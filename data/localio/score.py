"""Shared scoring constants and the safe min-max used by every score."""

import pandas as pd

MIN_POIS_TO_SCORE = 4
DEFAULT_WEIGHTS = {"demand": 0.45, "supply": 0.40, "gap": 0.15}


def safe_minmax(values: pd.Series) -> pd.Series:
    """Scale to 0-1. A flat or empty series maps to 0.0 instead of dividing by zero."""
    low, high = values.min(), values.max()
    if pd.isna(low) or high == low:
        return pd.Series(0.0, index=values.index)
    return (values - low) / (high - low)
