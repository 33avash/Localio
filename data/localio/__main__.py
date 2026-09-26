"""Run the pipeline: python -m localio

Reads LOCALIO_INPUT (default seed_data/pune_cafes_qsr.csv). Exits 1 with a
message on stderr if the input is missing or any check fails.
"""

import os
import sys
from pathlib import Path

from localio.aggregate import aggregate
from localio.clean import clean
from localio.load import InputError, load_table
from localio.validate import Check, check_counts

DEFAULT_INPUT = "seed_data/pune_cafes_qsr.csv"


def main() -> int:
    input_path = Path(os.environ.get("LOCALIO_INPUT", DEFAULT_INPUT))
    print(f"localio: reading {input_path}")
    try:
        raw = load_table(input_path)
    except InputError as err:
        return _fail(str(err))

    pois, dropped = clean(raw)
    _line("rows read", len(raw))
    for reason, count in dropped.items():
        _line("dropped", f"{count}  ({reason})")

    localities = aggregate(pois)
    checks = check_counts(pois, localities)
    for check in checks:
        _report(check)

    failed = [check for check in checks if not check.ok]
    if failed:
        return _fail(f"{len(failed)} check(s) failed; no output written")
    return 0


def _fail(message: str) -> int:
    sys.stdout.flush()
    print(f"localio: {message}", file=sys.stderr)
    return 1


def _line(label: str, value: object, status: str = "") -> None:
    print(f"  {label:<14}{str(value):<32}{status}".rstrip())


def _report(check: Check) -> None:
    status = "ok" if check.ok else f"FAIL, expected {check.expected}"
    _line(check.label, check.actual, status)


if __name__ == "__main__":
    sys.exit(main())
