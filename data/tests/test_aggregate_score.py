import numpy as np
import pandas as pd

from localio import CATEGORIES
from localio.density import _classes
from localio.score import DEFAULT_WEIGHTS, ranked, safe_minmax, score


def test_every_outlet_lands_in_one_locality(pois, localities):
    assert len(localities) == 51
    assert localities["total_pois"].sum() == len(pois) == 259
    assert sum(localities[f"{c}_count"].sum() for c in CATEGORIES) == 259


def test_safe_minmax_handles_a_flat_series():
    assert safe_minmax(pd.Series([3.0, 3.0, 3.0])).tolist() == [0.0, 0.0, 0.0]
    assert safe_minmax(pd.Series([1.0, 3.0])).tolist() == [0.0, 1.0]


def test_v1_top3_still_matches(localities):
    scored = score(localities, DEFAULT_WEIGHTS)
    assert list(ranked(scored, "cafe").head(3).index) == ["Deccan Gymkhana", "Wakad", "Shivajinagar"]


def test_density_keeps_zero_as_its_own_class():
    classes = _classes(pd.Series([0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.0]))
    assert classes.iloc[0] == 0 and classes.iloc[-1] == 0
    assert set(classes.iloc[1:6]) == {1, 2, 3, 4, 5}


def test_density_survives_all_zero_values():
    assert _classes(pd.Series([0.0, 0.0])).tolist() == [0, 0]


def test_every_catchment_has_people(localities):
    assert (localities["population"] > 0).all()
    assert np.isfinite(localities["total_per_10k"]).all()
