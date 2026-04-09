from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import SessionLocal
from models import Event
from datetime import datetime

router = APIRouter(prefix="/event", tags=["event"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@router.get("/events")
def list_events(db: Session = Depends(get_db)):
    return db.query(Event).order_by(Event.fecha_inicio.asc()).all()

@router.get("/events/filter")
def filter_events(
    db: Session = Depends(get_db),
    year: int = None,
    month: int = None
):
    query = db.query(Event)

    if year:
        start_date = datetime(year, 1, 1)
        end_date = datetime(year + 1, 1, 1)
        query = query.filter(Event.fecha_inicio >= start_date, Event.fecha_inicio < end_date)

    if month and year:
        start_date = datetime(year, month, 1)
        # calcular el primer día del siguiente mes
        if month == 12:
            end_date = datetime(year + 1, 1, 1)
        else:
            end_date = datetime(year, month + 1, 1)
        query = query.filter(Event.fecha_inicio >= start_date, Event.fecha_inicio < end_date)

    return query.order_by(Event.fecha_inicio.asc()).all()

router = APIRouter(prefix="/events", tags=["events"])