from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.auth import current_user, require_staff
from app.db import get_db
from app.errors import ApiError, not_found
from app.models import AidRequest, Contribution, Organization, User, new_id, utcnow
from app.schemas import ContributionIn, ContributionOut, ContributionStatusIn
from app.serializers import contribution_out

router = APIRouter(tags=["contributions"])


@router.post("/contributions", status_code=201, response_model=ContributionOut, response_model_exclude_none=True)
def create_contribution(body: ContributionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Record a pledge. A pledge is intent only: it never changes what an organization has received."""
    organization = db.get(Organization, body.organization_id)
    if organization is None:
        raise not_found("Organization")
    request = None
    if body.request_id:
        request = db.get(AidRequest, body.request_id)
        if request is None or request.organization_id != organization.id:
            raise not_found("Request")
    if body.kind == "supplies":
        if request is None:
            message = "Choose which request these supplies are for."
            raise ApiError(422, message, fields={"requestId": message})
        if request.status != "published":
            raise ApiError(409, "This request is closed and no longer accepts pledges.")
        if body.quantity > request.quantity - request.fulfilled:
            raise ApiError(409, "This quantity is no longer needed. Refresh and choose a smaller quantity.")
    contribution = Contribution(
        id=new_id("con"),
        user_id=user.id,
        organization_id=organization.id,
        request_id=request.id if request else None,
        kind=body.kind,
        quantity=body.quantity,
        note=body.note,
        status="pledged",
    )
    db.add(contribution)
    db.commit()
    return contribution_out(contribution)


@router.get("/me/contributions", response_model=list[ContributionOut], response_model_exclude_none=True)
def my_contributions(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The signed-in user's contributions, newest first: the stars of My Cosmos."""
    rows = db.scalars(
        select(Contribution)
        .where(Contribution.user_id == user.id)
        .options(selectinload(Contribution.organization), selectinload(Contribution.request))
        .order_by(Contribution.created_at.desc())
    )
    return [contribution_out(c) for c in rows]


@router.get(
    "/organizations/{organization_id}/contributions",
    response_model=list[ContributionOut],
    response_model_exclude_none=True,
)
def organization_contributions(organization_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Pledges made to an organization, for its staff to review and confirm."""
    if db.get(Organization, organization_id) is None:
        raise not_found("Organization")
    require_staff(user, organization_id, "view its contributions")
    rows = db.execute(
        select(Contribution, User.name)
        .join(User, Contribution.user_id == User.id)
        .where(Contribution.organization_id == organization_id)
        .order_by(Contribution.created_at.desc())
    )
    return [contribution_out(c, supporter_name=name) for c, name in rows]


@router.patch("/contributions/{contribution_id}/status", response_model=ContributionOut, response_model_exclude_none=True)
def change_status(
    contribution_id: str,
    body: ContributionStatusIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Supporters mark their pledge completed; organization staff confirm what actually arrived."""
    if body.status == "user_reported_completed":
        contribution = _report_completed(db, contribution_id, user)
    else:
        contribution = _confirm(db, contribution_id, user, body.confirmed_quantity)
    return contribution_out(contribution)


def _report_completed(db: Session, contribution_id: str, user: User) -> Contribution:
    contribution = db.get(Contribution, contribution_id, with_for_update=True)
    if contribution is None:
        raise not_found("Contribution")
    if contribution.user_id != user.id:
        raise ApiError(403, "Only the supporter who made this pledge can mark it completed.")
    if contribution.status == "organization_confirmed":
        raise ApiError(409, "The organization has already confirmed this contribution.")
    if contribution.status == "pledged":
        contribution.status = "user_reported_completed"
        contribution.reported_at = utcnow()
        db.commit()
    return contribution


def _confirm(db: Session, contribution_id: str, user: User, confirmed_quantity: int | None) -> Contribution:
    # SELECT ... FOR UPDATE locks the row until we commit, so two confirmations arriving at the same
    # moment run one after the other and the second one sees the first one's result.
    contribution = db.get(Contribution, contribution_id, with_for_update=True)
    if contribution is None:
        raise not_found("Contribution")
    require_staff(user, contribution.organization_id, "confirm its contributions")
    if contribution.status == "organization_confirmed":
        db.rollback()
        return contribution  # already counted once; confirming again changes nothing
    quantity = confirmed_quantity or contribution.quantity
    if contribution.kind == "supplies" and contribution.request_id:
        request = db.get(AidRequest, contribution.request_id, with_for_update=True)
        request.fulfilled += quantity
    contribution.status = "organization_confirmed"
    contribution.confirmed_quantity = quantity
    contribution.confirmed_at = utcnow()
    db.commit()  # the new status and the new fulfilled count are saved together, or not at all
    return contribution
