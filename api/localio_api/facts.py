"""Turn the pipeline's localities.geojson into facts the chat can cite.

Each locality becomes one short card of plain sentences built from its
numbers. The card is what gets embedded for retrieval and what the
language model is allowed to use, so an answer can only ever repeat
figures the pipeline produced.
"""

import json
from dataclasses import dataclass
from pathlib import Path

FORMATS = {"cafe": ("cafe", "cafes"), "fast_food": ("QSR", "QSRs")}

# The same three lenses as web/static/js/score.js.
LENSES = {
    "competition": {"name": "low competition", "weights": {"demand": 0.30, "supply": 0.55, "weakness": 0.15}},
    "footfall": {"name": "proven footfall", "weights": {"demand": 0.60, "supply": 0.28, "weakness": 0.12}},
    "incumbents": {"name": "weak incumbents", "weights": {"demand": 0.35, "supply": 0.30, "weakness": 0.35}},
}
DEFAULT_LENS = "footfall"


@dataclass(frozen=True)
class Locality:
    name: str
    confident: bool
    properties: dict
    card: str

    def score(self, category: str, lens: str = DEFAULT_LENS) -> float:
        stats = self.properties["categories"][category]
        w = LENSES[lens]["weights"]
        return 100 * (w["demand"] * stats["demand_n"] - w["supply"] * stats["supply_n"] + w["weakness"] * stats["weakness_n"])

    def count(self, category: str) -> int:
        return self.properties["categories"][category]["count"]


def load(path: Path) -> list[Locality]:
    features = json.loads(path.read_text(encoding="utf-8"))["features"]
    return [_locality(feature["properties"]) for feature in features]


def _locality(p: dict) -> Locality:
    confident = p["status"] == "scored"
    return Locality(p["name"], confident, p, card(p, confident))


def card(p: dict, confident: bool) -> str:
    sentences = [
        f"{p['name']} is a {p['market_type'].lower()} locality with {p['population']:,} residents "
        f"and {p['total_pois']} cafes and QSRs."
        + ("" if confident else " It has fewer than 4 outlets, so its scores are low confidence."),
    ]
    for category, (one, many) in FORMATS.items():
        stats = p["categories"][category]
        rating = f", rated {stats['avg_rating']:.1f} stars on average" if stats["avg_rating"] is not None else ""
        estimate = stats["footfall"]
        sentences.append(
            f"It has {stats['count']} {many} ({stats['per_10k']:.2f} per 10,000 residents{rating}). "
            f"A new {one} there would collect about {estimate['reviews']:,} reviews "
            f"(80% range {estimate['low']:,} to {estimate['high']:,})."
        )
    top_menu = sorted(p["menu"].items(), key=lambda item: -item[1])[:3]
    sentences.append("Most common menus: " + ", ".join(f"{kind.lower()} {share:.0%}" for kind, share in top_menu) + ".")
    sentences.append(f"{p['late_night_share']:.0%} of its outlets stay open late.")
    sentences.append("Similar localities: " + ", ".join(p["similar"]) + ".")
    sentences.append(p["recommendation"])
    return " ".join(sentences)
