import re

import certifi
from sqlalchemy import URL, create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import get_settings

settings = get_settings()

# Encrypt the connection and make sure the server really is TiDB Cloud: its certificate must be
# signed by an authority in certifi's trusted list and must match the hostname.
TLS_ARGS = {"ssl_ca": certifi.where(), "ssl_verify_cert": True, "ssl_verify_identity": True}


def tidb_url(database: str | None) -> URL:
    # URL.create escapes any special characters in the password for us.
    return URL.create(
        drivername="mysql+pymysql",
        username=settings.tidb_user,
        password=settings.tidb_password.get_secret_value(),
        host=settings.tidb_host,
        port=settings.tidb_port,
        database=database,
    )


if settings.database_url:
    # Tests: one in-memory SQLite database shared by every connection.
    engine = create_engine(settings.database_url, connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _enforce_foreign_keys(dbapi_connection, _record):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

else:
    # One engine for the whole app. It keeps a pool of open connections so each request skips the slow
    # TLS handshake. pool_pre_ping and pool_recycle replace connections TiDB Cloud closed while idle.
    engine = create_engine(
        tidb_url(settings.tidb_db_name),
        connect_args=TLS_ARGS,
        pool_pre_ping=True,
        pool_recycle=300,
    )

SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    """Parent class for every table we define."""


def is_tidb() -> bool:
    return engine.dialect.name == "mysql"


def create_database_if_missing() -> None:
    if not is_tidb():
        return
    name = settings.tidb_db_name
    # The name is pasted into SQL text, so allow only plain characters (no SQL injection).
    if not re.fullmatch(r"[A-Za-z0-9_]+", name):
        raise ValueError(f"TIDB_DB_NAME may contain only letters, digits and underscores, got {name!r}")
    server = create_engine(tidb_url(None), connect_args=TLS_ARGS)
    try:
        with server.connect() as conn:
            conn.execute(text(f"CREATE DATABASE IF NOT EXISTS `{name}`"))
            conn.commit()
    finally:
        server.dispose()


def get_db():
    """FastAPI dependency: each request gets its own session, closed when the request ends."""
    with SessionLocal() as session:
        yield session
