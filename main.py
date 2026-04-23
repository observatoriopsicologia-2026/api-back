from fastapi import FastAPI
from database import Base, engine


from routers import events, news, publications, researchers



print("Tablas creadas")

app = FastAPI(title="Sistema Académico")

app.include_router(events.router)
app.include_router(news.router)
app.include_router(publications.router)
app.include_router(researchers.router)