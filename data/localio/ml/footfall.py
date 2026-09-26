"""Footfall model: how many reviews would a new outlet in this locality collect?

Google gives no visit counts, so reviews stand in for footfall, and the
target is log(1 + reviews). Three candidates are compared with grouped
cross-validation that holds out whole localities, so every error below is
measured on places the model has never seen:

- median baseline: predicts the typical outlet everywhere
- ridge: linear and regularised; each feature's share of a prediction is exact
- gradient boosting: checks whether non-linear effects help at this size

Ridge is used only if it beats the baseline's error. If it doesn't, the
pipeline keeps v1's observed-reviews demand and reports that it did.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.base import clone
from sklearn.dummy import DummyRegressor
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import RidgeCV
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import Pipeline, make_pipeline
from sklearn.preprocessing import StandardScaler

from localio.ml.features import FEATURES

FOLDS = 5
RANGE = (0.1, 0.9)

# Features that describe the outlet rather than the place. They're fixed for
# the standard new outlet, so they never explain why one locality beats another.
OUTLET_FEATURES = {"is_qsr", "chain", "price_level", "open_hours", "late_night"}


def candidates() -> dict[str, Pipeline]:
    impute = SimpleImputer(strategy="median")
    return {
        "median baseline": make_pipeline(clone(impute), DummyRegressor(strategy="median")),
        "ridge": make_pipeline(clone(impute), StandardScaler(), RidgeCV(alphas=np.logspace(-2, 3, 30))),
        "gradient boosting": make_pipeline(clone(impute), HistGradientBoostingRegressor(
            max_depth=3, learning_rate=0.05, max_iter=200, min_samples_leaf=15, random_state=0)),
    }


@dataclass(frozen=True)
class Evaluation:
    metrics: dict[str, dict[str, float]]
    residuals: np.ndarray
    uses_model: bool


def evaluate(features: pd.DataFrame, y: np.ndarray, localities: pd.Series) -> Evaluation:
    """Out-of-fold predictions for every candidate, one locality group held out at a time."""
    folds = list(GroupKFold(n_splits=FOLDS).split(features, y, groups=localities))
    metrics, predictions = {}, {}
    for name, model in candidates().items():
        predicted = np.empty_like(y)
        for train, test in folds:
            fitted = clone(model).fit(features.iloc[train], y[train])
            predicted[test] = fitted.predict(features.iloc[test])
        predictions[name] = predicted
        metrics[name] = {
            "mae": float(mean_absolute_error(y, predicted)),
            "r2": float(r2_score(y, predicted)),
            "spearman": float(spearmanr(y, predicted).statistic),
        }
    uses_model = metrics["ridge"]["mae"] < metrics["median baseline"]["mae"]
    return Evaluation(metrics, y - predictions["ridge"], uses_model)


def fit(features: pd.DataFrame, y: np.ndarray) -> Pipeline:
    return candidates()["ridge"].fit(features, y)


def predict(model: Pipeline, features: pd.DataFrame, residuals: np.ndarray) -> pd.DataFrame:
    """Prediction plus an 80% range taken from the cross-validated residuals, all in log space."""
    predicted = model.predict(features)
    low, high = np.quantile(residuals, RANGE)
    return pd.DataFrame({"log": predicted, "low": predicted + low, "high": predicted + high}, index=features.index)


def contributions(model: Pipeline, features: pd.DataFrame) -> pd.DataFrame:
    """Each feature's exact share of each prediction, relative to the average outlet.

    For a ridge model on standardised inputs, prediction = intercept +
    sum(coef * z), so coef * z is exactly what each feature adds or takes away.
    """
    imputer, scaler, ridge = (model.named_steps[step] for step in ("simpleimputer", "standardscaler", "ridgecv"))
    z = scaler.transform(imputer.transform(features))
    return pd.DataFrame(z * ridge.coef_, columns=list(FEATURES), index=features.index)


def drivers(row: pd.Series, count: int = 3) -> list[dict]:
    """The place features that move this locality's prediction most, biggest first."""
    place = row.drop(labels=list(OUTLET_FEATURES))
    top = place.reindex(place.abs().sort_values(ascending=False).index).head(count)
    return [{"feature": feature, "effect": round(float(effect), 3)} for feature, effect in top.items()]


def effects(model: Pipeline) -> list[dict]:
    """Change in log reviews for a one-standard-deviation increase in each feature."""
    ridge = model.named_steps["ridgecv"]
    pairs = sorted(zip(FEATURES, ridge.coef_), key=lambda pair: -abs(pair[1]))
    return [{"feature": feature, "per_sd": round(float(coef), 3)} for feature, coef in pairs]
