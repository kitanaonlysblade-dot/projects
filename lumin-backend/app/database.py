import os

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

# postgresql+psycopg2://user:password@localhost:5432/lumin
DATABASE_URL = os.environ["DATABASE_URL"]

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Session:
    """FastAPI dependency — `db: Session = Depends(get_db)` in a route."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
