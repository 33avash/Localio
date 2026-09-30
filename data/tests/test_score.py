"""The score: its four components, the competition reference, and the
weighted formula."""

import pandas as pd
import pytest

from localio import db
from localio.score import COMPONENTS, MIN_OUTLETS, WEIGHTS, percentile, references, score


def test_percentile_is_the_share_of_wards_below():
    assert percentile(pd.Series([10, 20, 30, 40, 50])).tolist() == [0.0, 0.25, 0.5, 0.75, 1.0]
    # Ties share the lower rank, so wards with nothing all sit at 0.
    assert percentile(pd.Series([0, 0, 0, 5])).tolist() == [0.0, 0.0, 0.0, 1.0]


def _wards():
    return pd.DataFrame({
        "population": [40_000, 30_000, 20_000, 10_000],
        "area_km2": [2.0, 2.0, 2.0, 4.0],
        "offices": [30, 2, 1, 0], "colleges": [2, 1, 0, 0], "stations": [1, 0, 0, 0],
        "total_pois": [40, 20, 12, 2],
        "cafe_count": [20, 3, 0, 0], "fast_food_count": [12, 0, 1, 0],
    }, index=["busy", "middling", "gap", "thin"])


def test_the_reference_uses_only_well_mapped_wards():
    # "thin" has 2 outlets, under MIN_OUTLETS, so its residents don't dilute the rate.
    assert MIN_OUTLETS == 10
    assert references(_wards())["cafe"] == pytest.approx((20 + 3 + 0) / 90_000 * 10_000)


def test_room_counts_one_unmapped_outlet_and_is_half_at_the_reference():
    scored, reference = score(_wards())
    # "gap" has no cafes mapped: it's read as one, so its room is high but not 1.
    x = (0 + 1) / 20_000 * 10_000
    assert scored.loc["gap", "cafe_room"] == pytest.approx(1 - x / (x + reference["cafe"]), abs=1e-4)
    assert 0.5 < scored.loc["gap", "cafe_room"] < 1
    # The crowded ward, about twice the reference rate, has well under half.
    assert scored.loc["busy", "cafe_room"] < 0.5


def test_the_score_is_the_weighted_mean_of_its_components():
    weights = {"residents": 2, "eating_out": 0, "daytime": 1, "room": 1}
    scored, _ = score(_wards(), weights)
    row = scored.loc["middling"]
    expected = 100 * (2 * row["residents"] + 1 * row["daytime"] + 1 * row["cafe_room"]) / 4
    assert row["cafe_score"] == pytest.approx(expected)
    assert scored[["cafe_score", "fast_food_score"]].stack().between(0, 100).all()


def test_the_weights_decide_who_leads():
    crowds = {"residents": 3, "eating_out": 3, "daytime": 3, "room": 1}
    room = {"residents": 1, "eating_out": 1, "daytime": 1, "room": 5}
    assert score(_wards(), crowds)[0]["cafe_score"].idxmax() == "busy"
    assert score(_wards(), room)[0]["cafe_score"].idxmax() != "busy"


def test_the_default_weights_cover_every_component():
    assert set(WEIGHTS) == set(COMPONENTS) and sum(WEIGHTS.values()) > 0


def test_wards_with_few_outlets_are_low_confidence():
    scored, _ = score(_wards())
    assert scored["low_confidence"].tolist() == [False, False, False, True]


def test_draws_are_counted_inside_each_ward(loaded):
    conn, _ = loaded
    wards = db.wards_frame(conn)
    # Pune's offices cluster in a few wards; most wards have none.
    assert wards["offices"].sum() > 300
    assert wards.loc["PMC-02", "offices"] > wards["offices"].median()
