import json

import httpx
import numpy as np

from localio_api import answer
from localio_api.answer import respond, template
from localio_api.plan import REFUSAL, SIMILARITY_FLOOR, Plan, plan

LOW = SIMILARITY_FLOOR - 0.1


def _similar(wards, value=LOW):
    return np.full(len(wards), value)


def test_off_topic_is_refused(wards):
    assert plan("who won the world cup", wards, _similar(wards)).kind == "refuse"


def test_a_place_inside_a_ward_finds_the_ward_even_with_low_similarity(wards):
    decided = plan("thoughts on Baner?", wards, _similar(wards))
    assert decided.kind == "about" and [ward.name for ward in decided.wards] == ["Baner Balewadi"]


def test_gap_questions_list_places_with_none_of_that_format(wards):
    decided = plan("Which wards have no QSRs?", wards, _similar(wards))
    assert decided.kind == "gap" and decided.category == "fast_food"
    assert all(ward.count("fast_food") == 0 and ward.confident for ward in decided.wards)


def test_ranking_uses_the_lens_the_question_implies(wards):
    decided = plan("best area for a QSR with low competition", wards, _similar(wards))
    assert (decided.kind, decided.category, decided.lens) == ("ranking", "fast_food", "quiet")


def test_refusal_says_what_the_chat_is_for(wards):
    reply = respond("tell me a joke", Plan("refuse"), None, "unused")
    assert reply == {"answer": REFUSAL, "cited": [], "refused": True, "mode": "rules"}


def test_offline_answers_name_what_they_cite(wards):
    decided = plan("Where should I open a cafe?", wards, _similar(wards))
    reply = respond("Where should I open a cafe?", decided, None, "unused")
    assert reply["mode"] == "offline"
    assert all(name in reply["answer"] for name in reply["cited"])
    assert "{" not in template(decided)


def _gemini_reply(monkeypatch, payload):
    def fake_post(url, json, headers, timeout):
        body = {"candidates": [{"content": {"parts": [{"text": payload}]}}]}
        return httpx.Response(200, json=body, request=httpx.Request("POST", url))
    monkeypatch.setattr(answer.httpx, "post", fake_post)


def test_gemini_citations_outside_the_plan_are_dropped(monkeypatch, wards):
    decided = plan("Tell me about Baner", wards, _similar(wards))
    _gemini_reply(monkeypatch, json.dumps({"answer": "Baner Balewadi has room.", "cited": ["Baner Balewadi", "Atlantis"]}))
    reply = respond("Tell me about Baner", decided, "key", "model")
    assert reply["mode"] == "gemini" and reply["cited"] == ["Baner Balewadi"]


def test_gemini_with_no_valid_citation_falls_back(monkeypatch, wards):
    decided = plan("Tell me about Baner", wards, _similar(wards))
    _gemini_reply(monkeypatch, json.dumps({"answer": "Try Atlantis.", "cited": ["Atlantis"]}))
    assert respond("Tell me about Baner", decided, "key", "model")["mode"] == "offline"


def test_gemini_errors_fall_back(monkeypatch, wards):
    def failing_post(*args, **kwargs):
        raise httpx.ConnectError("offline")
    monkeypatch.setattr(answer.httpx, "post", failing_post)
    decided = plan("Tell me about Baner", wards, _similar(wards))
    assert respond("Tell me about Baner", decided, "key", "model")["mode"] == "offline"


def test_ranking_answer_sticks_to_the_format_asked_about(wards):
    decided = plan("Where should I open a QSR?", wards, _similar(wards))
    text = template(decided)
    assert "cafe is the better bet" not in text
    assert f"In {decided.wards[0].name}: rent is" in text
