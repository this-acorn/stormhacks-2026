import logging

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from app.errors import ApiError
from app.education import education_store
from app.live_fires import latest_fires_body
from app.smoke_forecast import latest_smoke_forecast
from app.nature_imagery import month_bounds, monthly_mosaic
from app.nature_overview import overview_catalog, overview_store

router = APIRouter(prefix="/hazards", tags=["hazards"])
log = logging.getLogger(__name__)


@router.get("/education")
def education():
    """Last validated UIS release plus honest background-refresh status."""
    try:
        data = education_store.snapshot()
    except ValueError as error:
        raise ApiError(503, "Education data is being prepared. Please retry shortly.") from error
    return JSONResponse(data, headers={"Cache-Control": "no-store"})


@router.get("/nature")
def nature():
    try:
        data = overview_catalog()
    except (httpx.HTTPError, ValueError) as error:
        log.warning("Sentinel-2 catalog unavailable: %s", error)
        raise ApiError(503, "Monthly satellite imagery is temporarily unavailable. Please retry.") from error
    return JSONResponse(data, headers={"Cache-Control": "no-store"})


@router.get("/nature/overview/{month}/{z}/{x}/{y}.png")
def nature_overview_tile(month: str, z: int, x: int, y: int):
    try:
        path = overview_store.tile(month, z, x, y)
    except ValueError as error:
        raise ApiError(400, str(error)) from error
    except FileNotFoundError as error:
        raise ApiError(404, str(error)) from error
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})


@router.get("/nature/{month}")
def nature_month(month: str):
    try:
        month_bounds(month)
    except ValueError as error:
        raise ApiError(400, str(error)) from error
    try:
        data = monthly_mosaic(month)
    except (httpx.HTTPError, ValueError) as error:
        log.warning("Sentinel-2 mosaic unavailable: %s", error)
        raise ApiError(503, "Imagery for this month is unavailable. Please choose another month or retry.") from error
    return JSONResponse(data, headers={"Cache-Control": "private, max-age=3600"})


@router.get("/smoke")
def smoke():
    """The actual published hourly forecast range; raster tiles are served by ECCC GeoMet."""
    try:
        data = latest_smoke_forecast()
    except (httpx.HTTPError, ValueError) as error:
        log.warning("Smoke forecast unavailable: %s", error)
        raise ApiError(503, "Smoke forecast is temporarily unavailable.") from error
    return JSONResponse(data, headers={"Cache-Control": "no-store"})


@router.get("/wildfire")
def wildfire(request: Request):
    """Public current observations; never returns demo/replay data or an old bundled snapshot."""
    gzipped = "gzip" in request.headers.get("accept-encoding", "")
    try:
        body = latest_fires_body(gzipped)
    except (httpx.HTTPError, ValueError) as error:
        log.warning("FIRMS observations unavailable: %s", error)
        raise ApiError(503, "Latest satellite observations are temporarily unavailable. Please retry.") from error
    # Already compressed once per download; GZipMiddleware leaves a response with Content-Encoding alone.
    headers = {"Cache-Control": "no-store", "Vary": "Accept-Encoding"}
    if gzipped:
        headers["Content-Encoding"] = "gzip"
    return Response(body, media_type="application/json", headers=headers)
