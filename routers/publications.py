from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from database import SessionLocal
from models import Publication
from schemas import PublicationCreate
from typing import Optional

router = APIRouter(prefix="/publications", tags=["Publications"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()



@router.post("/")
def create_publication(pub: PublicationCreate, db: Session = Depends(get_db)):
    new_pub = Publication(**pub.dict())
    db.add(new_pub)
    db.commit()
    db.refresh(new_pub)
    return new_pub


@router.get("/")
def list_publications(
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 10,
    tipo: Optional[str] = None,
    search: Optional[str] = None
):
    query = db.query(Publication)

    if tipo and tipo != "Todos":
        query = query.filter(Publication.tipo == tipo)

    if search:
        query = query.filter(
            (Publication.titulo.contains(search)) |
            (Publication.autor.contains(search))
        )

    return query.offset(skip).limit(limit).all()