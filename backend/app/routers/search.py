from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas import SearchIn, SearchOut
from app.search import search

router = APIRouter(tags=["search"])


@router.post("/search", response_model=SearchOut, response_model_exclude_none=True)
def search_requests(body: SearchIn, db: Session = Depends(get_db)):
    """AI search: Gemini embeddings ranked by TiDB vector search. `method` says which search answered."""
    return search(db, body.query, body.limit)
