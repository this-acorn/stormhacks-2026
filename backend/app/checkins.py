"""Historical replay: store a downloaded FIRMS dataset and send check-ins to nearby organizations.

The spatial rule (also in the README):
1. Detections in the same or touching 2 km grid cells form one fire event (see firms.py).
2. Low-confidence detections are stored and shown, but never trigger check-ins.
3. An event with at least 3 nominal- or high-confidence detections triggers a check-in for each
   organization within 10 km (great-circle distance) of any of those detections.
4. A fire event and an organization get at most one check-in (a unique key in the database).
   Replaying again updates the distance and counts of existing check-ins instead of duplicating them.
"""

import logging
import math
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import func, insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import ai
from app.errors import ApiError
from app.firms import Dataset, Detection, load_dataset
from app.models import CheckIn, FireDetection, FireEvent, Organization, new_id

log = logging.getLogger("aidatlas.replay")

CHECK_IN_RADIUS_KM = 10.0
MIN_EVENT_DETECTIONS = 3
EARTH_RADIUS_KM = 6371.0088


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle (haversine) distance between two points."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(h))


@dataclass
class Nearby:
    """One organization within the radius of one fire event."""

    event_key: str
    organization: Organization
    distance_km: float
    nearest: Detection
    count: int  # qualifying detections within the radius
    first_at: datetime
    last_at: datetime


def find_nearby(events: dict[str, list[Detection]], organizations: list[Organization]) -> list[Nearby]:
    found = []
    pad_lat = CHECK_IN_RADIUS_KM / 110.574
    for key, members in events.items():
        strong = [d for d in members if d.confidence != "low"]
        if len(strong) < MIN_EVENT_DETECTIONS:
            continue
        south = min(d.latitude for d in strong) - pad_lat
        north = max(d.latitude for d in strong) + pad_lat
        pad_lon = CHECK_IN_RADIUS_KM / (111.320 * max(math.cos(math.radians(max(abs(south), abs(north)))), 0.01))
        west = min(d.longitude for d in strong) - pad_lon
        east = max(d.longitude for d in strong) + pad_lon
        for org in organizations:
            if not (south <= org.latitude <= north and west <= org.longitude <= east):
                continue  # a cheap box test before exact distances
            within = []
            for d in strong:
                km = distance_km(org.latitude, org.longitude, d.latitude, d.longitude)
                if km <= CHECK_IN_RADIUS_KM:
                    within.append((km, d))
            if not within:
                continue
            km, nearest = min(within, key=lambda pair: (pair[0], pair[1].acquired_at))
            times = [d.acquired_at for _, d in within]
            found.append(Nearby(key, org, km, nearest, len(within), min(times), max(times)))
    return found


def _when(moment: datetime) -> str:
    return f"{moment.day} {moment:%b %Y} at {moment:%H:%M} UTC"


def summary_text(n: Nearby) -> str:
    if n.first_at.date() == n.last_at.date():
        days = f"on {n.first_at.day} {n.first_at:%b %Y}"
    else:
        days = f"between {n.first_at.day} {n.first_at:%b} and {n.last_at.day} {n.last_at:%b %Y}"
    plural = "" if n.count == 1 else "s"
    return (
        f"Historical replay of NASA FIRMS satellite data. The VIIRS instrument on NOAA-20 recorded {n.count} heat "
        f"detection{plural} from one fire event within {CHECK_IN_RADIUS_KM:.0f} km of {n.organization.name} {days}. "
        f"The nearest was {n.distance_km:.1f} km away, on {_when(n.nearest.acquired_at)}. "
        "Heat detections are not confirmed damage or need."
    )


def draft_facts(n: Nearby) -> str:
    o = n.organization
    return (
        f"Organization: {o.name}, a {o.type.lower()} in {o.location}.\n"
        f"What they do: {o.situation}\n"
        f"Observation (historical replay of NASA FIRMS data): {n.count} heat detections from one fire event within "
        f"{CHECK_IN_RADIUS_KM:.0f} km. The nearest was {n.distance_km:.1f} km away on {_when(n.nearest.acquired_at)}."
    )


