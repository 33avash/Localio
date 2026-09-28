"""The score: how busy a ward is, against how much competition is there.

    demand      = mean of three percentiles across the 140 wards, each the
                  share of other wards with a lower value (0 to 1):
                    residents per km²                    where people live
                    food and drink outlets per km²       where they eat out
                    offices, colleges, stations per km²  where they work,
                                                         study and travel
    competition = this format's outlets per 10,000 residents, as
                  x / (x + city median): 0 with none, 0.5 at the median,
                  close to 1 when crowded
    score       = 100 x (w_demand x demand + w_competition x (1 - competition))

A score runs from 0 to 100. The three priorities only change the two
weights, which is why the browser can re-rank instantly.

Wards with fewer than MIN_OUTLETS food and drink outlets are scored but
marked low confidence. OpenStreetMap maps so few outlets mostly where its
coverage is thin, not where the market is empty, so they're left off the
shortlist unless asked for.
"""

import pandas as pd

from localio import CATEGORIES

MIN_OUTLETS = 10
DRAWS = ("offices", "colleges", "stations")

# Priority -> weights. The browser (web/static/js/score.js) and the chat
# (api/localio_api/facts.py) use the same three.
LENSES = {
    "busy": {"demand": 0.8, "competition": 0.2},
    "balanced": {"demand": 0.5, "competition": 0.5},
    "quiet": {"demand": 0.2, "competition": 0.8},
}
DEFAULT_LENS = "balanced"


def percentile(values: pd.Series) -> pd.Series:
    """The share of other wards with a strictly lower value (ties share the
    lower rank), so the lowest is 0, the highest 1, and zero outlets is 0."""
    if len(values) < 2:
        return pd.Series(0.0, index=values.index)
    return (values.rank(method="min") - 1) / (len(values) - 1)


def score(wards: pd.DataFrame, lens: str = DEFAULT_LENS) -> pd.DataFrame:
    scored = wards.copy()
    scored["low_confidence"] = scored["total_pois"] < MIN_OUTLETS
    scored["residents_per_km2"] = scored["population"] / scored["area_km2"]
    scored["draws"] = scored[list(DRAWS)].sum(axis=1)
    scored["draws_per_km2"] = scored["draws"] / scored["area_km2"]
    scored["outlets_per_km2"] = scored["total_pois"] / scored["area_km2"]
    scored["demand"] = (percentile(scored["residents_per_km2"]) + percentile(scored["outlets_per_km2"])
                        + percentile(scored["draws_per_km2"])) / 3
    weights = LENSES[lens]
    for c in CATEGORIES:
        per_10k = scored[f"{c}_per_10k"]
        scored[f"{c}_competition"] = (per_10k / (per_10k + per_10k.median())).fillna(0.0)
        scored[f"{c}_score"] = 100 * (weights["demand"] * scored["demand"]
                                      + weights["competition"] * (1 - scored[f"{c}_competition"]))
    return scored
