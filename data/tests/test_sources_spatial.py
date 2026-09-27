import shutil

import pytest
from shapely.geometry import box

from localio import db, sources
from localio.sources import Ward


def test_140_wards_with_pcmc_split_wards_merged(wards):
    by_corp = {corp: [w for w in wards if w.corporation == corp] for corp in ("PMC", "PCMC")}
    assert len(by_corp["PMC"]) == 76 and len(by_corp["PCMC"]) == 64
    # Ward 58 arrives as two polygons ("58_1", "58_2") and must come out as one ward.
    assert [w.number for w in by_corp["PCMC"]].count(58) == 1


def test_every_ward_has_residents(wards):
    assert all(w.population > 0 for w in wards)


def test_missing_osm_cache_is_a_clear_error(tmp_path, seed_dir):
    shutil.copytree(seed_dir / "wards", tmp_path / "wards")
    with pytest.raises(sources.SourceError, match="docker compose run --rm osm"):
        sources.load_pois(tmp_path)


def _ward(key, geom):
    return Ward(key, "PMC", int(key[-2:]), key, "Test", 1000, "test", 0, geom)


def test_outlets_are_placed_by_containment_not_by_name(conn):
    wards = [_ward("PMC-01", box(73.80, 18.50, 73.81, 18.51)), _ward("PMC-02", box(73.81, 18.50, 73.82, 18.51))]
    pois = [
        {"id": "node/1", "amenity": "cafe", "format": "cafe", "name": "Cafe in PMC-02 by name only", "brand": "",
         "cuisine": "", "opening_hours": "", "lon": 73.805, "lat": 18.505},
        {"id": "node/2", "amenity": "cafe", "format": "cafe", "name": "", "brand": "", "cuisine": "",
         "opening_hours": "", "lon": 73.815, "lat": 18.505},
        {"id": "node/3", "amenity": "cafe", "format": "cafe", "name": "", "brand": "", "cuisine": "",
         "opening_hours": "", "lon": 73.90, "lat": 18.60},
    ]
    context = {"places": [], "colleges": [], "offices": [], "stations": [], "classified_roads": [],
               "road_grid": {"cell_m": 250, "cells": []}}
    db.load(conn, wards, pois, context)
    placement = db.assign_wards(conn)
    placed = dict(conn.execute("SELECT id, ward FROM pois ORDER BY id").fetchall())
    assert placed == {"node/1": "PMC-01", "node/2": "PMC-02", "node/3": None}
    assert placement == {"outside": 1, "in_two_wards": 0}


def test_real_data_places_most_outlets_and_none_twice(loaded):
    _, placement = loaded
    assert placement["in_two_wards"] == 0
    assert placement["outside"] < 400