TEMPLATE_ITEMS = {
    "elderly": [("N95 respirator masks", 100, "masks"), ("Bottled water (24-pack)", 20, "cases"), ("Portable air purifiers", 4, "units")],
    "children": [("Children's N95 masks", 100, "masks"), ("Bottled water (24-pack)", 20, "cases"), ("Activity kits for children", 30, "kits")],
    "default": [("Bottled water (24-pack)", 30, "cases"), ("N95 respirator masks", 200, "masks"), ("Emergency supply kits", 25, "kits")],
}


def template_draft(n: Nearby) -> dict:
    """The fallback when Gemini is unavailable: a fixed question and items by organization type."""
    kind = n.organization.type.lower()
    key = "elderly" if "elderly" in kind else "children" if "child" in kind else "default"
    question = (
        f"Satellite data show heat detections from a fire event {n.distance_km:.1f} km from {n.organization.name}, "
        f"on {_when(n.nearest.acquired_at)}. Detections show heat, not confirmed damage. "
        "Is your site affected, and do you need any support?"
    )
    items = [{"item": item, "quantity": quantity, "unit": unit} for item, quantity, unit in TEMPLATE_ITEMS[key]]
    return {"question": question, "suggested_items": items}


def make_drafts(nearby: list[Nearby]) -> list[tuple[dict, str]]:
    """Ask Gemini for every draft in parallel; any failure falls back to the template."""

    def one(n: Nearby) -> tuple[dict, str]:
        try:
            draft = ai.draft_check_in(draft_facts(n))
        except ai.AIUnavailable:
            return template_draft(n), "template"
        return {"question": draft.question, "suggested_items": [i.model_dump() for i in draft.suggested_items]}, "gemini"

    if not nearby:
        return []
    with ThreadPoolExecutor(max_workers=4) as pool:
        return list(pool.map(one, nearby))


def replay(db: Session, dataset_name: str, through: date | None) -> dict:
    try:
        dataset = load_dataset(dataset_name)
    except KeyError:
        raise ApiError(404, f"There is no downloaded dataset called '{dataset_name}'.") from None
    visible = [d for d in dataset.detections if through is None or d.acquired_at.date() <= through]
    if not visible:
        message = f"The dataset has no detections on or before {through}."
        raise ApiError(422, message, fields={"through": message})

    events: dict[str, list[Detection]] = {}
    for d in visible:
        events.setdefault(d.event_key, []).append(d)

    event_ids = _store_events(db, dataset, events)
    added = _store_detections(db, dataset, visible, event_ids)
    _refresh_event_stats(db, dataset.name)
    db.commit()

    organizations = list(db.scalars(select(Organization)))
    created, updated, existing = _store_check_ins(db, dataset, find_nearby(events, organizations), event_ids)
    total = db.scalar(select(func.count()).select_from(FireDetection).where(FireDetection.dataset == dataset.name))
    log.info("Replayed %s through %s: %d new detections, %d check-ins created", dataset.name, through, added, created)
    return {
        "playback": True,
        "dataset": dataset.name,
        "title": dataset.metadata["title"],
        "source": f"{dataset.metadata['source']} · {dataset.metadata['product']}",
        "observed_from": visible[0].acquired_at,
        "observed_to": visible[-1].acquired_at,
        "detections_added": added,
        "detections_total": total,
        "events": len(events),
        "check_ins_created": created,
        "check_ins_updated": updated,
        "check_ins_existing": existing,
    }


def _store_events(db: Session, dataset: Dataset, events: dict[str, list[Detection]]) -> dict[str, str]:
    """Insert events seen for the first time. Returns event key -> event id."""
    ids = dict(db.execute(select(FireEvent.source_key, FireEvent.id).where(FireEvent.dataset == dataset.name)).all())
    new = []
    for key, members in events.items():
        if key in ids:
            continue
        event = FireEvent(
            id=new_id("evt"),
            source_key=key,
            dataset=dataset.name,
            first_detected_at=members[0].acquired_at,
            last_detected_at=members[-1].acquired_at,
            center_latitude=sum(d.latitude for d in members) / len(members),
            center_longitude=sum(d.longitude for d in members) / len(members),
            detection_count=len(members),
            playback=True,
        )
        new.append(event)
        ids[key] = event.id
    if new:
        db.add_all(new)
        db.flush()
    return ids


