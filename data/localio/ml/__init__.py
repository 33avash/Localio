"""The pipeline's machine-learning stage.

run() evaluates and fits the capacity model, turns its p10/p50/p90 into
each ward's footfall multiplier band and gap, groups wards into market
types, and returns what the scorer, the economics and model_report.json use.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd

from localio.ml import archetypes, capacity


@dataclass(frozen=True)
class Results:
    capacity: pd.DataFrame     # p10, p50, p90 outlets per km² the ward's surroundings support
    multiplier: pd.DataFrame   # the same, divided by the city's median ward p50
    gap: pd.Series             # predicted p50 outlets minus actual outlets
    drivers: pd.Series         # the features behind each ward's p50
    profile: pd.DataFrame
    archetype: pd.Series
    similar: pd.Series
    evaluation: capacity.Evaluation
    report: dict


def run(wards: pd.DataFrame, features: pd.DataFrame) -> Results:
    x = capacity.prepare(features.loc[wards.index])
    y = capacity.target(wards["total_pois"], wards["area_km2"])
    evaluation = capacity.evaluate(x, y)

    if evaluation.uses_model:
        models = capacity.fit(x, y)
        log_band = capacity.predict(models, x)
        median = models[0.5]
        drivers = capacity.contributions(median, x).apply(
            capacity.drivers, axis=1, coefficients=capacity.coefficients(median))
        effects = capacity.effects(median)
    else:
        # Fall back to observed density, with no spread, and say so.
        log_band = pd.DataFrame({"p10": y, "p50": y, "p90": y})
        drivers = pd.Series([[] for _ in x.index], index=x.index)
        effects = []

    density = np.expm1(log_band).clip(lower=0)
    multiplier = density / density["p50"].median()
    gap = density["p50"] * wards["area_km2"] - wards["total_pois"]

    profile = archetypes.profiles(wards, log_band["p50"])
    labels, clusters = archetypes.cluster(profile)

    report = {
        "capacity": {
            "question": "How many food and drink outlets per km² do a ward's surroundings support?",
            "why_not_footfall": "OpenStreetMap has no reviews or visit counts, so there is no footfall label. "
                                "Outlets open where trade supports them, so outlet density is the learnable signal.",
            "target": "log(1 + food and drink outlets per km²), per ward",
            "wards": int(len(y)),
            "outlets": int(wards["total_pois"].sum()),
            "features": [{"feature": f, "label": capacity.LABELS[f]} for f in capacity.FEATURES],
            "validation": f"leave one ward out ({len(y)} folds)",
            "candidates": {name: {k: round(v, 3) for k, v in m.items()} for name, m in evaluation.metrics.items()},
            "chosen": "linear quantile" if evaluation.uses_model else None,
            "label": evaluation.label if evaluation.uses_model else "not used",
            "quantiles": list(capacity.QUANTILES),
            "cannot": "It can't see rent, menus, brands or who walks past at lunch, and it learns where outlets "
                      "already are, so it rates a ward by what similar wards support, not by what one new outlet will earn.",
            "effects": effects,
        },
        "market_types": {
            "method": "k-means on standardised ward profiles, k chosen by silhouette",
            "profile": list(archetypes.PROFILE),
            **clusters,
        },
    }
    return Results(density, multiplier, gap, drivers, profile, labels, archetypes.similar(profile), evaluation, report)
