"""The HTTP layer, with the real embedding model and the pipeline's output."""

from localio_api import main
from localio_api.evaluate import evaluate


def test_health(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok" and body["wards"] == 140


def test_empty_and_long_questions_get_a_readable_400(client):
    assert client.post("/api/ask", json={"question": "   "}).json()["detail"] == "Type a question first."
    assert client.post("/api/ask", json={"question": "x" * 301}).status_code == 400


def test_known_question_cites_the_ward_it_names(client, monkeypatch):
    monkeypatch.setenv("LOCALIO_LLM", "offline")
    body = client.post("/api/ask", json={"question": "Tell me about Koregaon Park"}).json()
    assert body["cited"] == ["Koregaon Park"] and "Koregaon Park" in body["answer"]


def test_answers_about_a_ward_include_its_rent(client, monkeypatch, wards):
    monkeypatch.setenv("LOCALIO_LLM", "offline")
    body = client.post("/api/ask", json={"question": "Should I open a QSR in Kharadi?", "category": "fast_food"}).json()
    kharadi = next(ward for ward in wards if ward.name == "Kharadi Infotech Park")
    assert body["cited"] == ["Kharadi Infotech Park"] and kharadi.rent in body["answer"]


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
