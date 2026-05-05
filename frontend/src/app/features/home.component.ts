import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import { ApiService } from '../core/api.service';
import { EventItem, NewsItem, Publication, Researcher } from '../core/models';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './home.component.html'
})
export class HomeComponent implements OnInit {
  publications: Publication[] = [];
  researchers: Researcher[] = [];
  events: EventItem[] = [];
  news: NewsItem[] = [];

  countries = [
    { name: 'España', value: 56, color: 'blue' },
    { name: 'Brasil', value: 49, color: 'orange' },
    { name: 'México', value: 43, color: 'yellow' },
    { name: 'Argentina', value: 40, color: 'blue' },
    { name: 'Colombia', value: 36, color: 'orange' },
    { name: 'Chile', value: 34, color: 'yellow' },
    { name: 'Portugal', value: 30, color: 'blue' },
    { name: 'Perú', value: 26, color: 'orange' }
  ];

  quickLinks = [
    {
      title: 'Publicaciones',
      text: 'Accede a artículos, libros y recursos académicos sobre POT.',
      path: '/publicaciones',
      tone: 'blue'
    },
    {
      title: 'Directorio',
      text: 'Conecta con investigadores y profesionales de toda la región.',
      path: '/directorio',
      tone: 'orange'
    },
    {
      title: 'Eventos',
      text: 'Descubre conferencias, webinars y talleres próximos.',
      path: '/eventos',
      tone: 'yellow'
    },
    {
      title: 'Colaboración',
      text: 'Participa en proyectos de investigación y grupos de trabajo.',
      path: '/recursos',
      tone: 'green'
    }
  ];

  fallbackNews: NewsItem[] = [
    {
      id: 'n1',
      title: 'Nueva red de investigadores en POT presenta resultados de estudio transnacional',
      summary: 'La red iberoamericana comparte hallazgos sobre clima, liderazgo y bienestar laboral.',
      body: '',
      image_url: '',
      source_url: '',
      published_at: '2026-04-01'
    },
    {
      id: 'n2',
      title: 'Abierta la convocatoria para proyectos colaborativos 2026',
      summary: 'Investigadores de universidades aliadas podrán postular iniciativas regionales.',
      body: '',
      image_url: '',
      source_url: '',
      published_at: '2026-03-22'
    },
    {
      id: 'n3',
      title: 'Programa de doctorado fortalece líneas de investigación aplicada',
      summary: 'Nuevas rutas de formación integran psicología, organizaciones y transformación digital.',
      body: '',
      image_url: '',
      source_url: '',
      published_at: '2026-03-15'
    }
  ];

  fallbackEvents: EventItem[] = [
    {
      id: 'e1',
      title: 'VII Congreso Iberoamericano de Psicología Organizacional',
      description: 'Encuentro académico con investigadores de la región.',
      starts_at: '2026-10-14T14:00:00.000Z',
      location: 'Madrid, España',
      modality: 'Presencial',
      category: 'Congreso',
      url: ''
    },
    {
      id: 'e2',
      title: 'Webinar: nuevas metodologías en evaluación del clima laboral',
      description: 'Sesión virtual para equipos de investigación.',
      starts_at: '2026-08-21T16:00:00.000Z',
      location: 'Online',
      modality: 'Virtual',
      category: 'Webinar',
      url: ''
    },
    {
      id: 'e3',
      title: 'Seminario de liderazgo y gestión del cambio',
      description: 'Miradas actuales para organizaciones latinoamericanas.',
      starts_at: '2026-11-04T15:00:00.000Z',
      location: 'Buenos Aires, Argentina',
      modality: 'Híbrido',
      category: 'Seminario',
      url: ''
    }
  ];

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    forkJoin({
      publications: this.api.getPublications('', 3).pipe(catchError(() => of({ items: [] as Publication[] }))),
      researchers: this.api.getCollection('researchers', '', 4).pipe(catchError(() => of({ items: [] as Researcher[] }))),
      events: this.api.getCollection('events', '', 3).pipe(catchError(() => of({ items: [] as EventItem[] }))),
      news: this.api.getCollection('news', '', 3).pipe(catchError(() => of({ items: [] as NewsItem[] })))
    }).subscribe((data) => {
      this.publications = data.publications.items;
      this.researchers = data.researchers.items;
      this.events = data.events.items.length ? data.events.items : this.fallbackEvents;
      this.news = data.news.items.length ? data.news.items : this.fallbackNews;
    });
  }
}

