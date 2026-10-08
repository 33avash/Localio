"""The source registry: every dataset documented, and OpenStreetMap's dates
taken from the cached files rather than typed in twice."""

import json
import shutil

import pytest

from localio import sources
from localio.validate import check_sources


def _cached(seed_dir):
    _, osm_meta = sources.load_pois(seed_dir)
    return {"osm_raw.json": osm_meta, "osm_context.json": sources.load_context(seed_dir)["meta"]}


def test_every_dataset_has_every_field(seed_dir):
    registry = sources.load_registry(seed_dir, _cached(seed_dir))
    assert {entry["id"] for entry in registry} >= {"wards", "population", "outlets", "context", "rent_streets",
                                                    "rent_listings", "benchmarks"}
    assert check_sources(registry)[0].ok


def test_osm_dates_come_from_the_cached_files(seed_dir):
    cached = _cached(seed_dir)
    registry = {entry["id"]: entry for entry in sources.load_registry(seed_dir, cached)}
    assert registry["outlets"]["retrieved_at"] == cached["osm_raw.json"]["retrieved"]
    assert registry["context"]["as_of"] == cached["osm_context.json"]["retrieved"]


def test_a_blank_field_or_a_repeated_id_fails():
    entry = {field: "x" for field in sources.REGISTRY_FIELDS}
    assert not check_sources([{**entry, "licence": " "}])[0].ok
    assert not check_sources([entry, dict(entry)])[0].ok


def test_a_date_from_an_unknown_file_is_a_clear_error(tmp_path, seed_dir):
    seed = tmp_path / "seed"
    seed.mkdir()
    registry = json.loads((seed_dir / "sources.json").read_text(encoding="utf-8"))
    registry["sources"][0]["as_of"] = "from nowhere.json"
    (seed / "sources.json").write_text(json.dumps(registry), encoding="utf-8")
    with pytest.raises(sources.SourceError, match="unknown file"):
        sources.load_registry(seed, _cached(seed_dir))


def test_a_missing_registry_fails_the_load(tmp_path, seed_dir):
    seed = tmp_path / "seed"
    shutil.copytree(seed_dir, seed)
    (seed / "sources.json").unlink()
    with pytest.raises(sources.SourceError, match="sources.json not found"):
        sources.load_registry(seed, _cached(seed_dir))
