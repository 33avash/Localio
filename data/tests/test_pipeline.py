"""The whole pipeline, as `python -m localio` runs it, against PostGIS."""

import csv
import shutil

from localio.__main__ import main

OUTPUTS = ("pois.geojson", "localities.geojson", "model_report.json")


def _run(monkeypatch, tmp_path, seed):
    monkeypatch.setenv("LOCALIO_SEED", str(seed))
    monkeypatch.setenv("LOCALIO_OUTPUT", str(tmp_path / "out"))
    return main()


def _copy_seed(seed_dir, tmp_path):
    copy = tmp_path / "seed"
    shutil.copytree(seed_dir, copy)
    return copy


def test_clean_run_writes_all_three_files(monkeypatch, tmp_path, seed_dir):
    assert _run(monkeypatch, tmp_path, seed_dir) == 0
    assert all((tmp_path / "out" / name).is_file() for name in OUTPUTS)


def test_an_oversized_ward_fails_and_writes_nothing(monkeypatch, tmp_path, seed_dir):
    seed = _copy_seed(seed_dir, tmp_path)
    path = seed / "ward_population.csv"
    rows = list(csv.DictReader(path.open(encoding="utf-8")))
    rows[0]["population"] = "250000"
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    assert _run(monkeypatch, tmp_path, seed) == 1
    assert not (tmp_path / "out").exists()


def test_a_missing_input_fails(monkeypatch, tmp_path, seed_dir):
    seed = _copy_seed(seed_dir, tmp_path)
    (seed / "osm_context.json").unlink()
    assert _run(monkeypatch, tmp_path, seed) == 1
    assert not (tmp_path / "out").exists()
