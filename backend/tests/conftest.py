"""The tests run against an in-memory SQLite database and never read backend/.env or call Gemini."""

import os

os.environ["AIDATLAS_TESTING"] = "1"
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["SESSION_SECRET"] = "test-only-secret"
for name in ("GEMINI_API_KEY", "TIDB_HOST", "TIDB_USER", "TIDB_PASSWORD", "FIRMS_MAP_KEY"):
    os.environ.pop(name, None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.models  # noqa: E402,F401
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import seed  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_database():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed(db)
    yield


@pytest.fixture
def login():
    """login("staff", "okanagan") returns a client signed in as that demo account."""

    def make(role: str | None = None, organization_id: str | None = None) -> TestClient:
        client = TestClient(app)
        if role:
            body = {"role": role} | ({"organizationId": organization_id} if organization_id else {})
            response = client.post("/api/v1/auth/demo", json=body)
            assert response.status_code == 200, response.text
        return client

    return make
