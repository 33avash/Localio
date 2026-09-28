"""Localio's question-answering API.

GET  /api/health  whether the facts and the embedding model loaded
POST /api/ask     {"question", "category"?, "lens"?} ->
                  {"answer", "cited", "refused", "mode"}

nginx proxies /api/ here, so the page and the API share an origin.
"""

import os
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastembed import TextEmbedding
from pydantic import BaseModel

from localio_api import facts
from localio_api.answer import respond
from localio_api.plan import plan

# The pipeline's output directory, mounted read-only.
DATA = Path(os.environ.get("LOCALIO_DATA", "/srv/localio-data"))
EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"
MAX_QUESTION = 300
RATE = (12, 60)  # questions per window, window in seconds, per client

state = {}


class Embedder:
    """Unit-length vectors, so a dot product is the cosine similarity."""

    def __init__(self):
        self.model = TextEmbedding(EMBEDDING_MODEL, cache_dir=os.environ.get("FASTEMBED_CACHE"))

    def documents(self, texts: list[str]) -> np.ndarray:
        return _unit(np.array(list(self.model.embed(texts))))

    def query(self, text: str) -> np.ndarray:
        return _unit(np.array(list(self.model.query_embed(text))))[0]


def _unit(vectors: np.ndarray) -> np.ndarray:
    return vectors / np.linalg.norm(vectors, axis=1, keepdims=True)


@asynccontextmanager
async def lifespan(_: FastAPI):
    wards = facts.load(DATA)
    embedder = Embedder()
    state.update(wards=wards, embedder=embedder, cards=embedder.documents([ward.card for ward in wards]))
    yield


app = FastAPI(title="Localio ask", lifespan=lifespan)
recent = defaultdict(deque)


class Ask(BaseModel):
    question: str
    category: str | None = None
    lens: str | None = None


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "wards": len(state["wards"]), "writer": "gemini" if _key() else "offline"}


@app.post("/api/ask")
def ask(body: Ask, request: Request) -> dict:
    question = body.question.strip()
    if not question:
        raise HTTPException(400, "Type a question first.")
    if len(question) > MAX_QUESTION:
        raise HTTPException(400, f"Keep it under {MAX_QUESTION} characters.")
    # Behind nginx every request comes from the proxy, which passes the
    # visitor's address along.
    _limit(request.headers.get("x-forwarded-for") or (request.client.host if request.client else "unknown"))

    category = body.category if body.category in facts.FORMATS else None
    similarities = state["cards"] @ state["embedder"].query(question)
    decided = plan(question, state["wards"], similarities, category, body.lens)
    return respond(question, decided, _key(), os.environ.get("LOCALIO_GEMINI_MODEL", "gemini-3.8-flash"))


def _key() -> str | None:
    if os.environ.get("LOCALIO_LLM", "").lower() == "offline":
        return None
    return os.environ.get("GEMINI_API_KEY") or None


def _limit(client: str) -> None:
    allowed, window = RATE
    now = time.monotonic()
    times = recent[client]
    while times and now - times[0] > window:
        times.popleft()
    if len(times) >= allowed:
        raise HTTPException(429, "That's a lot of questions at once. Try again in a minute.")
    times.append(now)
