"""Capacity model: how much food and drink trade can a ward support?

OpenStreetMap records where outlets are, but no reviews or visits, so there
is no footfall label to learn. What it does show is where outlets have
opened, and outlets open where trade supports them. So the model learns a
ward's outlets per km² from things that aren't outlets: residents per km²,
distance to the nearest college, office and station, road density,
classified-road density and distance from the centre. Nothing it sees is
derived from the outlets it predicts.

Three candidates are compared leaving one ward out at a time (140 folds):
a median baseline, linear quantile regression and gradient-boosted quantile
regression, each at p10, p50 and p90. Linear quantile regression is used if
it beats the baseline's error; below R² 0.25 its output is labelled a
directional signal rather than an estimate.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.base import clone
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import QuantileRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.pipeline import Pipeline, make_pipeline
from sklearn.preprocessing import StandardScaler

QUANTILES = (0.1, 0.5, 0.9)
ESTIMATE_R2 = 0.25

FEATURES = (
    "residents_per_km2",
    "km_to_college",
    "km_to_office",
    "km_to_station",
    "road_m_per_km2",
    "classified_road_m_per_km2",
    "km_from_centre",
)

LABELS = {
    "residents_per_km2": "residents per km²",
    "km_to_college": "distance to the nearest college",
    "km_to_office": "distance to the nearest office",
    "km_to_station": "distance to the nearest station",
    "road_m_per_km2": "road density",
    "classified_road_m_per_km2": "main-road density",
    "km_from_centre": "distance from the city centre",
}

# How a feature reads when the ward is above or below the average ward.
PHRASES = {
    "residents_per_km2": ("many residents per km²", "few residents per km² (more commercial land)"),
    "km_to_college": ("no college close by", "a college close by"),
    "km_to_office": ("no offices close by", "offices close by"),
    "km_to_station": ("no station close by", "a station close by"),
    "road_m_per_km2": ("a dense street grid", "a sparse street grid"),
    "classified_road_m_per_km2": ("main roads running through", "few main roads"),
    "km_from_centre": ("being far from the centre", "being close to the centre"),
}


def candidates() -> dict[str, dict[float, Pipeline]]:
    return {
        "linear quantile": {q: make_pipeline(StandardScaler(), QuantileRegressor(quantile=q, alpha=0.01, solver="highs"))
                            for q in QUANTILES},
        "boosted quantile": {q: make_pipeline(HistGradientBoostingRegressor(
            loss="quantile", quantile=q, max_depth=2, learning_rate=0.05, max_iter=200, min_samples_leaf=10,
            random_state=0)) for q in QUANTILES},
    }


def prepare(features: pd.DataFrame) -> pd.DataFrame:
    """Log every feature: densities and distances are all heavily skewed."""
    return np.log1p(features[list(FEATURES)])


def target(outlets: pd.Series, area_km2: pd.Series) -> pd.Series:
    """log(1 + outlets per km²)."""
    return np.log1p(outlets / area_km2)


@dataclass(frozen=True)
class Evaluation:
    metrics: dict[str, dict[str, float]]
    uses_model: bool
    label: str


def evaluate(x: pd.DataFrame, y: pd.Series) -> Evaluation:
    """Leave one ward out: every figure is a prediction for a ward the model didn't see."""
    values = y.to_numpy()
    baseline = np.array([np.median(np.delete(values, i)) for i in range(len(values))])
    metrics = {"median baseline": {"mae": float(mean_absolute_error(values, baseline)), "r2": float(r2_score(values, baseline))}}
    for name, models in candidates().items():
        held_out = {q: np.empty(len(values)) for q in QUANTILES}
        for i in range(len(values)):
            train = np.arange(len(values)) != i
            for q, model in models.items():
                held_out[q][i] = clone(model).fit(x[train], values[train]).predict(x.iloc[[i]])[0]
        low, mid, high = (held_out[q] for q in QUANTILES)
        metrics[name] = {
            "mae": float(mean_absolute_error(values, mid)),
            "r2": float(r2_score(values, mid)),
            "spearman": float(spearmanr(values, mid).statistic),
            "coverage": float(np.mean((values >= np.minimum(low, high)) & (values <= np.maximum(low, high)))),
        }
    chosen = metrics["linear quantile"]
    uses_model = chosen["mae"] < metrics["median baseline"]["mae"]
    label = "estimate" if chosen["r2"] >= ESTIMATE_R2 else "directional signal"
    return Evaluation(metrics, uses_model, label)


def fit(x: pd.DataFrame, y: pd.Series) -> dict[float, Pipeline]:
    return {q: clone(model).fit(x, y.to_numpy()) for q, model in candidates()["linear quantile"].items()}


def predict(models: dict[float, Pipeline], x: pd.DataFrame) -> pd.DataFrame:
    """p10, p50, p90 of log(1 + outlets per km²), sorted so the band never crosses."""
    raw = np.column_stack([models[q].predict(x) for q in QUANTILES])
    return pd.DataFrame(np.sort(raw, axis=1), columns=["p10", "p50", "p90"], index=x.index)


def contributions(model: Pipeline, x: pd.DataFrame) -> pd.DataFrame:
    """Each feature's exact part of the p50 prediction, relative to the average ward
    (linear model on standardised inputs: prediction = intercept + sum(coef * z))."""
    scaler, regressor = model.named_steps["standardscaler"], model.named_steps["quantileregressor"]
    return pd.DataFrame(scaler.transform(x) * regressor.coef_, columns=list(FEATURES), index=x.index)


def drivers(row: pd.Series, coefficients: dict[str, float], count: int = 3) -> list[dict]:
    """The features that move this ward's p50 most, biggest first, phrased by direction."""
    top = row.reindex(row.abs().sort_values(ascending=False).index).head(count)
    return [{"feature": feature, "effect": round(float(effect), 3),
             "phrase": PHRASES[feature][0 if effect * coefficients[feature] > 0 else 1]}
            for feature, effect in top.items() if abs(effect) > 1e-6]


def effects(model: Pipeline) -> list[dict]:
    """Change in log outlets per km² for a one-standard-deviation increase in each feature."""
    coef = model.named_steps["quantileregressor"].coef_
    return [{"feature": f, "label": LABELS[f], "per_sd": round(float(c), 3)}
            for f, c in sorted(zip(FEATURES, coef), key=lambda pair: -abs(pair[1]))]


def coefficients(model: Pipeline) -> dict[str, float]:
    return dict(zip(FEATURES, model.named_steps["quantileregressor"].coef_))
