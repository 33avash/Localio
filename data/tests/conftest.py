"""Shared fixtures. The tests run inside the data container (docker compose
run --rm data python -m pytest tests), where the db service is PostGIS and
seed_data/ is mounted at /app/seed_data."""

from pathlib import Path

import pytest

from localio import db, sources


@pytest.fixture(scope="session")
def seed_dir() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "seed_data" / "osm_raw.json").is_file():
            return parent / "seed_data"
    raise FileNotFoundError("seed_data/ not found above the tests")


@pytest.fixture(scope="session")
def wards(seed_dir):
    return sources.load_wards(seed_dir)


@pytest.fixture
def conn():
    with db.connect() as connection:
        yield connection


@pytest.fixture
def loaded(conn, seed_dir, wards):
    """The real seed data in PostGIS, with every outlet placed in its ward."""
    pois, _ = sources.load_pois(seed_dir)
    db.load(conn, wards, pois, sources.load_context(seed_dir))
    placement = db.assign_wards(conn)
    return conn, placement
