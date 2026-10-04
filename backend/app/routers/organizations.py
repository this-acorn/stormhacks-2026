from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import ai
from app.auth import current_user, is_staff_of, optional_user, require_staff
from app.db import get_db
from app.errors import ApiError, not_found
from app.models import AidRequest, CheckIn, Organization, User, new_id, utcnow
from app.schemas import (
    AidRequestOut,
    OrganizationOut,
    RequestDraftIn,
    RequestDraftOut,
    RequestIn,
    RequestPatch,
    RequestStatus,
    SupportLinksInput,
)
from app.search import try_embed
from app.serializers import organization_out, request_out

router = APIRouter(tags=["organizations"])


def _organization(db: Session, organization_id: str) -> Organization:
    organization = db.get(Organization, organization_id)
    if organization is None:
        raise not_found("Organization")
    return organization


def _check_in_for(db: Session, check_in_id: str | None, organization_id: str) -> str | None:
    if check_in_id is None:
        return None
    check_in = db.get(CheckIn, check_in_id)
    if check_in is None or check_in.organization_id != organization_id:
        message = "This satellite check-in does not belong to your organization."
        raise ApiError(422, message, fields={"observationId": message})
    return check_in.id


@router.get("/organizations", response_model=list[OrganizationOut], response_model_exclude_none=True)
def list_organizations(viewer: User | None = Depends(optional_user), db: Session = Depends(get_db)):
    return [organization_out(o, viewer) for o in db.scalars(select(Organization).order_by(Organization.name))]


@router.get("/organizations/{organization_id}", response_model=OrganizationOut, response_model_exclude_none=True)
def get_organization(organization_id: str, viewer: User | None = Depends(optional_user), db: Session = Depends(get_db)):
    return organization_out(_organization(db, organization_id), viewer)


@router.get("/requests", response_model=list[AidRequestOut], response_model_exclude_none=True)
def list_requests(
    organization_id: str | None = Query(default=None, alias="organizationId"),
    status: RequestStatus | None = None,
    viewer: User | None = Depends(optional_user),
    db: Session = Depends(get_db),
):
    query = select(AidRequest).order_by(AidRequest.created_at.desc())
    if organization_id:
        query = query.where(AidRequest.organization_id == organization_id)
    if status:
        query = query.where(AidRequest.status == status)
    # Closed requests are visible only to the organization's own staff.
    return [
        request_out(r)
        for r in db.scalars(query)
        if r.status == "published" or is_staff_of(viewer, r.organization_id)
    ]


@router.post(
    "/organizations/{organization_id}/requests",
    status_code=201,
    response_model=AidRequestOut,
    response_model_exclude_none=True,
)
def create_request(organization_id: str, body: RequestIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Publish a request. Only the organization's staff can, and only with `confirmed: true`."""
    _organization(db, organization_id)
    require_staff(user, organization_id, "publish requests")
    links = body.links or SupportLinksInput()
    request = AidRequest(
        id=new_id("req"),
        organization_id=organization_id,
        title=body.title,
        item=body.item,
        quantity=body.quantity,
        unit=body.unit,
        urgency=body.urgency,
        description=body.description,
        status="published",
        check_in_id=_check_in_for(db, body.observation_id, organization_id),
        donate_url=links.donate,
        supplies_url=links.supplies,
        volunteer_url=links.volunteer,
        confirmed_at=utcnow(),
    )
    db.add(request)
    db.commit()
    try_embed(db, request)
    return request_out(request)


@router.post("/organizations/{organization_id}/requests/draft", response_model=RequestDraftOut)
def draft_request(
    organization_id: str, body: RequestDraftIn, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    """Gemini turns the staff's own words into request fields. Nothing is saved; the staff publish it."""
    organization = _organization(db, organization_id)
    require_staff(user, organization_id, "draft requests")
    try:
        draft = ai.draft_request(f"{organization.name}, a {organization.type} in {organization.location}", body.text)
    except ai.AIUnavailable:
        raise ApiError(503, "AI drafting is unavailable right now. Please fill in the form instead.") from None
    missing = [field for field in ("title", "item", "quantity", "unit", "description") if getattr(draft, field) is None]
    return RequestDraftOut(**draft.model_dump(), missing=missing)


@router.patch(
    "/organizations/{organization_id}/requests/{request_id}",
    response_model=AidRequestOut,
    response_model_exclude_none=True,
)
def update_request(
    organization_id: str,
    request_id: str,
    body: RequestPatch,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Edit, close or reopen a request. Only the organization's own staff can."""
    request = db.get(AidRequest, request_id)
    if request is None or request.organization_id != organization_id:
        raise not_found("Request")
    require_staff(user, organization_id, "edit its requests")

    changes = {
        field: value
        for field, value in body.model_dump(exclude_unset=True, exclude={"confirmed", "links", "observation_id"}).items()
        if value is not None
    }
    if "quantity" in changes and changes["quantity"] < request.fulfilled:
        message = f"The total cannot be less than the {request.fulfilled} {request.unit} already received."
        raise ApiError(422, message, fields={"quantity": message})
    for field, value in changes.items():
        setattr(request, field, value)
    if "observation_id" in body.model_fields_set:
        request.check_in_id = _check_in_for(db, body.observation_id, organization_id)
    if "links" in body.model_fields_set:
        links = body.links or SupportLinksInput()
        request.donate_url, request.supplies_url, request.volunteer_url = links.donate, links.supplies, links.volunteer

    content_changed = bool(body.model_fields_set - {"status", "confirmed"})
    if content_changed:
        request.confirmed_at = utcnow()
        request.embedding = None  # the old vector describes the old text
    db.commit()
    if content_changed:
        try_embed(db, request)
    return request_out(request)
