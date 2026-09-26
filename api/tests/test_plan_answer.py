import json

import httpx
import numpy as np

from localio_api import answer
from localio_api.answer import respond, template
from localio_api.plan import REFUSAL, SIMILARITY_FLOOR, Plan, plan

LOW = SIMILARITY_FLOOR - 0.1


def _similar(localities, value=LOW):
    return np.full(len(localities), value)


def test_off_topic_is_refused(localities):
    assert plan("who won the world cup", localities, _similar(localities)).kind == "refuse"


def test_a_named_locality_is_in_scope_even_with_low_similarity(localities):
    decided = plan("thoughts on Baner?", localities, _similar(localities))
    assert decided.kind == "about" and [loc.name for loc in decided.localities] == ["Baner"]


def test_gap_questions_list_places_with_none_of_that_format(localities):
    decided = plan("Which localities have no QSRs?", localities, _similar(localities))
    assert decided.kind == "gap" and decided.category == "fast_food"
    assert all(loc.count("fast_food") == 0 and loc.confident for loc in decided.localities)


def test_ranking_uses_the_lens_the_question_implies(localities):
    decided = plan("best area for a QSR with low competition", localities, _similar(localities))
    assert (decided.kind, decided.category, decided.lens) == ("ranking", "fast_food", "competition")


def test_refusal_says_what_the_chat_is_for(localities):
    reply = respond("tell me a joke", Plan("refuse"), None, "unused")
    assert reply == {"answer": REFUSAL, "cited": [], "refused": True, "mode": "rules"}


def test_offline_answers_name_what_they_cite(localities):
    decided = plan("Where should I open a cafe?", localities, _similar(localities))
    reply = respond("Where should I open a cafe?", decided, None, "unused")
    assert reply["mode"] == "offline"
    assert all(name in reply["answer"] for name in reply["cited"])
    assert "{" not in template(decided)


def _gemini_reply(monkeypatch, payload):
    def fake_post(url, json, headers, timeout):
        body = {"candidates": [{"content": {"parts": [{"text": payload}]}}]}
        return httpx.Response(200, json=body, request=httpx.Request("POST", url))
    monkeypatch.setattr(answer.httpx, "post", fake_post)


def test_gemini_citations_outside_the_plan_are_dropped(monkeypatch, localities):
    decided = plan("Tell me about Baner", localities, _similar(localities))
    _gemini_reply(monkeypatch, json.dumps({"answer": "Baner has no QSRs yet.", "cited": ["Baner", "Atlantis"]}))
    reply = respond("Tell me about Baner", decided, "key", "model")
    assert reply["mode"] == "gemini" and reply["cited"] == ["Baner"]


def test_gemini_with_no_valid_citation_falls_back(monkeypatch, localities):
    decided = plan("Tell me about Baner", localities, _similar(localities))
    _gemini_reply(monkeypatch, json.dumps({"answer": "Try Atlantis.", "cited": ["Atlantis"]}))
    assert respond("Tell me about Baner", decided, "key", "model")["mode"] == "offline"


def test_gemini_errors_fall_back(monkeypatch, localities):
    def failing_post(*args, **kwargs):
        raise httpx.ConnectError("offline")
    monkeypatch.setattr(answer.httpx, "post", failing_post)
    decided = plan("Tell me about Baner", localities, _similar(localities))
    assert respond("Tell me about Baner", decided, "key", "model")["mode"] == "offline"


def test_ranking_answer_sticks_to_the_format_asked_about(localities):
    decided = plan("Where should I open a QSR?", localities, _similar(localities))
    text = template(decided)
    assert "cafe is the better bet" not in text
    assert f"A new QSR in {decided.localities[0].name}" in text
