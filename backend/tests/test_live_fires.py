from datetime import UTC, datetime

import httpx
import pytest

from app import live_fires
from app.main import app
from fastapi.testclient import TestClient

NOW = datetime(2026, 10, 4, 12, tzinfo=UTC)
HEADER = "latitude,longitude,acq_date,acq_time,confidence,frp\n"
CURRENT = "49,-120,2026-10-04,1000,nominal,25\n"


def test_current_feed_excludes_replay_old_future_low_confidence_and_duplicate_rows():
    text = HEADER + CURRENT * 2 + "\n".join([
        "49,-120,2023-08-17,1000,high,80",
        "49,-120,2026-10-03,1159,high,80",
        "49,-120,2026-10-04,1300,high,80",
        "49,-120,2026-10-04,1100,low,80",
        "91,-120,2026-10-04,1000,high,80",
        "nan,-120,2026-10-04,1000,high,80",
    ])
    data = live_fires.parse_fires(text, NOW)
    assert data["playback"] is False
    assert data["end"] == "2026-10-04T10:00:00Z"
    assert data["detections"] == [[-120.0, 49.0, 0.0, 25.0, 0]]
    assert data["clusters"][0]["count"] == 1


def test_keeps_small_fires_and_groups_neighboring_pixels():
    data = live_fires.parse_fires(HEADER + CURRENT + "49.001,-120.001,2026-10-04,1100,high,10\n0,30,2026-10-04,1130,high,1", NOW)
    assert len(data["detections"]) == 3
    assert len(data["clusters"]) == 2
    assert data["clusters"][0]["count"] == 2
    assert data["detections"][1][2] == 60


@pytest.mark.parametrize("body", ["<html>Unavailable</html>", HEADER + "49,-120,2023-08-17,1000,high,80"])
def test_rejects_invalid_or_outdated_feed(body):
    with pytest.raises(ValueError):
        live_fires.parse_fires(body, NOW)


def test_empty_feed_is_not_fabricated_as_a_fire():
    data = live_fires.parse_fires(HEADER, NOW)
    assert data["detections"] == []
    assert data["clusters"] == []


@pytest.fixture
def empty_cache(monkeypatch):
    """No feed downloaded yet, at a fixed time. Returns the URLs fetched from FIRMS."""
    class FixedDate(datetime):
        @classmethod
        def now(cls, tz=None):
            return NOW
    monkeypatch.setattr(live_fires, "datetime", FixedDate)
    monkeypatch.setattr(live_fires, "_cached", None)
    monkeypatch.setattr(live_fires, "_bodies", (b"", b""))
    monkeypatch.setattr(live_fires, "_expires", 0)
    calls = []
    def get(url, **kwargs):
        calls.append(url)
        return httpx.Response(200, text=HEADER + CURRENT, request=httpx.Request("GET", url))
    monkeypatch.setattr(live_fires.httpx, "get", get)
    return calls


def offline(*args, **kwargs):
    raise httpx.ConnectError("offline")


def test_feed_cache_and_failure_do_not_return_expired_snapshot(monkeypatch, empty_cache):
    assert live_fires.latest_fires() == live_fires.latest_fires()
    assert len(empty_cache) == 1
    monkeypatch.setattr(live_fires, "_expires", 0)
    monkeypatch.setattr(live_fires.httpx, "get", offline)
    with pytest.raises(httpx.ConnectError):
        live_fires.latest_fires()


def test_background_refresh_serves_requests_without_downloading(monkeypatch, empty_cache):
    live_fires.refresh()
    monkeypatch.setattr(live_fires.httpx, "get", offline)
    assert live_fires.latest_fires()["detections"] == [[-120.0, 49.0, 0.0, 25.0, 0]]
    assert len(empty_cache) == 1


def test_public_endpoint_serves_the_cached_feed_plain_or_compressed(empty_cache):
    client = TestClient(app)
    compressed = client.get("/api/v1/hazards/wildfire", headers={"Accept-Encoding": "gzip"})
    plain = client.get("/api/v1/hazards/wildfire", headers={"Accept-Encoding": "identity"})
    assert compressed.headers["content-encoding"] == "gzip"
    assert "content-encoding" not in plain.headers
    assert compressed.json() == plain.json() == live_fires.latest_fires()
    assert plain.json()["detections"][0][:2] == [-120.0, 49.0]


def test_public_endpoint_reports_outage_instead_of_replay(monkeypatch):
    def fail(gzipped):
        raise ValueError("outdated")
    monkeypatch.setattr("app.routers.hazards.latest_fires_body", fail)
    response = TestClient(app).get("/api/v1/hazards/wildfire")
    assert response.status_code == 503
    assert "unavailable" in response.json()["detail"]
