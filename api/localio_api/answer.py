"""Write the answer: Gemini when a key is set, templates otherwise.

Either way the answer draws only on the planned wards' fact cards, and it
cites only those wards. Gemini's reply is checked: any
citation outside the plan is dropped, and an answer left with no
citation falls back to the template.
"""

import json
import logging

import httpx

from localio_api.facts import FORMATS, LENSES
from localio_api.plan import REFUSAL, Plan

log = logging.getLogger("localio.ask")

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
TIMEOUT_S = 12

INSTRUCTIONS = (
    "You answer questions about where to open a cafe or quick-service restaurant (QSR) in Pune. "
    "Use only the facts given below; never add numbers or places that aren't in them. "
    "Answer in at most three short sentences, plainly, with the figures that matter. "
    "List in 'cited' exactly the ward names your answer relies on, spelled as in the facts."
)
SCHEMA = {
    "type": "OBJECT",
    "properties": {"answer": {"type": "STRING"}, "cited": {"type": "ARRAY", "items": {"type": "STRING"}}},
    "required": ["answer", "cited"],
}


def respond(question: str, plan: Plan, gemini_key: str | None, model: str) -> dict:
    if plan.kind == "refuse":
        return {"answer": REFUSAL, "cited": [], "refused": True, "mode": "rules"}
    if not plan.wards:
        return {"answer": empty(plan), "cited": [], "refused": False, "mode": "offline"}
    if gemini_key:
        written = gemini(question, plan, gemini_key, model)
        if written:
            return {**written, "refused": False, "mode": "gemini"}
    return {"answer": template(plan), "cited": [ward.name for ward in plan.wards], "refused": False, "mode": "offline"}


def gemini(question: str, plan: Plan, key: str, model: str) -> dict | None:
    facts = "\n".join(f"- {ward.card}" for ward in plan.wards)
    context = f"Format asked about: {FORMATS[plan.category][0] if plan.category else 'either'}. " \
              f"Ranking lens: {LENSES[plan.lens]['name']}."
    body = {
        "systemInstruction": {"parts": [{"text": INSTRUCTIONS}]},
        "contents": [{"role": "user", "parts": [{"text": f"{context}\n\nFacts:\n{facts}\n\nQuestion: {question}"}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 400,
                             "responseMimeType": "application/json", "responseSchema": SCHEMA},
    }
    try:
        response = httpx.post(GEMINI_URL.format(model=model), json=body, headers={"x-goog-api-key": key},
                              timeout=TIMEOUT_S)
        response.raise_for_status()
        text = response.json()["candidates"][0]["content"]["parts"][0]["text"]
        reply = json.loads(text)
    except (httpx.HTTPError, KeyError, IndexError, ValueError) as err:
        log.warning("gemini unavailable, answering offline: %s", err)
        return None
    allowed = {ward.name for ward in plan.wards}
    cited = [name for name in reply.get("cited", []) if name in allowed]
    answer = str(reply.get("answer", "")).strip()
    if not answer or not cited:
        return None
    return {"answer": answer, "cited": cited}


def template(plan: Plan) -> str:
    if plan.kind == "about":
        return " ".join(_about(ward, plan) for ward in plan.wards)
    formats = [plan.category] if plan.category else list(FORMATS)
    what = " or ".join(FORMATS[c][0] for c in formats)
    lens = LENSES[plan.lens]["name"]
    listed = ", ".join(f"{ward.name} ({max(ward.score(c, plan.lens) for c in formats):.0f})" for ward in plan.wards)
    if plan.kind == "gap":
        many = " or ".join(FORMATS[c][1] for c in formats)
        return f"Wards with no {many} yet, best first for {lens}: {listed}."
    leader = plan.wards[0]
    return f"For a new {what}, ranked for {lens}, the strongest wards are {listed} (scores out of 100). " \
           f"In {leader.name}: {leader.rent[0].lower()}{leader.rent[1:]}"


def empty(plan: Plan) -> str:
    many = " or ".join(FORMATS[c][1] for c in ([plan.category] if plan.category else FORMATS))
    return f"Every confident ward already has at least one of the {many} you asked about."


def _about(ward, plan: Plan) -> str:
    p = ward.properties
    counts = ", ".join(f"{p['categories'][c]['count']} {FORMATS[c][1]}" for c in FORMATS)
    return f"{ward.name} has {p['population']:,} residents and {counts}. {p['recommendation']} {ward.rent}"
