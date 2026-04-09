from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import SessionLocal
from models import Researcher
from schemas import ResearcherCreate
from typing import Optional

router = APIRouter(prefix="/researchers", tags=["researchers"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@router.post("/")
def create_researcher(pub: ResearcherCreate, db: Session = Depends(get_db)):
    new_researcher = Researcher(**pub.dict())
    db.add(new_researcher)
    db.commit()
    db.refresh(new_researcher)
    return new_researcher

@router.get("/")
def list_researchers(
    db: Session = Depends(get_db),
    pais: Optional[str] = None,
    aptitudes: Optional[str] = None
):
    query = db.query(Researcher)

    if pais:
        query = query.filter(Researcher.pais == pais)

    if aptitudes:
        query = query.filter(Researcher.aptitudes.contains(aptitudes))

    return query.all()