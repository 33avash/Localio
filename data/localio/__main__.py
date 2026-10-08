"""Run the pipeline: python -m localio

1. Read the committed inputs in LOCALIO_SEED (default seed_data/).
2. Load them into PostGIS (LOCALIO_DB) and place every outlet in its ward
   with ST_Contains.
3. Count outlets per ward, per 10,000 residents, and score every ward.
4. Give every ward a rent tier and a one-sentence recommendation.
5. Check everything, then write pois.geojson, wards.geojson and rent.json
   to LOCALIO_OUTPUT (default output/).

Exits 1 with a message if an input is missing, the database is unreachable
or any check fails. Nothing is written in that case, and the web container
never starts, so the site can't show bad numbers.
"""

import os
import sys
from pathlib import Path

import psycopg

from localio import db, rent, sources
from localio.aggregate import aggregate
from localio.density import add_density
from localio.export import pois_collection, wards_collection, write_json
from localio.menu import mix, tag
from localio.recommend import sentence
from localio.score import score
from localio.validate import Check, check_pois, check_rent, check_scores, check_sentences, check_sources, check_wards


def main() -> int:
    seed = Path(os.environ.get("LOCALIO_SEED", "seed_data"))
    output_dir = Path(os.environ.get("LOCALIO_OUTPUT", "output"))
    print(f"localio: reading {seed}/")
    try:
        ward_sources = sources.load_wards(seed)
        raw_pois, osm_meta = sources.load_pois(seed)
        context = sources.load_context(seed)
        streets = rent.load_streets(sources.load_csv(seed / "rent_high_streets.csv"))
        listings = sources.load_csv(seed / "rent_listings.csv")
        benchmarks = {r["key"]: r for r in sources.load_csv(seed / "rent_benchmarks.csv")}
        registry = sources.load_registry(seed, {"osm_raw.json": osm_meta, "osm_context.json": context["meta"]})
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
        aliases, suburbs, nearest = db.ward_places(conn), db.suburbs(conn), db.nearest_places(conn)
        street_matches, unmatched = db.rent_streets(conn, streets)

    method = {w.key: w.population_method for w in ward_sources}
    wards["population_method"] = [method[k] for k in wards.index]
    wards["aliases"] = [aliases.get(k, []) for k in wards.index]
    wards, density_ranges = add_density(aggregate(wards, pois, suburbs, nearest))

    checks = check_wards(wards) + check_pois(pois, wards, placement)
    if not all(check.ok for check in checks):
        return _finish(checks)

    scored, reference = score(wards)
    reference = {c: round(value, 2) for c, value in reference.items()}
    _line("reference", ", ".join(f"{value} {c} per 10k" for c, value in reference.items())
          + f" (the {int((~scored['low_confidence']).sum())} well-mapped wards)")
    scored["recommendation"] = scored.apply(sentence, axis=1, reference=reference)
    factor = rent.multipliers(streets, float(benchmarks["emerging_multiplier"]["low"]))
    tiers = rent.assign_tiers(scored, street_matches, streets, factor)
    checks += (check_scores(scored) + check_sentences(scored["recommendation"]) + check_rent(tiers, unmatched)
               + check_sources(registry))
    if _finish(checks):
        return 1

    menu_types = tag(pois)
    vintage = {"outlets": f"OpenStreetMap, retrieved {osm_meta['retrieved']}", "wards": "2012 electoral wards",
               "population": "Census 2011 totals"}
    outputs = {
        "pois.geojson": pois_collection(pois, menu_types, scored["name"]),
        "wards.geojson": wards_collection(scored, pois, mix(pois, menu_types, scored.index), tiers,
                                          density_ranges, reference, vintage, registry),
        "rent.json": rent.summary(rent.typical_rent(listings), factor, streets, benchmarks, listings),
    }
    for filename, document in outputs.items():
        path = output_dir / filename
        write_json(document, path)
        _line("wrote", f"{path}" + (f" ({len(document['features'])} features)" if "features" in document else ""))
    return 0


def _finish(checks: list[Check]) -> int:
    """Print every check; return 1 (and say nothing gets written) if any failed."""
    for check in checks:
        _line(check.label, check.shown, "ok" if check.ok else "FAIL")
    failed = [check for check in checks if not check.ok]
    return _fail(f"{len(failed)} check(s) failed; no output written") if failed else 0


def _fail(message: str) -> int:
    sys.stdout.flush()
    print(f"localio: {message}", file=sys.stderr)
    return 1


def _line(label: str, value: object, status: str = "") -> None:
    print(f"  {status:<6}{label:<12}{value}")


if __name__ == "__main__":
    sys.exit(main())
