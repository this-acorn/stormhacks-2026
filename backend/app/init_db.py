"""Set up the database: create it, create the tables and add the demo data. Safe to run again.

Run from the backend folder:
    .venv/Scripts/python -m app.init_db           create whatever is missing
    .venv/Scripts/python -m app.init_db --reset   drop every table and start over (deletes all data)
"""

import argparse

from sqlalchemy import text

import app.models  # importing registers every table with Base
from app import ai
from app.db import Base, SessionLocal, create_database_if_missing, engine, is_tidb
from app.search import embed_missing
from app.seed import seed


def main() -> None:
    parser = argparse.ArgumentParser(description="Set up the AidAtlas database.")
    parser.add_argument("--reset", action="store_true", help="drop every table first (deletes all data)")
    args = parser.parse_args()

    create_database_if_missing()
    if args.reset:
        Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with engine.connect() as conn:
        version = conn.execute(text("SELECT VERSION()")).scalar_one()
    print(f"Connected to TiDB ({version}). Tables: {', '.join(sorted(Base.metadata.tables))}")

    with SessionLocal() as db:
        print(f"Demo data: added {seed(db)} rows.")
        if is_tidb():
            try:
                print(f"AI search: embedded {embed_missing(db)} requests with Gemini.")
            except ai.AIUnavailable as exc:
                print(f"AI search: Gemini embeddings unavailable ({exc}). Searches will retry them.")


if __name__ == "__main__":
    main()
