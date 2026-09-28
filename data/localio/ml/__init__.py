"""The pipeline's machine-learning stage.

run() evaluates and fits the footfall model, predicts demand for a new
outlet of each format in every locality, groups localities into market
types, and returns what the scorer, the exporter and model_report.json use.
"""

from dataclasses import dataclass

import pandas as pd

from localio import CATEGORIES
from localio.ml import archetypes, footfall
from localio.ml.features import LABELS, new_outlet_features, outlet_features, standard_outlet, target
from localio.opportunity import observed_demand


@dataclass(frozen=True)
class Results:
    demand: dict[str, pd.Series]
    footfall: dict[str, pd.DataFrame]
    drivers: dict[str, pd.Series]
    profile: pd.DataFrame
    archetype: pd.Series
    similar: pd.Series
    evaluation: footfall.Evaluation
    report: dict


def run(pois: pd.DataFrame, localities: pd.DataFrame) -> Results:
    features, y = outlet_features(pois, localities), target(pois)
    evaluation = footfall.evaluate(features, y, pois["locality"])
    standard = standard_outlet(pois)

    demand, predicted, drivers = {}, {}, {}
    if evaluation.uses_model:
        model = footfall.fit(features, y)
        for c in CATEGORIES:
            new = new_outlet_features(localities, pois, c, standard)
            predicted[c] = footfall.predict(model, new, evaluation.residuals)
            demand[c] = predicted[c]["log"]
            drivers[c] = footfall.contributions(model, new).apply(
                footfall.drivers, axis=1, coefficients=footfall.coefficients(model))
        effects = [{**e, "label": LABELS[e["feature"]]} for e in footfall.effects(model)]
    else:
        demand = {c: observed_demand(localities) for c in CATEGORIES}
        effects = []

    profile = archetypes.profiles(localities, pois, pd.concat(demand, axis=1).mean(axis=1))
    labels, clusters = archetypes.cluster(profile)

    report = {
        "footfall": {
            "question": "How many Google reviews would a new outlet here collect? Reviews stand in for footfall.",
            "target": "log(1 + reviews) per outlet",
            "outlets": int(len(y)),
            "localities": int(pois["locality"].nunique()),
            "validation": f"{footfall.FOLDS}-fold cross-validation holding out whole localities",
            "candidates": {name: {k: round(v, 3) for k, v in m.items()} for name, m in evaluation.metrics.items()},
            "chosen": "ridge" if evaluation.uses_model else None,
            "demand_source": "footfall model" if evaluation.uses_model else "observed reviews (model did not beat baseline)",
            "range": "80% of cross-validated errors fall inside it",
            "standard_outlet": {"chain": False, "late_night": False, **{k: round(v, 2) for k, v in standard.items()}},
            "effects": effects,
        },
        "market_types": {
            "method": "k-means on standardised locality profiles, k chosen by silhouette",
            "profile": list(archetypes.PROFILE),
            **clusters,
        },
    }
    return Results(demand, predicted, drivers, profile, labels, archetypes.similar(profile), evaluation, report)
