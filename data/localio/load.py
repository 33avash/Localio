"""Read the seed table from a .csv or .xlsx file, every column as text."""

from pathlib import Path

import pandas as pd

REQUIRED_COLUMNS = (
    "poi_id",
    "name",
    "category",
    "is_chain_outlet",
    "locality",
    "latitude",
    "longitude",
    "avg_rating",
    "review_count",
)


class InputError(Exception):
    """The input file is missing, unreadable or lacks required columns."""


def load_table(path: Path) -> pd.DataFrame:
    if not path.is_file():
        raise InputError(f"input file not found: {path}")

    suffix = path.suffix.lower()
    if suffix == ".csv":
        table = _read_csv(path)
    elif suffix == ".xlsx":
        table = pd.read_excel(path, dtype=str)
    else:
        raise InputError(f"unsupported file type '{suffix}' for {path}; expected .csv or .xlsx")

    missing = [col for col in REQUIRED_COLUMNS if col not in table.columns]
    if missing:
        raise InputError(f"{path.name} is missing required columns: {', '.join(missing)}")
    return table


def _read_csv(path: Path) -> pd.DataFrame:
    try:
        return pd.read_csv(path, dtype=str, encoding="utf-8")
    except UnicodeDecodeError:
        return pd.read_csv(path, dtype=str, encoding="latin-1")
