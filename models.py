from sqlalchemy import Column, Integer, String, Text, Enum, Date
from database import Base

from sqlalchemy import Column, Integer, String, Text, Enum, Date, DateTime
from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(100))
    email = Column(String(150), unique=True)
    password = Column(String(255))
    rol = Column(Enum("admin", "editor"), default="admin")


class Publication(Base):
    __tablename__ = "publications"

    id = Column(Integer, primary_key=True, index=True)
    titulo = Column(String(255))
    descripcion = Column(Text)
    tipo = Column(Enum("Articulo", "Libro", "Capitulo", "Tesis", "Ponencia"))
    archivo_url = Column(String(500))
    autor = Column(String(255))
    fecha_publicacion = Column(Date)


class Researcher(Base):
    __tablename__ = "researchers"

    id = Column(Integer, primary_key=True)
    nombre = Column(String(150))
    titulo = Column(String(50))
    institucion = Column(String(255))
    pais = Column(String(100))
    aptitudes = Column(Text)
    email = Column(String(150))
    perfil_url = Column(String(500))


class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True)
    titulo = Column(String(255))
    descripcion = Column(Text)
    fecha_inicio = Column(DateTime)
    fecha_fin = Column(DateTime)
    ubicacion = Column(String(255))


class News(Base):
    __tablename__ = "news"

    id = Column(Integer, primary_key=True)
    titulo = Column(String(255))
    contenido = Column(Text)
    tipo = Column(Enum("Noticia", "Novedad"))
    imagen_url = Column(String(500))
    fecha_publicacion = Column(Date)