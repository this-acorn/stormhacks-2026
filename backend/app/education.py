"""Persistent education data, checked daily while the API server is running."""

import asyncio
import json
import logging
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Lock

from app.education_data import refresh_snapshot, validate_snapshot, write_json

log = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parents[1]
CHECK_INTERVAL = timedelta(days=1)
RETRY_INTERVAL = timedelta(hours=1)


class EducationStore:
    def __init__(self, cache=ROOT / ".cache/education", seed=ROOT / "data/education.json"):
        self.cache = cache
        self.seed = seed
        self.lock = Lock()
        self.data = None
        self.refreshing = False
        self.failed = False
        self.next_check = datetime.min.replace(tzinfo=UTC)

    def _load(self):
        if self.data is not None:
            return
        for path in (self.cache / "latest.json", self.seed):
            try:
                candidate = json.loads(path.read_text(encoding="utf-8"))
                validate_snapshot(candidate)
                self.data = candidate
                if candidate.get("checkedAt"):
                    self.next_check = datetime.fromisoformat(candidate["checkedAt"]) + CHECK_INTERVAL
                return
            except (OSError, ValueError, KeyError, TypeError):
                continue

    def snapshot(self):
        with self.lock:
            self._load()
            if self.data is None:
                raise ValueError("Education data is being downloaded.")
            now = datetime.now(UTC)
            state = "checking" if self.refreshing else "stale" if self.failed or now >= self.next_check else "current"
            return {**self.data, "updates": {
                "state": state,
                "automatic": True,
                "checkedAt": self.data.get("checkedAt"),
                "nextCheckAt": max(now, self.next_check).isoformat(),
            }}

    def refresh_if_due(self, force=False):
        with self.lock:
            self._load()
            if self.refreshing or (not force and datetime.now(UTC) < self.next_check):
                return
            self.refreshing = True
            previous = self.data
        try:
            candidate = refresh_snapshot(self.cache, previous)
            write_json(self.cache / "latest.json", candidate)
            with self.lock:
                self.data = candidate
                self.failed = False
                self.next_check = datetime.now(UTC) + CHECK_INTERVAL
            log.info("Education checked: UIS %s, %s countries with data", candidate["release"],
                     sum(bool(country["years"]) for country in candidate["countries"]))
        except Exception:
            log.exception("Education refresh failed; retaining the last validated data")
            with self.lock:
                self.failed = True
                self.next_check = datetime.now(UTC) + RETRY_INTERVAL
        finally:
            with self.lock:
                self.refreshing = False

    async def run(self):
        while True:
            await asyncio.to_thread(self.refresh_if_due)
            await asyncio.sleep(RETRY_INTERVAL.total_seconds())


education_store = EducationStore()
