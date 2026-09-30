"""The score: four components, weighted by what matters to the user.

Each component runs from 0 to 1, higher is better for a new outlet:

    residents     how densely people live there: the ward's percentile
                  among Pune's 140 wards on residents per km²
    eating_out    how much people already eat out there: its percentile on
                  food and drink outlets per km² (every kind)
    daytime       what draws people in by day: its percentile on offices,
                  colleges and stations per km²
    room          how little competition your format has:
                    1 - x / (x + reference)
                  x is the format's outlets per 10,000 residents, counting
                  one more than OpenStreetMap maps, since it misses outlets
                  and "none mapped" isn't "none at all"; the reference is the
                  same rate across the wards with enough outlets mapped to
                  trust. At the reference, room is 0.5.

    score = 100 x sum(weight x component) / sum(weights)

So each component contributes 100 x weight x component / sum(weights)
points, and the points add up to the score. WEIGHTS is the default brief
(a mix of customers, some competition is fine); on the site, the user's
brief sets the weights, and each can be fine-tuned.

Wards with fewer than MIN_OUTLETS food and drink outlets mapped are scored
but marked low confidence: that few usually means thin mapping, not an
empty market, so they're left off the shortlist unless asked for.
"""

import pandas as pd

from localio import CATEGORIES

MIN_OUTLETS = 10
DRAWS = ("offices", "colleges", "stations")
COMPONENTS = ("residents", "eating_out", "daytime", "room")
# Outlets added to each ward's count before measuring competition.
UNMAPPED = 1
# Decimal places the components are published (and scored) with.
PRECISION = 4

# The default weights (0-5 each): the site's default brief. They're
# published in wards.geojson, and a browser test checks the site's default
# brief gives exactly these scores.
WEIGHTS = {"residents": 1, "eating_out": 1, "daytime": 1, "room": 3}


def percentile(values: pd.Series) -> pd.Series:
    """The share of other wards with a strictly lower value (ties share the
    lower rank), so the lowest is 0 and the highest 1."""
    if len(values) < 2:
        return pd.Series(0.0, index=values.index)
    return (values.rank(method="min") - 1) / (len(values) - 1)


def references(wards: pd.DataFrame) -> dict[str, float]:
    """Each format's outlets per 10,000 residents across the wards with
    enough outlets mapped to trust."""
    trusted = wards[wards["total_pois"] >= MIN_OUTLETS]
    return {c: float(trusted[f"{c}_count"].sum() / trusted["population"].sum() * 10_000) for c in CATEGORIES}


def score(wards: pd.DataFrame, weights: dict[str, float] | None = None) -> tuple[pd.DataFrame, dict[str, float]]:
    weights = weights or WEIGHTS
    scored = wards.copy()
    scored["low_confidence"] = scored["total_pois"] < MIN_OUTLETS
    scored["residents_per_km2"] = scored["population"] / scored["area_km2"]
    scored["outlets_per_km2"] = scored["total_pois"] / scored["area_km2"]
    scored["draws"] = scored[list(DRAWS)].sum(axis=1)
    scored["draws_per_km2"] = scored["draws"] / scored["area_km2"]
    # Components are rounded to the precision wards.geojson publishes, and
    # the score is computed from those, so the browser, working from the
    # published file, gets exactly the same score.
    scored["residents"] = percentile(scored["residents_per_km2"]).round(PRECISION)
    scored["eating_out"] = percentile(scored["outlets_per_km2"]).round(PRECISION)
    scored["daytime"] = percentile(scored["draws_per_km2"]).round(PRECISION)
    reference = references(scored)
    total = sum(weights.values())
    for c in CATEGORIES:
        x = (scored[f"{c}_count"] + UNMAPPED) / scored["population"] * 10_000
        scored[f"{c}_room"] = (1 - x / (x + reference[c])).round(PRECISION)
        parts = {name: scored[name] for name in COMPONENTS[:3]} | {"room": scored[f"{c}_room"]}
        scored[f"{c}_score"] = 100 * sum(weights[name] * parts[name] for name in COMPONENTS) / total
    return scored, reference
