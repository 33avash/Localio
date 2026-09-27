"""Turn the pipeline's localities.geojson into facts the chat can cite.

Each of the 140 wards becomes one short card of plain sentences built from
its numbers. The card is what gets embedded for retrieval and what the
language model is allowed to use, so an answer can only ever repeat
figures the pipeline produced.
"""

import json
from dataclasses import dataclass
from pathlib import Path

FORMATS = {"cafe": ("cafe", "cafes"), "fast_food": ("QSR", "QSRs")}

# The same three lenses as web/static/js/score.js.
LENSES = {
    "competition": {"name": "low competition", "weights": {"demand": 0.30, "supply": 0.55, "gap": 0.15}},
    "footfall": {"name": "proven footfall", "weights": {"demand": 0.60, "supply": 0.28, "gap": 0.12}},
    "gap": {"name": "unmet demand", "weights": {"demand": 0.35, "supply": 0.30, "gap": 0.35}},
}
DEFAULT_LENS = "footfall"


@dataclass(frozen=True)
class Locality:
    name: str
    aliases: tuple[str, ...]
    confident: bool
    properties: dict
    card: str

    def score(self, category: str, lens: str = DEFAULT_LENS) -> float:
        stats = self.properties["categories"][category]
        w = LENSES[lens]["weights"]
        return 100 * (w["demand"] * stats["demand_n"] - w["supply"] * stats["supply_n"] + w["gap"] * stats["gap_n"])

    def count(self, category: str) -> int:
        return self.properties["categories"][category]["count"]


def load(path: Path) -> list[Locality]:
    features = json.loads(path.read_text(encoding="utf-8"))["features"]
    return [_locality(feature["properties"]) for feature in features]


def _locality(p: dict) -> Locality:
    confident = p["status"] == "scored"
    return Locality(p["name"], tuple(p["aliases"]), confident, p, card(p, confident))


def card(p: dict, confident: bool) -> str:
    places = f" It takes in {', '.join(p['aliases'][:5])}." if p["aliases"] else ""
    sentences = [
        f"{p['name']} is {p['corporation']} ward {p['ward_number']}, a {p['market_type'].lower()} "
        f"with {p['population']:,} residents and {p['total_pois']} food and drink outlets.{places}"
        + ("" if confident else " It has fewer than 4 outlets, so its scores are low confidence."),
    ]
    for category, (one, many) in FORMATS.items():
        stats = p["categories"][category]
        sentences.append(f"It has {stats['count']} {many} ({stats['per_10k']:.2f} per 10,000 residents).")
    low, mid, high = p["capacity"]["multiplier"]
    expected = round(p["total_pois"] + p["capacity"]["gap"])
    sentences.append(f"Its surroundings support {mid:.1f} times the city's median ward (80% range {low:.1f} to "
                     f"{high:.1f}); wards like it hold about {expected} outlets.")
    top_menu = sorted(p["menu"].items(), key=lambda item: -item[1])[:3]
    if top_menu:
        sentences.append("Most common menus: " + ", ".join(f"{kind.lower()} {share:.0%}" for kind, share in top_menu) + ".")
    sentences.append("Similar wards: " + ", ".join(p["similar"]) + ".")
    sentences.append(p["recommendation"])
    return " ".join(sentences)
