"""Decide what a question is about before anything writes an answer.

1. Refuse questions that aren't about opening a cafe or QSR in Pune: no
   locality named, no domain word, and nothing in the locality facts close
   to it by embedding similarity.
2. Answer structured questions ("best area for a QSR", "where are there no
   cafes yet") straight from the scores, because similarity search can't
   rank by a number.
3. Otherwise use the localities named in the question, or the ones whose
   facts are most similar to it.
"""

import re
from dataclasses import dataclass, field

import numpy as np

from localio_api.facts import DEFAULT_LENS, LENSES, Locality

# Below this cosine similarity to every locality card, a question with no
# locality name or domain word counts as off-topic. On tests/ask_cases.jsonl
# the most similar off-topic question scores 0.55, so the floor sits above
# it with room to spare; `python -m localio_api.evaluate` reports both sides.
SIMILARITY_FLOOR = 0.62

DOMAIN = re.compile(
    r"\b(caf[eé]s?|qsrs?|coffee|chai|tea|bakery|restaurants?|fast[- ]food|burgers?|pizza|outlets?|footfall|"
    r"competit\w*|eater(y|ies)|franchise|localit(y|ies)|neighbourhoods?|catchment|ratings?|reviews?|"
    r"late[- ]night|menu)\b",
    re.IGNORECASE,
)
FORMAT_WORDS = {
    "fast_food": re.compile(r"\b(qsrs?|quick[- ]service|fast[- ]food|burgers?|pizza)\b", re.IGNORECASE),
    "cafe": re.compile(r"\b(caf[eé]s?|coffee|chai|tea)\b", re.IGNORECASE),
}
LENS_WORDS = {
    "competition": re.compile(r"\b(competition|competitors?|crowded|saturat\w*|fewest)\b", re.IGNORECASE),
    "gap": re.compile(r"\b(gaps?|under[- ]?served|unmet|room for|missing)\b", re.IGNORECASE),
    "footfall": re.compile(r"\b(busy|busiest|footfall|crowds?|popular|demand)\b", re.IGNORECASE),
}
GAP = re.compile(r"\b(no|zero|without|none|missing|gaps?|untapped|not (yet )?(any|a single))\b", re.IGNORECASE)
RANKING = re.compile(
    r"\b(best|top|where (should|would|do|can|is|are)|which (area|areas|locality|localities|part|neighbourhood)|"
    r"recommend\w*|good (place|spot|area)|most promising|where to)\b",
    re.IGNORECASE,
)
REFUSAL = "I only answer questions about where to open a cafe or QSR in Pune, using Localio's data on 140 Pune wards."


@dataclass(frozen=True)
class Plan:
    kind: str  # "refuse", "about", "ranking" or "gap"
    localities: list[Locality] = field(default_factory=list)
    category: str | None = None
    lens: str = DEFAULT_LENS


def plan(question: str, localities: list[Locality], similarities: np.ndarray,
         category: str | None = None, lens: str | None = None) -> Plan:
    named = [loc for loc in localities if _mentions(question, loc)]
    if not named and not DOMAIN.search(question) and similarities.max() < SIMILARITY_FLOOR:
        return Plan("refuse")

    category = _format(question) or category
    lens = _lens(question) or (lens if lens in LENSES else DEFAULT_LENS)
    if named:
        return Plan("about", named[:3], category, lens)

    confident = [loc for loc in localities if loc.confident]
    formats = [category] if category else ["cafe", "fast_food"]
    if GAP.search(question):
        gaps = [loc for loc in confident if any(loc.count(c) == 0 for c in formats)]
        gaps.sort(key=lambda loc: -max(loc.score(c, lens) for c in formats))
        return Plan("gap", gaps[:5], category, lens)
    if RANKING.search(question):
        ranked = sorted(confident, key=lambda loc: -max(loc.score(c, lens) for c in formats))
        return Plan("ranking", ranked[:5], category, lens)

    nearest = np.argsort(-similarities)[:3]
    return Plan("about", [localities[i] for i in nearest], category, lens)


def _mentions(question: str, loc: Locality) -> bool:
    """A ward counts as named if its title or any OSM place inside it appears
    as a whole phrase ("Baner" finds the Baner Balewadi ward)."""
    names = [loc.name.split(" (PCMC")[0], *loc.aliases]
    return any(len(n) >= 4 and re.search(rf"\b{re.escape(n)}\b", question, re.IGNORECASE) for n in names)


def _format(question: str) -> str | None:
    found = [category for category, pattern in FORMAT_WORDS.items() if pattern.search(question)]
    return found[0] if len(found) == 1 else None


def _lens(question: str) -> str | None:
    return next((lens for lens, pattern in LENS_WORDS.items() if pattern.search(question)), None)
