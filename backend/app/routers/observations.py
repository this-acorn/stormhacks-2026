from datetime import date, datetime, time, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.auth import current_user, require_staff
from app.checkins import replay
from app.config import get_settings
from app.db import get_db
from app.errors import ApiError, not_found
from app.models import CheckIn, FireDetection, User, utcnow
from app.schemas import CheckInIn, ObservationOut, ReplayIn, ReplayOut, iso_utc
from app.seed import reset
from app.serializers import observation_out

router = APIRouter(tags=["satellite"])
settings = get_settings()

CONFIDENCE_AT_LEAST = {"low": ("low", "nominal", "high"), "nominal": ("nominal", "high"), "high": ("high",)}


def _demo_controls() -> None:
    if not settings.demo_controls:
        raise ApiError(403, "Demo controls are turned off on this server.")


@router.get("/detections")
def detections(
    dataset: str | None = None,
    start: date | None = Query(default=None, alias="from"),
    end: date | None = Query(default=None, alias="to"),
    min_confidence: Literal["low", "nominal", "high"] = Query(default="low", alias="minConfidence"),
    db: Session = Depends(get_db),
):
    """Stored fire detections as GeoJSON points. Empty until a dataset is replayed."""
    d = FireDetection
    query = (
        select(d.id, d.source, d.instrument, d.satellite, d.latitude, d.longitude, d.acquired_at, d.confidence,
               d.frp_mw, d.brightness_k, d.day_night, d.playback, d.event_id, d.dataset)
        .where(d.confidence.in_(CONFIDENCE_AT_LEAST[min_confidence]))
        .order_by(d.acquired_at)
    )
    if dataset:
        query = query.where(d.dataset == dataset)
    if start:
        query = query.where(d.acquired_at >= datetime.combine(start, time.min))
    if end:
        query = query.where(d.acquired_at < datetime.combine(end + timedelta(days=1), time.min))
    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [row.longitude, row.latitude]},
            "properties": {
                "id": row.id,
                "dataset": row.dataset,
                "source": row.source,
                "instrument": row.instrument,
                "satellite": row.satellite,
                "acquiredAt": iso_utc(row.acquired_at),
                "confidence": row.confidence,
                "frpMw": row.frp_mw,
                "brightnessK": row.brightness_k,
                "dayNight": row.day_night,
                "playback": row.playback,
                "eventId": row.event_id,
            },
        }
        for row in db.execute(query)
    ]
    # JSONResponse skips FastAPI's slower per-field encoder; thousands of points stay fast.
    return JSONResponse({"type": "FeatureCollection", "features": features})


@router.get("/observations", response_model=list[ObservationOut], response_model_exclude_none=True)
def list_check_ins(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Satellite check-ins. Staff get their own organization's in full; everyone else gets the public view."""
    rows = db.scalars(select(CheckIn).options(selectinload(CheckIn.event)).order_by(CheckIn.created_at.desc()))
    return [observation_out(c, user) for c in rows]


@router.post("/demo/replay-observations", response_model=ReplayOut)
def replay_observations(body: ReplayIn | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Historical playback of a downloaded NASA FIRMS dataset. Running it again never duplicates check-ins.

    Pass `through` (a UTC day such as "2023-08-17") to replay only up to that day, then a later day
    to show new detections arriving.
    """
    _demo_controls()
    body = body or ReplayIn()
    return replay(db, body.dataset, body.through)


@router.post("/demo/reset")
def reset_demo(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Delete replayed data, new requests and contributions, and restore the original demo data."""
    _demo_controls()
    return {"reset": True, "rowsAdded": reset(db)}


@router.post("/observations/{check_in_id}/check-in", response_model=ObservationOut, response_model_exclude_none=True)
def answer_check_in(check_in_id: str, body: CheckInIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Staff answer a check-in. Answering never publishes a request; staff do that separately."""
    check_in = db.get(CheckIn, check_in_id)
    if check_in is None:
        raise not_found("Check-in")
    require_staff(user, check_in.organization_id, "answer this check-in")
    check_in.response = body.response
    check_in.responded_at = utcnow()
    db.commit()
    return observation_out(check_in, user)
