from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.auth import current_user, sign_in, sign_out, user_from_cookie
from app.db import get_db
from app.errors import ApiError
from app.models import CheckIn, Contribution, Organization, User
from app.schemas import BootstrapOut, DemoLoginIn, SessionOut
from app.seed import DEFAULT_STAFF_ORGANIZATION, SUPPORTER_ID
from app.serializers import contribution_out, observation_out, organization_out, session_out

router = APIRouter(tags=["session"])


@router.post("/auth/demo", response_model=SessionOut, response_model_exclude_none=True)
def demo_sign_in(body: DemoLoginIn, response: Response, db: Session = Depends(get_db)):
    """Sign in as a seeded demo account. Each staff account belongs to exactly one organization."""
    if body.role == "supporter":
        user = db.get(User, SUPPORTER_ID)
    else:
        organization_id = body.organization_id or DEFAULT_STAFF_ORGANIZATION
        user = db.scalars(
            select(User).where(User.role == "staff", User.organization_id == organization_id).order_by(User.id)
        ).first()
    if user is None:
        raise ApiError(404, "There is no demo account for that role and organization.")
    sign_in(response, user)
    return session_out(user)


@router.post("/auth/logout", status_code=204)
def demo_sign_out():
    response = Response(status_code=204)
    sign_out(response)
    return response


@router.get("/me", response_model=SessionOut, response_model_exclude_none=True)
def me(user: User = Depends(current_user)):
    return session_out(user)


@router.get("/bootstrap", response_model=BootstrapOut, response_model_exclude_none=True)
def bootstrap(request: Request, response: Response, db: Session = Depends(get_db)):
    """Everything the explore screen needs in one call. Visitors start as the demo supporter."""
    user = user_from_cookie(request, db)
    if user is None:
        user = db.get(User, SUPPORTER_ID)
        if user is None:
            raise ApiError(503, "The demo data is missing. Run python -m app.init_db first.")
        sign_in(response, user)
    organizations = db.scalars(select(Organization).order_by(Organization.name))
    check_ins = db.scalars(select(CheckIn).options(selectinload(CheckIn.event)).order_by(CheckIn.created_at.desc()))
    contributions = db.scalars(
        select(Contribution)
        .where(Contribution.user_id == user.id)
        .options(selectinload(Contribution.organization), selectinload(Contribution.request))
        .order_by(Contribution.created_at.desc())
    )
    return BootstrapOut(
        organizations=[organization_out(o, user) for o in organizations],
        observations=[observation_out(c, user) for c in check_ins],
        contributions=[contribution_out(c) for c in contributions],
        session=session_out(user),
    )
