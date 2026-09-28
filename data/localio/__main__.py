"""Run the pipeline: python -m localio

Reads LOCALIO_INPUT (default seed_data/pune_cafes_qsr.csv) and
LOCALIO_CATCHMENTS (default seed_data/catchments.geojson), and writes
pois.geojson, localities.geojson and model_report.json to LOCALIO_OUTPUT
(default output/). Exits 1 with a message on stderr if the input is
missing or any check fails; nothing is written in that case.
"""

import os
import sys
from pathlib import Path

from localio import CATEGORIES, ml
from localio.aggregate import aggregate
from localio.clean import clean
from localio.density import add_density
from localio.export import localities_collection, pois_collection, write_json
from localio.geo import CatchmentError, attach, load_catchments
from localio.load import InputError, load_table
from localio.menu import mix, tag
from localio.opportunity import score_v2
from localio.recommend import sentence
from localio.score import DEFAULT_WEIGHTS, score
from localio.validate import (
    Check,
    check_catchments,
    check_counts,
    check_menu,
    check_scores,
    check_sentences,
    check_v2,
)

DEFAULT_INPUT = "seed_data/pune_cafes_qsr.csv"
DEFAULT_CATCHMENTS = "seed_data/catchments.geojson"
DEFAULT_OUTPUT = "output"


def main() -> int:
    input_path = Path(os.environ.get("LOCALIO_INPUT", DEFAULT_INPUT))
    catchments_path = Path(os.environ.get("LOCALIO_CATCHMENTS", DEFAULT_CATCHMENTS))
    output_dir = Path(os.environ.get("LOCALIO_OUTPUT", DEFAULT_OUTPUT))
    print(f"localio: reading {input_path}")
    try:
        raw = load_table(input_path)
        catchments = load_catchments(catchments_path)
    except (InputError, CatchmentError) as err:
        return _fail(str(err))

    pois, dropped = clean(raw)
    _line("rows read", len(raw))
    for reason, count in dropped.items():
        _line("dropped", f"{count}  ({reason})")

    localities, density_ranges = add_density(attach(aggregate(pois), catchments))
    checks = check_counts(pois, localities) + check_catchments(localities)
    if not all(check.ok for check in checks):
        return _finish(checks)

    # v1's heuristic score is kept only as a check on the aggregation: its
    # top 3 are known, so a wrong join shows up here before anything else.
    checks += check_scores(score(localities, DEFAULT_WEIGHTS))

    menu_types = tag(pois)
    results = ml.run(pois, localities)
    _report_model(results.report)
    scored = score_v2(localities, results.demand)
    city = {
        "per_10k": {key: round(float(scored[f"{key}_per_10k"].median()), 2) for key in (*CATEGORIES, "total")},
        "residents_per_outlet": round(float((scored["population"] / scored["total_pois"]).median())),
    }
    scored["recommendation"] = scored.apply(sentence, axis=1, city_per_10k=city["per_10k"])
    checks += check_v2(scored) + check_menu(menu_types) + check_sentences(scored["recommendation"])
    if not all(check.ok for check in checks):
        return _finish(checks)
    _finish(checks)

    outputs = {
        "pois.geojson": pois_collection(pois, menu_types),
        "localities.geojson": localities_collection(
            scored, pois, results, mix(pois, menu_types), DEFAULT_WEIGHTS, density_ranges, city),
        "model_report.json": {**results.report, "menu_types": menu_types.value_counts().to_dict()},
    }
    for filename, document in outputs.items():
        path = output_dir / filename
        write_json(document, path)
        count = f"{len(document['features'])} features" if "features" in document else "model metrics"
        _line("wrote", f"{path} ({count})")
    return 0


def _finish(checks: list[Check]) -> int:
    """Print every check; return 1 (and say nothing gets written) if any failed."""
    for check in checks:
        _report(check)
    failed = [check for check in checks if not check.ok]
    return _fail(f"{len(failed)} check(s) failed; no output written") if failed else 0


def _report_model(report: dict) -> None:
    footfall = report["footfall"]
    metrics = footfall["candidates"]
    chosen, baseline = metrics["ridge"], metrics["median baseline"]
    status = "ok" if footfall["chosen"] else "note"
    _line("footfall", f"ridge MAE {chosen['mae']:.2f} vs baseline {baseline['mae']:.2f}, "
                      f"R² {chosen['r2']:.2f}, ρ {chosen['spearman']:.2f} on held-out localities", status)
    _line("demand", footfall["demand_source"], status)
    types = report["market_types"]
    _line("types", f"{types['k']} market types, silhouette {types['silhouette']:.2f}")


def _fail(message: str) -> int:
    sys.stdout.flush()
    print(f"localio: {message}", file=sys.stderr)
    return 1


def _line(label: str, value: object, status: str = "") -> None:
    print(f"  {status:<6}{label:<12}{value}")


def _report(check: Check) -> None:
    if check.ok:
        _line(check.label, check.shown or check.actual, "ok")
    else:
        expected = ", ".join(check.expected) if isinstance(check.expected, list) else check.expected
        _line(check.label, f"{check.shown or check.actual}  (expected {expected})", "FAIL")


if __name__ == "__main__":
    sys.exit(main())
