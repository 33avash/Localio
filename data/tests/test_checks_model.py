import numpy as np
import pandas as pd

from localio import db
from localio.density import _classes
from localio.ml import capacity
from localio.score import safe_minmax
from localio.validate import check_pois, check_wards


def _wards(populations, corporations):
    return pd.DataFrame({"population": populations, "corporation": corporations},
                        index=[f"W{i}" for i in range(len(populations))])


def test_a_ward_over_120k_fails():
    frame = _wards([130_000] + [40_000] * 75 + [27_000] * 64, ["PMC"] * 76 + ["PCMC"] * 64)
    assert not {c.label: c.ok for c in check_wards(frame)}["max ward"]


def test_a_ward_far_from_its_corporations_mean_fails():
    frame = _wards([3_124_458 / 76] * 75 + [1_000] + [27_000] * 64, ["PMC"] * 76 + ["PCMC"] * 64)
    assert not {c.label: c.ok for c in check_wards(frame)}["ward sizes"]


def test_the_real_wards_pass(loaded):
    conn, _ = loaded
    wards = db.wards_frame(conn)
    assert all(check.ok for check in check_wards(wards)), [c for c in check_wards(wards) if not c.ok]


def test_too_few_outlets_fails():
    wards = _wards([1_000_000], ["PMC"])
    pois = pd.DataFrame({"format": ["cafe"] * 10})
    results = {c.label: c.ok for c in check_pois(pois, wards, {"outside": 0, "in_two_wards": 0})}
    assert not results["outlets"] and not results["per 10k"] and not results["cafes"]


def test_safe_minmax_and_density_classes_handle_flat_input():
    assert safe_minmax(pd.Series([3.0, 3.0])).tolist() == [0.0, 0.0]
    assert _classes(pd.Series([0.0, 0.0])).tolist() == [0, 0]
    classes = _classes(pd.Series([0.0, 0.1, 0.2, 0.3, 0.4, 0.5]))
    assert classes.iloc[0] == 0 and set(classes.iloc[1:]) == {1, 2, 3, 4, 5}


def test_features_never_come_from_the_outlets(loaded):
    conn, _ = loaded
    features = db.ward_features(conn)
    assert list(features.columns) == list(capacity.FEATURES)
    # Removing every outlet must not change a single feature.
    conn.execute("DELETE FROM pois")
    assert db.ward_features(conn).equals(features)


def test_quantile_band_is_ordered_and_contributions_are_exact(loaded):
    conn, _ = loaded
    wards = db.wards_frame(conn)
    outlets = db.pois_frame(conn).groupby("ward").size().reindex(wards.index, fill_value=0)
    x = capacity.prepare(db.ward_features(conn))
    y = capacity.target(outlets, wards["area_km2"])
    models = capacity.fit(x, y)
    band = capacity.predict(models, x)
    assert (band["p10"] <= band["p50"]).all() and (band["p50"] <= band["p90"]).all()
    median = models[0.5]
    parts = capacity.contributions(median, x)
    intercept = median.named_steps["quantileregressor"].intercept_
    assert np.allclose(parts.sum(axis=1) + intercept, median.predict(x))


def test_the_model_beats_its_baseline_on_held_out_wards(loaded):
    conn, _ = loaded
    wards = db.wards_frame(conn)
    outlets = db.pois_frame(conn).groupby("ward").size().reindex(wards.index, fill_value=0)
    evaluation = capacity.evaluate(capacity.prepare(db.ward_features(conn)), capacity.target(outlets, wards["area_km2"]))
    assert evaluation.uses_model
    assert evaluation.label in ("estimate", "directional signal")
