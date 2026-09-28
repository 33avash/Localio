"""The HTTP layer, with the real embedding model and the pipeline's output."""

from localio_api import facts, main
from localio_api.evaluate import evaluate


def test_health(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok" and body["localities"] == 140


def test_empty_and_long_questions_get_a_readable_400(client):
    assert client.post("/api/ask", json={"question": "   "}).json()["detail"] == "Type a question first."
    assert client.post("/api/ask", json={"question": "x" * 301}).status_code == 400


def test_known_question_cites_a_locality_named_in_the_answer(client, monkeypatch):
    monkeypatch.setenv("LOCALIO_LLM", "offline")
    body = client.post("/api/ask", json={"question": "Tell me about Koregaon Park"}).json()
    assert body["cited"] == ["Koregaon Park"] and "Koregaon Park" in body["answer"]


def test_answers_about_a_ward_quote_its_money_as_a_range(client, monkeypatch, localities):
    monkeypatch.setenv("LOCALIO_LLM", "offline")
    body = client.post("/api/ask", json={"question": "Should I open a QSR in Kharadi?", "category": "fast_food"}).json()
    kharadi = next(loc for loc in localities if loc.name == "Kharadi Infotech Park")
    low, _, high = kharadi.properties["economics"]["fast_food"]["profit"]
    assert "profit a month (p10 to p90)" in body["answer"]
    assert facts.rupees(low) in body["answer"] and facts.rupees(high) in body["answer"]


def test_world_cup_is_refused(client):
    body = client.post("/api/ask", json={"question": "who won the world cup"}).json()
    assert body["refused"] and body["cited"] == []


def test_rate_limit(client, monkeypatch):
    monkeypatch.setattr(main, "RATE", (2, 60))
    main.recent.clear()
    codes = [client.post("/api/ask", json={"question": "Tell me about Baner"}).status_code for _ in range(3)]
    main.recent.clear()
    assert codes == [200, 200, 429]


def test_labelled_questions_all_pass():
    report = evaluate()
    assert report["misses"] == []
