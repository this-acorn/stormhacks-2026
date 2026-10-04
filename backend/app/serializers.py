"""Turn database rows into the API's JSON shapes."""

from app.auth import is_staff_of
from app.models import AidRequest, CheckIn, Contribution, Organization, User
from app.schemas import (
    AidRequestOut,
    ContributionOut,
    ObservationOut,
    OrganizationOut,
    OrganizationSummary,
    SessionOut,
    SupportLinks,
)

DETECTION_SOURCE = "NASA FIRMS · VIIRS NOAA-20 (375 m)"


def request_out(r: AidRequest) -> AidRequestOut:
    return AidRequestOut(
        id=r.id,
        organization_id=r.organization_id,
        title=r.title,
        item=r.item,
        quantity=r.quantity,
        fulfilled=r.fulfilled,
        unit=r.unit,
        urgency=r.urgency,
        description=r.description,
        status=r.status,
        confirmed_at=r.confirmed_at,
        observation_id=r.check_in_id,
        links=SupportLinks(donate=r.donate_url, supplies=r.supplies_url, volunteer=r.volunteer_url),
        created_at=r.created_at,
        updated_at=r.updated_at,
    )


def organization_out(o: Organization, viewer: User | None) -> OrganizationOut:
    # Everyone sees published requests; the organization's own staff also see closed ones.
    staff = is_staff_of(viewer, o.id)
    requests = sorted(
        (r for r in o.requests if staff or r.status == "published"), key=lambda r: r.created_at, reverse=True
    )
    return OrganizationOut(
        id=o.id,
        name=o.name,
        type=o.type,
        location=o.location,
        coordinates=(o.longitude, o.latitude),
        situation=o.situation,
        description=o.description,
        links=SupportLinks(website=o.website_url, donate=o.donate_url, supplies=o.supplies_url, volunteer=o.volunteer_url),
        updated_at=o.updated_at,
        sample=o.sample,
        volunteer_role=o.volunteer_role,
        volunteer_slots=o.volunteer_slots,
        requests=[request_out(r) for r in requests],
    )


def organization_summary(o: Organization) -> OrganizationSummary:
    return OrganizationSummary(id=o.id, name=o.name, location=o.location, type=o.type)


def observation_out(c: CheckIn, viewer: User | None) -> ObservationOut:
    # The question, the answer and the AI-suggested items stay private to the organization's staff.
    staff = is_staff_of(viewer, c.organization_id)
    return ObservationOut(
        id=c.id,
        organization_id=c.organization_id,
        title="Satellite fire detections nearby",
        summary=c.summary,
        coordinates=(c.nearest_longitude, c.nearest_latitude),
        source=DETECTION_SOURCE,
        observed_at=c.nearest_detected_at,
        proximity_km=round(c.distance_km, 1),
        simulated=False,
        playback=c.event.playback,
        detection_count=c.detection_count,
        draft_source=c.draft_source,
        question=c.question if staff else None,
        response=c.response if staff else None,
        responded_at=c.responded_at if staff else None,
        suggested_items=c.suggested_items if staff else [],
    )


def contribution_summary(c: Contribution) -> str:
    if c.kind == "donate":
        return f"${c.quantity} USD contribution"
    if c.kind == "volunteer":
        return f"{c.quantity} hour{'' if c.quantity == 1 else 's'} of volunteer time"
    if c.request is not None:
        return f"{c.quantity} {c.request.unit} · {c.request.item}"
    return f"{c.quantity} items"


def contribution_out(c: Contribution, supporter_name: str | None = None) -> ContributionOut:
    return ContributionOut(
        id=c.id,
        organization_id=c.organization_id,
        organization_name=c.organization.name,
        request_id=c.request_id,
        kind=c.kind,
        summary=contribution_summary(c),
        quantity=c.quantity,
        confirmed_quantity=c.confirmed_quantity,
        created_at=c.created_at,
        status=c.status,
        reported_at=c.reported_at,
        confirmed_at=c.confirmed_at,
        simulated=True,
        supporter_name=supporter_name,
    )


def session_out(u: User) -> SessionOut:
    return SessionOut(id=u.id, name=u.name, role=u.role, organization_id=u.organization_id, demo=True)
