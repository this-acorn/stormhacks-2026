"""Gemini calls: check-in drafts, requests written from staff's own words, and text embeddings.

Every function raises AIUnavailable when Gemini is not configured, fails, or returns something
unusable. Callers catch it and fall back (template drafts, keyword search), so the app keeps working.
"""

import logging
from functools import lru_cache
from typing import Literal

from google import genai
from google.genai import types
from pydantic import BaseModel, Field, field_validator

from app.config import get_settings
from app.models import EMBEDDING_DIMENSIONS
from app.schemas import MAX_QUANTITY

log = logging.getLogger("aidatlas.ai")
settings = get_settings()


class AIUnavailable(Exception):
    """Gemini could not produce a usable answer."""


@lru_cache
def _client() -> genai.Client:
    if settings.gemini_api_key is None:
        raise AIUnavailable("GEMINI_API_KEY is not set")
    return genai.Client(
        api_key=settings.gemini_api_key.get_secret_value(),
        http_options=types.HttpOptions(timeout=settings.gemini_timeout_ms),
    )


# We pass no tools, so automatic function calling is off (which also stops the SDK's warning about it).
NO_AFC = types.AutomaticFunctionCallingConfig(disable=True)


# ----- Embeddings --------------------------------------------------------------------------

EMBED_BATCH = 50


def embed(texts: list[str], task_type: str) -> list[list[float]]:
    """Embed texts with Gemini. task_type is RETRIEVAL_DOCUMENT for stored text, RETRIEVAL_QUERY for searches."""
    vectors: list[list[float]] = []
    for start in range(0, len(texts), EMBED_BATCH):
        batch = texts[start : start + EMBED_BATCH]
        try:
            result = _client().models.embed_content(
                model=settings.gemini_embed_model,
                contents=batch,
                config=types.EmbedContentConfig(task_type=task_type, output_dimensionality=EMBEDDING_DIMENSIONS),
            )
            vectors.extend(list(e.values) for e in result.embeddings)
        except AIUnavailable:
            raise
        except Exception as exc:
            log.warning("Gemini embedding failed: %s", exc)
            raise AIUnavailable(str(exc)) from exc
    if len(vectors) != len(texts) or any(len(v) != EMBEDDING_DIMENSIONS for v in vectors):
        raise AIUnavailable("Gemini returned embeddings of an unexpected shape")
    return vectors


# ----- Check-in drafts ---------------------------------------------------------------------


class _DraftItemSchema(BaseModel):
    item: str
    quantity: int
    unit: str


class _DraftSchema(BaseModel):
    """What Gemini is asked to return (kept simple so the API accepts it as a response schema)."""

    question: str
    suggested_items: list[_DraftItemSchema]


class DraftItem(BaseModel):
    item: str = Field(min_length=1, max_length=120)
    quantity: int = Field(ge=1, le=10_000)
    unit: str = Field(min_length=1, max_length=40)


class CheckInDraft(BaseModel):
    """The same shape with limits, checked before anything is saved."""

    question: str = Field(min_length=20, max_length=700)
    suggested_items: list[DraftItem] = Field(min_length=1, max_length=4)


DRAFT_PROMPT = """You help staff of a community organization respond to a satellite alert inside the AidAtlas app.
Write a short in-app check-in for the staff of the organization described below.

Rules:
- The satellite data are heat detections. They do not show damage, evacuation or need. Never say or imply that the organization is affected.
- "question": two or three short sentences addressed to the staff as "you". State the satellite facts neutrally (how far away and when), then ask whether their site is affected and whether they need support.
- "suggested_items": two to four supplies this kind of organization often needs when wildfire smoke or evacuations are nearby, with modest starting quantities and simple units. They are a draft for staff to edit, not a request.
- Plain English. No emojis, no markdown.

Organization and observation:
{facts}
"""


