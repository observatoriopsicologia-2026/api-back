from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime


class PublicationBase(BaseModel):
    titulo: str
    descripcion: Optional[str]
    tipo: str
    archivo_url: str
    autor: str
    fecha_publicacion: Optional[date]

class PublicationCreate(PublicationBase):
    pass

class PublicationOut(PublicationBase):
    id: int

    class Config:
        from_attributes = True

class ResearcherBase(BaseModel):
    nombre: str
    titulo: Optional[str]
    institucion: Optional[str]
    pais: Optional[str]
    aptitudes: Optional[str]
    email: Optional[str]
    perfil_url: Optional[str]

class ResearcherCreate(ResearcherBase):
    pass
