from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from database import SessionLocal
from models import News
from typing import Optional

router = APIRouter(prefix="/News", tags=["News"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/news")
def list_news(
    db: Session = Depends(get_db),
    tipo: Optional[str] = None
):
    query = db.query(News)

    if tipo:
        query = query.filter(News.tipo == tipo)

    return query.all()