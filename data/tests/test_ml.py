import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

from localio.ml import archetypes, footfall
from localio.ml.features import FEATURES, outlet_features, target


def _outlets(latitudes, longitudes, reviews):
    n = len(latitudes)
    return pd.DataFrame({
        "latitude": latitudes, "longitude": longitudes, "review_count": reviews,
        "category": ["cafe"] * n, "is_chain_outlet": [False] * n, "price_level": [2] * n,
        "daily_open_hours": [12] * n, "is_late_night": [0] * n, "locality": ["A"] * n,
    })


def test_neighbour_features_never_count_the_outlet_itself():
    # Two outlets 100 m apart, and one 20 km away.
    pois = _outlets([18.5, 18.5009, 18.7], [73.8, 73.8, 73.8], [10, 1000, 50])
    places = pd.DataFrame({"population": [1000], "area_km2": [1.0]}, index=["A"])
    features = outlet_features(pois, places)
    assert features["outlets_within_500m"].tolist() == [1, 1, 0]
    # The first outlet's neighbour median is the second outlet's reviews alone.
    assert features["neighbour_log_reviews"].iloc[0] == np.log1p(1000)
    assert np.isnan(features["neighbour_log_reviews"].iloc[2])


def test_folds_never_split_a_locality(pois, localities):
    features = outlet_features(pois, localities)
    for train, test in GroupKFold(n_splits=footfall.FOLDS).split(features, groups=pois["locality"]):
        assert not set(pois["locality"].iloc[train]) & set(pois["locality"].iloc[test])


def test_model_beats_the_baseline_on_held_out_localities(pois, localities):
    evaluation = footfall.evaluate(outlet_features(pois, localities), target(pois), pois["locality"])
    assert evaluation.uses_model
    assert evaluation.metrics["ridge"]["mae"] < evaluation.metrics["median baseline"]["mae"]


def test_contributions_add_up_to_the_prediction(pois, localities):
    features, y = outlet_features(pois, localities), target(pois)
    model = footfall.fit(features, y)
    parts = footfall.contributions(model, features)
    intercept = model.named_steps["ridgecv"].intercept_
    assert np.allclose(parts.sum(axis=1) + intercept, model.predict(features))
    assert list(parts.columns) == list(FEATURES)


def test_market_types_have_unique_names(pois, localities):
    profile = archetypes.profiles(localities, pois, localities["total_per_10k"])
    labels, report = archetypes.cluster(profile)
    names = [t["name"] for t in report["types"]]
    assert len(names) == len(set(names)) == report["k"]
    assert labels.notna().all()
    assert all(len(similar) == archetypes.SIMILAR for similar in archetypes.similar(profile))
