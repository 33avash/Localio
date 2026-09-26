import pandas as pd
import pytest

from localio.clean import clean
from localio.load import InputError, load_table


def test_missing_file_is_a_clear_error(tmp_path):
    with pytest.raises(InputError, match="not found"):
        load_table(tmp_path / "nope.csv")


def test_missing_columns_are_named(tmp_path):
    path = tmp_path / "thin.csv"
    pd.DataFrame({"name": ["x"]}).to_csv(path, index=False)
    with pytest.raises(InputError, match="missing required columns: poi_id"):
        load_table(path)


def test_clean_drops_only_the_blank_row(raw):
    pois, dropped = clean(raw)
    assert len(raw) == 260
    assert len(pois) == 259
    assert sum(dropped.values()) == 1


def test_numbers_are_numbers(pois):
    for column in ("latitude", "review_count", "price_level", "daily_open_hours", "is_late_night"):
        assert pd.api.types.is_numeric_dtype(pois[column]), column
