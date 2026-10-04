"""Database tables. SQLAlchemy turns each class into a CREATE TABLE statement."""

import secrets
from datetime import UTC, datetime

from sqlalchemy import JSON, Double, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import UserDefinedType

from app.db import Base

EMBEDDING_DIMENSIONS = 768


class Vector(UserDefinedType):
    """TiDB's VECTOR(D) column. Values travel as text such as "[0.1,0.2]"."""

    cache_ok = True

    def __init__(self, dimensions: int):
        self.dimensions = dimensions

    def get_col_spec(self, **kw) -> str:
        return f"VECTOR({self.dimensions})"

    def bind_processor(self, dialect):
        def process(value):
            return None if value is None else to_vector_literal(value)

        return process

    def result_processor(self, dialect, coltype):
        def process(value):
            if value is None:
                return None
            if isinstance(value, bytes):
                value = value.decode()
            return [float(x) for x in value.strip("[]").split(",") if x.strip()]

        return process


def to_vector_literal(values) -> str:
    return "[" + ",".join(f"{float(v):.7g}" for v in values) + "]"


def utcnow() -> datetime:
    # The database stores times without a timezone, so every time we save is UTC.
    return datetime.now(UTC).replace(tzinfo=None)


def new_id(prefix: str) -> str:
    # Readable random IDs such as "req_3f9a1c2b7d4e". Seeded demo rows set their own IDs.
    return f"{prefix}_{secrets.token_hex(6)}"


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("org"))
    name: Mapped[str] = mapped_column(String(120))
    type: Mapped[str] = mapped_column(String(80))
    location: Mapped[str] = mapped_column(String(120))
    latitude: Mapped[float] = mapped_column(Double)
    longitude: Mapped[float] = mapped_column(Double)
    situation: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text)
    website_url: Mapped[str | None] = mapped_column(String(500))
    donate_url: Mapped[str | None] = mapped_column(String(500))
    supplies_url: Mapped[str | None] = mapped_column(String(500))
    volunteer_url: Mapped[str | None] = mapped_column(String(500))
    volunteer_role: Mapped[str] = mapped_column(String(120), default="")
    volunteer_slots: Mapped[int] = mapped_column(default=0)
    sample: Mapped[bool] = mapped_column(default=False)  # fictional demo organization
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    # "selectin" loads every organization's requests in one extra query, not one query each.
    requests: Mapped[list["AidRequest"]] = relationship(back_populates="organization", lazy="selectin")


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("usr"))
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(10))  # "supporter" or "staff"
    organization_id: Mapped[str | None] = mapped_column(ForeignKey("organizations.id"), index=True)  # staff only
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class FireEvent(Base):
    """Nearby fire detections grouped into one fire."""

    __tablename__ = "fire_events"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("evt"))
    source_key: Mapped[str] = mapped_column(String(120), unique=True)
    dataset: Mapped[str] = mapped_column(String(60), index=True)
    first_detected_at: Mapped[datetime]
    last_detected_at: Mapped[datetime]
    center_latitude: Mapped[float] = mapped_column(Double)
    center_longitude: Mapped[float] = mapped_column(Double)
    detection_count: Mapped[int]
    playback: Mapped[bool] = mapped_column(default=False)


class FireDetection(Base):
    """One point where a satellite saw unusual heat. A point, not a damage area."""

    __tablename__ = "fire_detections"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("det"))
    source_key: Mapped[str] = mapped_column(String(120), unique=True)  # importing the same point twice is refused
    dataset: Mapped[str] = mapped_column(String(60), index=True)
    source: Mapped[str] = mapped_column(String(40))  # "NASA FIRMS"
    satellite: Mapped[str] = mapped_column(String(20))  # "NOAA-20"
    instrument: Mapped[str] = mapped_column(String(10))  # "VIIRS"
    latitude: Mapped[float] = mapped_column(Double)
    longitude: Mapped[float] = mapped_column(Double)
    acquired_at: Mapped[datetime]
    confidence: Mapped[str] = mapped_column(String(10))  # "low", "nominal" or "high"
    frp_mw: Mapped[float | None] = mapped_column(Double)  # fire radiative power, megawatts
    brightness_k: Mapped[float | None] = mapped_column(Double)  # brightness temperature, kelvin
    day_night: Mapped[str] = mapped_column(String(1))  # "D" or "N"
    playback: Mapped[bool] = mapped_column(default=False)  # True for a downloaded past dataset
    event_id: Mapped[str | None] = mapped_column(ForeignKey("fire_events.id"), index=True)


class CheckIn(Base):
    """One fire event, sent to one nearby organization."""

    __tablename__ = "check_ins"
    # The database itself refuses a second check-in for the same fire and organization.
    __table_args__ = (UniqueConstraint("event_id", "organization_id", name="uq_check_in_event_org"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("chk"))
    event_id: Mapped[str] = mapped_column(ForeignKey("fire_events.id"))
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    distance_km: Mapped[float] = mapped_column(Double)
    nearest_latitude: Mapped[float] = mapped_column(Double)
    nearest_longitude: Mapped[float] = mapped_column(Double)
    nearest_detected_at: Mapped[datetime]
    detection_count: Mapped[int]
    summary: Mapped[str] = mapped_column(Text)
    question: Mapped[str] = mapped_column(Text)
    suggested_items: Mapped[list] = mapped_column(JSON, default=list)
    draft_source: Mapped[str] = mapped_column(String(10))  # "gemini" or "template"
    response: Mapped[str | None] = mapped_column(String(20))  # empty until staff answer
    responded_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    event: Mapped[FireEvent] = relationship()


class AidRequest(Base):
    """Something an organization needs. The API calls these "requests"."""

    __tablename__ = "aid_requests"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("req"))
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    title: Mapped[str] = mapped_column(String(160))
    item: Mapped[str] = mapped_column(String(120))
    quantity: Mapped[int]
    fulfilled: Mapped[int] = mapped_column(default=0)  # confirmed received; only confirmations change it
    unit: Mapped[str] = mapped_column(String(40))
    urgency: Mapped[str] = mapped_column(String(10))  # "urgent" or "standard"
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(10), default="published")  # "published" or "closed"
    check_in_id: Mapped[str | None] = mapped_column(ForeignKey("check_ins.id"), index=True)
    donate_url: Mapped[str | None] = mapped_column(String(500))
    supplies_url: Mapped[str | None] = mapped_column(String(500))
    volunteer_url: Mapped[str | None] = mapped_column(String(500))
    confirmed_at: Mapped[datetime] = mapped_column(default=utcnow)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)
    # Gemini embedding of the request text, used by TiDB vector search. Empty until computed;
    # "deferred" keeps the 768 numbers out of ordinary queries.
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIMENSIONS), deferred=True)

    organization: Mapped[Organization] = relationship(back_populates="requests")


class Contribution(Base):
    """A supporter's pledge. Each one becomes a star in My Cosmos."""

    __tablename__ = "contributions"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("con"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    request_id: Mapped[str | None] = mapped_column(ForeignKey("aid_requests.id"), index=True)
    kind: Mapped[str] = mapped_column(String(10))  # "donate", "supplies" or "volunteer"
    quantity: Mapped[int]
    confirmed_quantity: Mapped[int | None]
    note: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), default="pledged")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    reported_at: Mapped[datetime | None]
    confirmed_at: Mapped[datetime | None]

    organization: Mapped[Organization] = relationship()
    request: Mapped[AidRequest | None] = relationship()
