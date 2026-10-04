"""One error format for every response: {"detail": "...", "code": "...", "fields": {...}}.

`detail` is always a sentence the frontend can show as is; `fields` appears on validation errors.
"""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("aidatlas")

CODES = {
    400: "bad_request",
    401: "not_authenticated",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    422: "validation_error",
    503: "service_unavailable",
}


class ApiError(Exception):
    def __init__(self, status: int, detail: str, code: str | None = None, fields: dict[str, str] | None = None):
        super().__init__(detail)
        self.status = status
        self.detail = detail
        self.code = code or CODES.get(status, "error")
        self.fields = fields


def not_found(what: str) -> ApiError:
    return ApiError(404, f"{what} not found.")


def _body(detail: str, code: str, fields: dict[str, str] | None = None) -> dict:
    body = {"detail": detail, "code": code}
    if fields:
        body["fields"] = fields
    return body


def _field_name(loc) -> str:
    # ("body", "quantity") -> "quantity"; ("body", "links", "donate") -> "links.donate"
    parts = [str(part) for part in loc if part not in ("body", "query", "path")]
    return ".".join(parts) or "body"


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_error(_request: Request, exc: ApiError):
        return JSONResponse(_body(exc.detail, exc.code, exc.fields), status_code=exc.status)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_request: Request, exc: StarletteHTTPException):
        detail = exc.detail if isinstance(exc.detail, str) else "The request could not be completed."
        if exc.status_code == 404 and detail == "Not Found":
            detail = "This API endpoint does not exist."
        return JSONResponse(
            _body(detail, CODES.get(exc.status_code, "error")),
            status_code=exc.status_code,
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, exc: RequestValidationError):
        fields: dict[str, str] = {}
        sentences: list[str] = []
        for err in exc.errors():
            name = _field_name(err.get("loc", ()))
            if name in fields:
                continue
            msg = err.get("msg", "Invalid value")
            if msg.startswith("Value error, "):
                # Our own validators already write full sentences.
                fields[name] = msg.removeprefix("Value error, ")
                sentences.append(fields[name])
            else:
                fields[name] = f"{msg}."
                sentences.append(f"{msg}." if name == "body" else f"{name}: {msg}.")
        detail = sentences[0] if len(sentences) == 1 else f"Check these fields: {', '.join(fields)}."
        return JSONResponse(_body(detail, "validation_error", fields), status_code=422)

    @app.exception_handler(OperationalError)
    async def database_unavailable(_request: Request, exc: OperationalError):
        log.exception("Database error")
        return JSONResponse(
            _body("The database is unavailable right now. Please try again shortly.", "service_unavailable"),
            status_code=503,
        )

    @app.exception_handler(Exception)
    async def unexpected(_request: Request, exc: Exception):
        log.exception("Unhandled error")
        return JSONResponse(_body("Something went wrong on our side. Please try again.", "internal_error"), status_code=500)
