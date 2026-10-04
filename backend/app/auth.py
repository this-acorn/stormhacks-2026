"""Demo sign-in with a signed, HTTP-only cookie. The server decides who you are and what you may do."""

from fastapi import Depends, Request, Response
from itsdangerous import BadSignature, URLSafeTimedSerializer
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.errors import ApiError
from app.models import User

settings = get_settings()

COOKIE_NAME = "aidatlas_session"
MAX_AGE_SECONDS = 7 * 24 * 60 * 60
# Signing means the browser can hold the cookie but cannot change it: any edit breaks the signature.
_signer = URLSafeTimedSerializer(settings.session_secret.get_secret_value(), salt="aidatlas-session")


def sign_in(response: Response, user: User) -> None:
    response.set_cookie(
        COOKIE_NAME,
        _signer.dumps({"uid": user.id}),
        max_age=MAX_AGE_SECONDS,
        httponly=True,  # page JavaScript cannot read it
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


def sign_out(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")


def user_from_cookie(request: Request, db: Session) -> User | None:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    try:
        data = _signer.loads(token, max_age=MAX_AGE_SECONDS)
    except BadSignature:  # tampered with or expired
        return None
    return db.get(User, data.get("uid"))


def optional_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    return user_from_cookie(request, db)


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    user = user_from_cookie(request, db)
    if user is None:
        raise ApiError(401, "Sign in to continue.")
    return user


def is_staff_of(user: User | None, organization_id: str) -> bool:
    return user is not None and user.role == "staff" and user.organization_id == organization_id


def require_staff(user: User, organization_id: str, action: str) -> None:
    if not is_staff_of(user, organization_id):
        raise ApiError(403, f"Only staff of this organization can {action}.")
