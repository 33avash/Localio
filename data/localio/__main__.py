"""Run the pipeline: python -m localio

Reads the committed inputs in LOCALIO_SEED (default seed_data/): the 140
PMC and PCMC wards, residents per ward, and OpenStreetMap's food and drink
outlets and context. Loads them into PostGIS (LOCALIO_DB), places every
outlet in its ward with ST_Contains, fits the capacity model, scores every
ward, and writes pois.geojson, localities.geojson and model_report.json to
LOCALIO_OUTPUT (default output/). Exits 1 with a message on stderr if an
input is missing, the database is unreachable or any check fails; nothing
is written in that case.
"""

import os
import sys
from pathlib import Path

import psycopg

from localio import CATEGORIES, db, economics, ml, sources
from localio.aggregate import aggregate
from localio.density import add_density
from localio.export import localities_collection, num, pois_collection, write_json
from localio.menu import mix, tag
from localio.opportunity import score
from localio.recommend import sentence
from localio.score import DEFAULT_WEIGHTS
from localio.validate import (Check, check_economics, check_pois, check_scores, check_sentences, check_wards,
                              hrsl_agreement)

DEFAULT_SEED = "seed_data"
DEFAULT_OUTPUT = "output"


def main() -> int:
    seed = Path(os.environ.get("LOCALIO_SEED", DEFAULT_SEED))
    output_dir = Path(os.environ.get("LOCALIO_OUTPUT", DEFAULT_OUTPUT))
    print(f"localio: reading {seed}/")
    try:
        ward_sources = sources.load_wards(seed)
        raw_pois, osm_meta = sources.load_pois(seed)
        context = sources.load_context(seed)
        bench = economics.load_benchmarks(sources.require(seed / "unit_economics.csv"))
        streets = economics.load_rent_index(sources.require(seed / "pune_rent_index.csv"))
    except sources.SourceError as err:
        return _fail(str(err))
    _line("OSM", f"{len(raw_pois):,} food and drink places, retrieved {osm_meta['retrieved']}")

    try:
        conn = db.connect()
    except psycopg.OperationalError as err:
        return _fail(f"can't reach the database ({err}); is the db service running?")
    with conn:
        db.load(conn, ward_sources, raw_pois, context)
        placement = db.assign_wards(conn)
        wards = db.wards_frame(conn)
        pois = db.pois_frame(conn)
        pcmc_places, nearest = db.pcmc_names(conn), db.nearest_places(conn)
        aliases = db.ward_places(conn)
        features = db.ward_features(conn)
        street_matches, unmatched = db.rent_streets(conn, streets)

    by_key = {w.key: w for w in ward_sources}
    wards["population_method"] = [by_key[k].population_method for k in wards.index]
    wards["hrsl_people"] = [by_key[k].hrsl_people for k in wards.index]
    wards["aliases"] = [aliases.get(k, []) for k in wards.index]
    wards, density_ranges = add_density(aggregate(wards, pois, pcmc_places, nearest))

    checks = check_wards(wards) + check_pois(pois, wards, placement)
    if not all(check.ok for check in checks):
        return _finish(checks)
    _line("HRSL", hrsl_agreement(wards))

    results = ml.run(wards, features)
    _report_model(results.report)
    scored = score(wards, results.capacity)
    city = {
        "per_10k": {key: round(float(scored[f"{key}_per_10k"].median()), 2) for key in (*CATEGORIES, "total")},
        "residents_per_outlet": round(float((scored["population"] / scored["total_pois"].replace(0, float("nan"))).median())),
    }
    scored["recommendation"] = scored.apply(sentence, axis=1, city_per_10k=city["per_10k"])

    econ = economics.model(bench, streets)
    multipliers = {tier: t["multiplier"] for tier, t in econ["rent"]["tiers"].items()}
    tiers = economics.assign_tiers(scored, street_matches, streets, multipliers)
    projections = {key: _projections(econ, results.multiplier.loc[key], scored.loc[key], tiers.loc[key], city)
                   for key in scored.index}
    checks += check_scores(scored) + check_sentences(scored["recommendation"]) + \
        check_economics(tiers, projections, econ["payback_cap"], unmatched)
    if _finish(checks):
        return 1

    econ["examples"] = economics.insight_examples({
        category: [{"name": scored.at[key, "name"], "footfall": num(results.multiplier.at[key, "p50"], 2),
                    "payback": p[category]["payback"][1] if p[category]["payback"] else None,
                    "profit": p[category]["profit"][1], "rent_burden": p[category]["rent_burden"][1],
                    "rent_tier": tiers.at[key, "rent_tier"]}
                   for key, p in projections.items() if not scored.at[key, "low_confidence"]]
        for category in CATEGORIES}, econ["rent"]["flag"])
    menu_types = tag(pois)
    vintage = {"outlets": f"OpenStreetMap, retrieved {osm_meta['retrieved']}", "wards": "2012 electoral wards",
               "population": "Census 2011 totals"}
    outputs = {
        "pois.geojson": pois_collection(pois, menu_types, scored["name"]),
        "localities.geojson": localities_collection(scored, pois, results, mix(pois, menu_types, scored.index),
                                                    DEFAULT_WEIGHTS, density_ranges, city, vintage, tiers, projections),
        "model_report.json": {**results.report, "menu_types": menu_types.value_counts().to_dict()},
        "economics.json": econ,
    }
    for filename, document in outputs.items():
        path = output_dir / filename
        write_json(document, path)
        count = (f"{len(document['features'])} features" if "features" in document
                 else "unit-economics constants and sources" if filename == "economics.json" else "model metrics")
        _line("wrote", f"{path} ({count})")
    return 0