def draft_check_in(facts: str) -> CheckInDraft:
    try:
        response = _client().models.generate_content(
            model=settings.gemini_model,
            contents=DRAFT_PROMPT.format(facts=facts),
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=_DraftSchema,
                temperature=0.3,
                automatic_function_calling=NO_AFC,
            ),
        )
        raw = response.parsed.model_dump() if isinstance(response.parsed, _DraftSchema) else response.text
        return CheckInDraft.model_validate(raw) if isinstance(raw, dict) else CheckInDraft.model_validate_json(raw)
    except AIUnavailable:
        raise
    except Exception as exc:  # network errors, quota, unexpected model output, failed validation
        log.warning("Gemini check-in draft failed: %s", exc)
        raise AIUnavailable(str(exc)) from exc


# ----- Requests from staff's own words -----------------------------------------------------


class _RequestDraftSchema(BaseModel):
    """What Gemini is asked to return. A detail the staff did not give comes back null."""

    title: str | None
    item: str | None
    quantity: int | None
    unit: str | None
    urgency: Literal["urgent", "standard"]
    description: str | None
    other_needs: list[str]


class RequestDraft(BaseModel):
    """The same shape with the request limits. A value that breaks them is dropped, not published."""

    title: str | None = None
    item: str | None = None
    quantity: int | None = None
    unit: str | None = None
    urgency: Literal["urgent", "standard"] = "standard"
    description: str | None = None
    other_needs: list[str] = []

    @field_validator("title", "item", "unit", "description", mode="before")
    @classmethod
    def blank_or_too_long_is_missing(cls, value: object, info) -> object:
        limits = {"title": 100, "item": 80, "unit": 24, "description": 700}  # the request form's limits
        if isinstance(value, str):
            value = value.strip()
            return value if 0 < len(value) <= limits[info.field_name] else None
        return value

    @field_validator("quantity", mode="before")
    @classmethod
    def out_of_range_is_missing(cls, value: object) -> object:
        return value if isinstance(value, int) and 1 <= value <= MAX_QUANTITY else None

    @field_validator("other_needs", mode="before")
    @classmethod
    def keep_a_few(cls, value: object) -> object:
        return [v.strip()[:120] for v in value if isinstance(v, str) and v.strip()][:5] if isinstance(value, list) else []


REQUEST_PROMPT = """You turn a staff member's own words into an aid request inside the AidAtlas app.
Supporters read the request and decide how to help, so it must say only what the staff said.

Rules:
- Use only the staff's words. Never invent quantities, dates, places, purposes or reasons.
- The organization details are context only. Do not repeat its name or location; the app already shows them.
- One request covers one need. If the staff mention several, use the one they mention first and list the others in "other_needs" as short phrases. The title and description cover only the chosen need.
- "item": what is needed, such as "Volunteers" or "Bottled water".
- "quantity": how many of the item itself the staff asked for ("at least 10 volunteers" is 10). A number of people or families to be helped is not a quantity of the item: "water for 30 families" has quantity null, and the 30 families go in the description. If the staff give no quantity of the item, quantity is null.
- "unit": the natural unit for counting the item ("people" for volunteers, "blankets", "cases"), even when quantity is null.
- "urgency": "urgent" only if the staff say it is urgent, immediate or needed today; otherwise "standard".
- "title": a short headline of at most 8 words in sentence case (capitalize only the first word and names).
- "description": one or two plain sentences in the organization's voice ("We need..."), restating only the staff's facts.
- Write in English even if the staff wrote in another language. No emojis, no markdown.
- Use null for any other detail the staff did not give.

Organization: {organization}

Staff's words:
{text}
"""


def draft_request(organization: str, text: str) -> RequestDraft:
    try:
        response = _client().models.generate_content(
            model=settings.gemini_model,
            contents=REQUEST_PROMPT.format(organization=organization, text=text),
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=_RequestDraftSchema,
                temperature=0.2,
                automatic_function_calling=NO_AFC,
            ),
        )
        raw = response.parsed.model_dump() if isinstance(response.parsed, _RequestDraftSchema) else response.text
        return RequestDraft.model_validate(raw) if isinstance(raw, dict) else RequestDraft.model_validate_json(raw)
    except AIUnavailable:
        raise
    except Exception as exc:  # network errors, quota, unexpected model output, failed validation
        log.warning("Gemini request draft failed: %s", exc)
        raise AIUnavailable(str(exc)) from exc
