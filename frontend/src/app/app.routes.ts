import { Routes } from '@angular/router';
import { AdminDashboardComponent } from './features/admin-dashboard.component';
import { CollectionPageComponent } from './features/collection-page.component';
import { HomeComponent } from './features/home.component';
import { LoginComponent } from './features/login.component';
import { PublicationsComponent } from './features/publications.component';

export const routes: Routes = [
  { path: '', component: HomeComponent, title: 'Inicio | Observatorio POT' },
  { path: 'publicaciones', component: PublicationsComponent, title: 'Publicaciones | Observatorio POT' },
  {
    path: 'directorio',
    component: CollectionPageComponent,
    title: 'Directorio | Observatorio POT',
    data: {
      key: 'researchers',
      title: 'Directorio de investigadores',
      subtitle: 'Conecta con investigadores y profesionales de Psicología Organizacional y del Trabajo.'
    }
  },
  {
    path: 'eventos',
    component: CollectionPageComponent,
    title: 'Eventos | Observatorio POT',
    data: {
      key: 'events',
      title: 'Eventos académicos',
      subtitle: 'Congresos, seminarios, webinars y encuentros de la red iberoamericana.'
    }
  },
  {
    path: 'noticias',
    component: CollectionPageComponent,
    title: 'Noticias | Observatorio POT',
    data: {
      key: 'news',
      title: 'Noticias y novedades',
      subtitle: 'Actualidad, convocatorias y avances relevantes para la comunidad POT.'
    }
  },
  {
    path: 'recursos',
    component: CollectionPageComponent,
    title: 'Recursos | Observatorio POT',
    data: {
      key: 'resources',
      title: 'Recursos',
      subtitle: 'Materiales, enlaces, repositorios y herramientas para investigación y práctica profesional.'
    }
  },
  { path: 'admin/login', component: LoginComponent, title: 'Acceso admin | Observatorio POT' },
  { path: 'admin', component: AdminDashboardComponent, title: 'Panel admin | Observatorio POT' },
  { path: '**', redirectTo: '' }
];