def _projections(econ: dict, multiplier, ward, tier, city: dict) -> dict:
    """Both formats at their default size and assumptions, as the drawer
    first shows them and as the chat quotes them. Inputs are rounded as
    localities.geojson rounds them, so the browser's recomputation from
    that file gives the same figures."""
    return {category: economics.project(econ, category, economics.defaults(econ, category), {
        "multiplier": [num(multiplier[q], 2) for q in economics.QUANTILES],
        "per_10k": num(ward[f"{category}_per_10k"], 2),
        "rent_multiplier": float(tier["rent_multiplier"]),
    }, city["per_10k"][category]) for category in CATEGORIES}


def _finish(checks: list[Check]) -> int:
    """Print every check; return 1 (and say nothing gets written) if any failed."""
    for check in checks:
        _line(check.label, check.shown, "ok" if check.ok else "FAIL")
    failed = [check for check in checks if not check.ok]
    return _fail(f"{len(failed)} check(s) failed; no output written") if failed else 0


def _report_model(report: dict) -> None:
    capacity = report["capacity"]
    chosen, baseline = capacity["candidates"]["linear quantile"], capacity["candidates"]["median baseline"]
    status = "ok" if capacity["chosen"] else "note"
    _line("capacity", f"p50 MAE {chosen['mae']:.3f} vs baseline {baseline['mae']:.3f}, R² {chosen['r2']:.2f}, "
                      f"ρ {chosen['spearman']:.2f}, p10-p90 holds {chosen['coverage']:.0%} (leave one ward out)", status)
    _line("label", f"used as {'an' if capacity['label'] == 'estimate' else 'a'} {capacity['label']}", status)
    types = report["market_types"]
    _line("types", f"{types['k']} market types, silhouette {types['silhouette']:.2f}")


def _fail(message: str) -> int:
    sys.stdout.flush()
    print(f"localio: {message}", file=sys.stderr)
    return 1


def _line(label: str, value: object, status: str = "") -> None:
    print(f"  {status:<6}{label:<12}{value}")


if __name__ == "__main__":
    sys.exit(main())
