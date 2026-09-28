"""The whole pipeline, as `python -m localio` runs it."""

import pandas as pd

from localio.__main__ import main

OUTPUTS = ("pois.geojson", "localities.geojson", "model_report.json")


def _run(monkeypatch, tmp_path, seed, catchments):
    monkeypatch.setenv("LOCALIO_INPUT", str(seed))
    monkeypatch.setenv("LOCALIO_CATCHMENTS", str(catchments))
    monkeypatch.setenv("LOCALIO_OUTPUT", str(tmp_path / "out"))
    return main()


def test_clean_run_writes_all_three_files(monkeypatch, tmp_path, seed_dir):
    code = _run(monkeypatch, tmp_path, seed_dir / "pune_cafes_qsr.csv", seed_dir / "catchments.geojson")
    assert code == 0
    assert all((tmp_path / "out" / name).is_file() for name in OUTPUTS)


def test_tampered_seed_fails_and_writes_nothing(monkeypatch, tmp_path, seed_dir):
    seed = pd.read_csv(seed_dir / "pune_cafes_qsr.csv", dtype=str)
    tampered = tmp_path / "tampered.csv"
    seed.iloc[5:].to_csv(tampered, index=False)
    code = _run(monkeypatch, tmp_path, tampered, seed_dir / "catchments.geojson")
    assert code == 1
    assert not (tmp_path / "out").exists()


def test_missing_catchments_fails(monkeypatch, tmp_path, seed_dir):
    code = _run(monkeypatch, tmp_path, seed_dir / "pune_cafes_qsr.csv", tmp_path / "missing.geojson")
    assert code == 1
