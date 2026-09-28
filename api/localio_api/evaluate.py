"""Score the chat's planning on the labelled questions: python -m localio_api.evaluate

For each question in tests/ask_cases.jsonl it checks that off-topic ones
are refused and that on-topic ones cite at least one expected locality.
It also prints the best and worst similarity scores on each side of the
refusal threshold, which is how SIMILARITY_FLOOR was chosen.
"""

import json
import sys
from pathlib import Path

from localio_api import facts
from localio_api.main import DATA, Embedder
from localio_api.plan import SIMILARITY_FLOOR, plan

CASES = Path(__file__).resolve().parent.parent / "tests" / "ask_cases.jsonl"


def evaluate() -> dict:
    localities = facts.load(DATA)
    embedder = Embedder()
    cards = embedder.documents([loc.card for loc in localities])
    cases = [json.loads(line) for line in CASES.read_text(encoding="utf-8").splitlines() if line.strip()]

    results, misses = {"refusals": [0, 0], "citations": [0, 0]}, []
    top_similarity = {"in scope": [], "off topic": []}
    for case in cases:
        similarities = cards @ embedder.query(case["question"])
        decided = plan(case["question"], localities, similarities, case.get("category"))
        cited = {loc.name for loc in decided.localities}
        if case["expect"] == "refuse":
            ok = decided.kind == "refuse"
            results["refusals"][0] += ok
            results["refusals"][1] += 1
            top_similarity["off topic"].append(float(similarities.max()))
        else:
            ok = decided.kind != "refuse" and bool(cited & set(case["expect"]))
            results["citations"][0] += ok
            results["citations"][1] += 1
            top_similarity["in scope"].append(float(similarities.max()))
        if not ok:
            misses.append(f"{case['question']!r}: planned {decided.kind} {sorted(cited)}, expected {case['expect']}")
    return {"results": results, "misses": misses, "similarity": top_similarity}


def main() -> int:
    report = evaluate()
    refused, off_topic = report["results"]["refusals"]
    hits, on_topic = report["results"]["citations"]
    sims = report["similarity"]
    print(f"off-topic refused      {refused}/{off_topic}")
    print(f"on-topic cite expected {hits}/{on_topic}")
    print(f"similarity floor       {SIMILARITY_FLOOR}  (off-topic max {max(sims['off topic']):.3f}, "
          f"on-topic min {min(sims['in scope']):.3f})")
    for miss in report["misses"]:
        print(f"  miss: {miss}")
    return 0 if not report["misses"] else 1


if __name__ == "__main__":
    sys.exit(main())