def _store_detections(db: Session, dataset: Dataset, visible: list[Detection], event_ids: dict[str, str]) -> int:
    """Insert detections not stored yet (the unique source_key makes a second import a no-op)."""
    stored = set(db.scalars(select(FireDetection.source_key).where(FireDetection.dataset == dataset.name)))
    rows = [
        {
            "id": new_id("det"),
            "source_key": d.source_key,
            "dataset": dataset.name,
            "source": "NASA FIRMS",
            "satellite": d.satellite,
            "instrument": d.instrument,
            "latitude": d.latitude,
            "longitude": d.longitude,
            "acquired_at": d.acquired_at,
            "confidence": d.confidence,
            "frp_mw": d.frp_mw,
            "brightness_k": d.brightness_k,
            "day_night": d.day_night,
            "playback": True,
            "event_id": event_ids[d.event_key],
        }
        for d in visible
        if d.source_key not in stored
    ]
    if rows:
        db.execute(insert(FireDetection), rows)
    return len(rows)


def _refresh_event_stats(db: Session, dataset_name: str) -> None:
    """Recompute every event's counts and times from its stored detections, in one statement."""
    det, evt = FireDetection.__table__, FireEvent.__table__

    def per_event(expression):
        return select(expression).where(det.c.event_id == evt.c.id).scalar_subquery()

    db.execute(
        update(evt)
        .where(evt.c.dataset == dataset_name)
        .values(
            detection_count=per_event(func.count()),
            first_detected_at=per_event(func.min(det.c.acquired_at)),
            last_detected_at=per_event(func.max(det.c.acquired_at)),
            center_latitude=per_event(func.avg(det.c.latitude)),
            center_longitude=per_event(func.avg(det.c.longitude)),
        )
    )


def _refresh_check_in(c: CheckIn, n: Nearby) -> bool:
    changed = (
        c.detection_count != n.count
        or abs(c.distance_km - n.distance_km) > 1e-9
        or c.nearest_detected_at != n.nearest.acquired_at
    )
    if changed:
        c.distance_km = n.distance_km
        c.nearest_latitude = n.nearest.latitude
        c.nearest_longitude = n.nearest.longitude
        c.nearest_detected_at = n.nearest.acquired_at
        c.detection_count = n.count
        c.summary = summary_text(n)
    return changed


def _store_check_ins(db: Session, dataset: Dataset, nearby: list[Nearby], event_ids: dict[str, str]) -> tuple[int, int, int]:
    existing = {
        (c.event_id, c.organization_id): c
        for c in db.scalars(
            select(CheckIn).join(FireEvent, CheckIn.event_id == FireEvent.id).where(FireEvent.dataset == dataset.name)
        )
    }
    to_create, updated, unchanged = [], 0, 0
    for n in nearby:
        c = existing.get((event_ids[n.event_key], n.organization.id))
        if c is None:
            to_create.append(n)
        elif _refresh_check_in(c, n):
            updated += 1
        else:
            unchanged += 1
    db.commit()

    # Gemini runs outside any database transaction; each new check-in is then saved on its own.
    created = 0
    for n, (draft, draft_source) in zip(to_create, make_drafts(to_create)):
        db.add(
            CheckIn(
                id=new_id("chk"),
                event_id=event_ids[n.event_key],
                organization_id=n.organization.id,
                distance_km=n.distance_km,
                nearest_latitude=n.nearest.latitude,
                nearest_longitude=n.nearest.longitude,
                nearest_detected_at=n.nearest.acquired_at,
                detection_count=n.count,
                summary=summary_text(n),
                question=draft["question"],
                suggested_items=draft["suggested_items"],
                draft_source=draft_source,
            )
        )
        try:
            db.commit()
            created += 1
        except IntegrityError:
            db.rollback()  # another replay created this check-in at the same moment
            unchanged += 1
    return created, updated, unchanged
