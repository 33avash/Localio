"""Shared fixtures. Tests run from data/ locally and from /app in the
container; either way the seed is in a seed_data/ folder above them."""

from pathlib import Path

import pytest

from localio.aggregate import aggregate
from localio.clean import clean
from localio.density import add_density
from localio.geo import attach, load_catchments
from localio.load import load_table


@pytest.fixture(scope="session")
def seed_dir() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "seed_data" / "pune_cafes_qsr.csv").is_file():
            return parent / "seed_data"
    raise FileNotFoundError("seed_data/ not found above the tests")


@pytest.fixture(scope="session")
def raw(seed_dir):
    return load_table(seed_dir / "pune_cafes_qsr.csv")


@pytest.fixture(scope="session")
def pois(raw):
    return clean(raw)[0]


@pytest.fixture(scope="session")
def localities(pois, seed_dir):
    joined = attach(aggregate(pois), load_catchments(seed_dir / "catchments.geojson"))
    return add_density(joined)[0]
