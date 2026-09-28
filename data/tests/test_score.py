"""The score: percentiles, the three priorities, and low confidence."""

import pandas as pd
import pytest

from localio import db
from localio.score import LENSES, percentile, score


def test_percentile_is_the_share_of_wards_below():
    assert percentile(pd.Series([10, 20, 30, 40, 50])).tolist() == [0.0, 0.25, 0.5, 0.75, 1.0]
    # Wards with no outlets all share the bottom.
    assert percentile(pd.Series([0, 0, 0, 5])).tolist() == [0.0, 0.0, 0.0, 1.0]


def _wards():
    return pd.DataFrame({
        "population": [40_000, 30_000, 10_000],
        "area_km2": [2.0, 2.0, 4.0],
        "offices": [30, 2, 0], "colleges": [2, 1, 0], "stations": [1, 0, 0],
        "total_pois": [40, 12, 2],
        "cafe_per_10k": [5.0, 0.5, 0.0], "fast_food_per_10k": [3.0, 0.0, 0.0],
    }, index=["busy", "middling", "quiet"])


def test_busy_ward_has_top_demand_and_scores_stay_in_range():
    scored = score(_wards())
    assert scored["demand"].idxmax() == "busy"
    assert scored.loc["busy", "demand"] == 1.0
    assert scored[["cafe_score", "fast_food_score"]].stack().between(0, 100).all()


def test_the_priority_changes_the_leader():
    leaders = {lens: score(_wards(), lens)["cafe_score"].idxmax() for lens in LENSES}
    assert leaders["busy"] == "busy"
    assert leaders["quiet"] != "busy"


def test_the_score_formula():
    scored = score(_wards(), "balanced")
    row = scored.loc["middling"]
    assert row["cafe_score"] == pytest.approx(100 * (0.5 * row["demand"] + 0.5 * (1 - row["cafe_competition"])))


def test_wards_with_few_outlets_are_low_confidence():
    assert score(_wards())["low_confidence"].tolist() == [False, False, True]


def test_draws_are_counted_inside_each_ward(loaded):
    conn, _ = loaded
    wards = db.wards_frame(conn)
    # Pune's offices cluster in a few wards; most wards have none.
    assert wards["offices"].sum() > 300
    assert wards.loc["PMC-02", "offices"] > wards["offices"].median()
