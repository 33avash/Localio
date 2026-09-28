"""Turn the pipeline's wards.geojson and rent.json into facts the chat can cite.

Each of the 140 wards becomes one short card of plain sentences built from
its numbers. The card is what gets embedded for retrieval and what the
language model is allowed to use, so an answer can only repeat figures the
pipeline produced.
"""

import json
from dataclasses import dataclass
from pathlib import Path

FORMATS = {"cafe": ("cafe", "cafes"), "fast_food": ("QSR", "QSRs")}

# The same three priorities as data/localio/score.py and web/static/js/score.js.
LENSES = {
    "busy": {"name": "busy areas", "weights": {"demand": 0.8, "competition": 0.2}},
    "balanced": {"name": "a balance of footfall and competition", "weights": {"demand": 0.5, "competition": 0.5}},
    "quiet": {"name": "low competition", "weights": {"demand": 0.2, "competition": 0.8}},
}
DEFAULT_LENS = "balanced"


@dataclass(frozen=True)
class Ward:
    name: str
    aliases: tuple[str, ...]
    confident: bool
    properties: dict
    rent: str
    card: str

    def score(self, category: str, lens: str = DEFAULT_LENS) -> float:
        w = LENSES[lens]["weights"]
        competition = self.properties["categories"][category]["competition"]
        return 100 * (w["demand"] * self.properties["demand"] + w["competition"] * (1 - competition))

    def count(self, category: str) -> int:
        return self.properties["categories"][category]["count"]


def load(data: Path) -> list[Ward]:
    """data is the pipeline's output directory."""
    wards = json.loads((data / "wards.geojson").read_text(encoding="utf-8"))
    rent = json.loads((data / "rent.json").read_text(encoding="utf-8"))
    return [_ward(feature["properties"], rent, wards["meta"]["min_outlets"]) for feature in wards["features"]]


def _ward(p: dict, rent: dict, min_outlets: int) -> Ward:
    confident = p["status"] == "scored"
    monthly = round(rent["typical_psf"] * p["rent"]["multiplier"] * rent["default_sqft"])
    estimated = " (estimated from its zone)" if p["rent"]["estimated"] else ""
    rent_text = (f"Rent is {p['rent']['tier']} tier{estimated}: about {rupees(monthly)} a month for a "
                 f"{rent['default_sqft']} sq ft shop.")
    return Ward(p["name"], tuple(p["aliases"]), confident, p, rent_text, card(p, confident, rent_text, min_outlets))


def rupees(value: float) -> str:
    """As the map writes them: ₹45k, ₹4.2L."""
    if value >= 1e5:
        return f"₹{value / 1e5:.1f}L"
    return f"₹{round(value / 1e3)}k" if value >= 1e3 else f"₹{round(value)}"


def card(p: dict, confident: bool, rent_text: str, min_outlets: int) -> str:
    places = f" It takes in {', '.join(p['aliases'][:5])}." if p["aliases"] else ""
    draws = p["draws"]
    sentences = [
        f"{p['name']} is {p['corporation']} ward {p['ward_number']}, with {p['population']:,} residents and "
        f"{p['total_pois']} food and drink outlets.{places}"
        + ("" if confident else f" It has fewer than {min_outlets} outlets, so its scores are low confidence."),
        f"Its demand index is {p['demand']:.2f} out of 1, from how densely people live, eat out, work, study "
        f"and travel there; it has {draws['offices']} offices, {draws['colleges']} colleges and "
        f"{draws['stations']} stations.",
    ]
    for category, (_, many) in FORMATS.items():
        stats = p["categories"][category]
        sentences.append(f"It has {stats['count']} {many} ({stats['per_10k']:.2f} per 10,000 residents).")
    sentences.append(rent_text)
    top_menu = sorted(p["menu"].items(), key=lambda item: -item[1])[:3]
    if top_menu:
        sentences.append("Most common menus: " + ", ".join(f"{kind.lower()} {share:.0%}" for kind, share in top_menu) + ".")
    sentences.append(p["recommendation"])
    return " ".join(sentences)
