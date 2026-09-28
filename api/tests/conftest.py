"""The API tests read the pipeline's real output, mounted at /srv/localio-data
(docker compose run --rm api python -m pytest tests)."""

import pytest
from fastapi.testclient import TestClient

from localio_api import facts
from localio_api.main import DATA, app


@pytest.fixture(scope="session")
def wards():
    return facts.load(DATA)


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as test_client:
        yield test_client
