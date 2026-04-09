from fastapi import FastAPI
from database import Base, engine

# Importar routers corregidos
from routers import events, news, publications, researchers

# Crear las tablas
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Sistema Académico")

# Registrar routers
app.include_router(events.router)
app.include_router(news.router)
app.include_router(publications.router)
app.include_router(researchers.router)