"""AI search over published requests: Gemini embeddings, ranked by TiDB vector search.

If Gemini or TiDB vector search is unavailable, a keyword search answers instead, and the response
says so (method = "keyword_fallback"), so keyword matching is never presented as AI search.
"""

import logging
import re

from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session, selectinload

from app import ai
from app.db import is_tidb
from app.models import AidRequest, to_vector_literal
from app.schemas import SearchOut, SearchResultOut
from app.serializers import organization_summary, request_out

log = logging.getLogger("aidatlas.search")

# Cosine distance is 0 for vectors pointing the same way; the score shown is 1 - distance.
VECTOR_SEARCH_SQL = text(
    """
    SELECT id, VEC_COSINE_DISTANCE(embedding, VEC_FROM_TEXT(:query_vector)) AS distance
    FROM aid_requests
    WHERE status = 'published' AND embedding IS NOT NULL
    ORDER BY distance
    LIMIT :limit
    """
)


def request_text(r: AidRequest) -> str:
    """The text that gets embedded: the request plus who asks for it."""
    o = r.organization
    return f"{r.item}. {r.title}. {r.description} Requested by {o.name}, a {o.type.lower()} in {o.location}. {o.situation}"


def embed_missing(db: Session) -> int:
    """Embed requests without a vector yet: new, edited, or added while Gemini was down."""
    missing = list(
        db.scalars(
            select(AidRequest).where(AidRequest.embedding.is_(None)).options(selectinload(AidRequest.organization))
        )
    )
    if not missing:
        return 0
    vectors = ai.embed([request_text(r) for r in missing], "RETRIEVAL_DOCUMENT")
    for r, vector in zip(missing, vectors):
        r.embedding = vector
    db.commit()
    return len(missing)


def try_embed(db: Session, request: AidRequest) -> None:
    """Embed one request now. If Gemini is down, the next search embeds it instead."""
    if not is_tidb():
        return
    try:
        request.embedding = ai.embed([request_text(request)], "RETRIEVAL_DOCUMENT")[0]
        db.commit()
    except ai.AIUnavailable:
        db.rollback()


STOPWORDS = {
    "a", "an", "and", "any", "are", "can", "for", "from", "give", "have", "help", "i", "in", "into", "like",
    "me", "my", "need", "of", "our", "send", "some", "that", "the", "this", "to", "want", "we", "who", "with",
    "would", "you", "your", "donate", "something",
}
WORD = re.compile(r"[a-z0-9]+")


def _stem(word: str) -> str:
    return word[:5]  # crude, but lets "clothes" match "clothing" and "children" match "child"


def keyword_ranking(db: Session, query: str, limit: int) -> list[tuple[str, float, list[str]]]:
    """Plain word matching over item, title, description and organization text."""
    terms: dict[str, str] = {}
    for word in WORD.findall(query.lower()):
        if len(word) > 2 and word not in STOPWORDS:
            terms.setdefault(_stem(word), word)
    if not terms:
        return []
    published = db.scalars(
        select(AidRequest).where(AidRequest.status == "published").options(selectinload(AidRequest.organization))
    )
    scored = []
    for r in published:
        o = r.organization
        score, matched = 0.0, set()
        for field_text, weight in ((f"{r.item} {r.title}", 3.0), (r.description, 1.0), (f"{o.name} {o.type} {o.situation}", 1.0)):
            hits = terms.keys() & {_stem(w) for w in WORD.findall(field_text.lower())}
            score += weight * len(hits)
            matched |= hits
        if score:
            scored.append((r.id, score, sorted(terms[stem] for stem in matched)))
    scored.sort(key=lambda s: -s[1])
    top = scored[:limit]
    best = top[0][1] if top else 1.0
    return [(rid, score / best, words) for rid, score, words in top]


def explain(r: AidRequest, method: str, words: list[str]) -> str:
    """A match explanation built only from the request's own stored fields."""
    o = r.organization
    remaining = max(r.quantity - r.fulfilled, 0)
    first_sentence = r.description.split(". ")[0].rstrip(".")
    if method == "tidb_vector":
        basis = "Close in meaning to your search"
    else:
        basis = "Contains the words " + ", ".join(f"“{w}”" for w in words)
    return (
        f"{basis}: {o.name} ({o.type}, {o.location}) asks for “{r.item}”, with {remaining} of "
        f"{r.quantity} {r.unit} still needed. “{first_sentence}.”"
    )


def search(db: Session, query: str, limit: int) -> SearchOut:
    try:
        if not is_tidb():
            raise ai.AIUnavailable("vector search needs the TiDB database")
        embed_missing(db)
        query_vector = ai.embed([query], "RETRIEVAL_QUERY")[0]
        rows = db.execute(VECTOR_SEARCH_SQL, {"query_vector": to_vector_literal(query_vector), "limit": limit}).all()
        method = "tidb_vector"
        ranked = [(row.id, max(0.0, 1.0 - float(row.distance)), []) for row in rows]
    except (ai.AIUnavailable, DBAPIError) as exc:
        db.rollback()
        log.warning("AI search unavailable, answering with keyword search: %s", exc)
        method = "keyword_fallback"
        ranked = keyword_ranking(db, query, limit)

    by_id = {
        r.id: r
        for r in db.scalars(
            select(AidRequest)
            .where(AidRequest.id.in_([rid for rid, _, _ in ranked]))
            .options(selectinload(AidRequest.organization))
        )
    }
    results = [
        SearchResultOut(
            score=round(score, 3),
            request=request_out(by_id[rid]),
            organization=organization_summary(by_id[rid].organization),
            explanation=explain(by_id[rid], method, words),
        )
        for rid, score, words in ranked
        if rid in by_id
    ]
    return SearchOut(query=query, method=method, results=results)
