import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { CollectionKey } from '../core/models';

interface AdminTab {
  key: CollectionKey;
  label: string;
  description: string;
}

type Draft = Record<string, string | boolean | number | null>;

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-dashboard.component.html'
})
export class AdminDashboardComponent implements OnInit {
  tabs: AdminTab[] = [
    {
      key: 'publications',
      label: 'Publicaciones',
      description: 'Repositorio académico con PDF, previsualización y descarga.'
    },
    {
      key: 'researchers',
      label: 'Directorio',
      description: 'Investigadores, instituciones, países y líneas de trabajo.'
    },
    {
      key: 'events',
      label: 'Eventos',
      description: 'Congresos, webinars, seminarios y encuentros.'
    },
    {
      key: 'news',
      label: 'Noticias',
      description: 'Actualidad, convocatorias y novedades del observatorio.'
    },
    {
      key: 'resources',
      label: 'Recursos',
      description: 'Enlaces, materiales, herramientas y repositorios externos.'
    }
  ];

  selected = this.tabs[0];
  items: Record<string, unknown>[] = [];
  draft: Draft = {};
  editingId = '';
  selectedFile?: File;
  loading = false;
  saving = false;
  error = '';
  success = '';
  previewTitle = '';
  previewUrl?: SafeResourceUrl;

  constructor(
    public readonly auth: AuthService,
    private readonly api: ApiService,
    private readonly router: Router,
    private readonly sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    if (!this.auth.isLoggedIn) {
      this.router.navigateByUrl('/admin/login');
      return;
    }
    this.resetDraft();
    this.load();
  }

  selectTab(tab: AdminTab) {
    this.selected = tab;
    this.resetDraft();
    this.load();
  }

  load() {
    this.loading = true;
    this.error = '';

    if (this.selected.key === 'publications') {
      this.api
        .getPublications('', 100)
        .pipe(finalize(() => (this.loading = false)))
        .subscribe({
          next: (response) => (this.items = response.items as unknown as Record<string, unknown>[]),
          error: () => (this.error = 'No pudimos cargar los registros.')
        });
      return;
    }

    this.api
      .getCollection(this.selected.key as Exclude<CollectionKey, 'publications'>, '', 100)
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: (response) => (this.items = response.items as unknown as Record<string, unknown>[]),
        error: () => (this.error = 'No pudimos cargar los registros.')
      });
  }

  resetDraft() {
    this.editingId = '';
    this.selectedFile = undefined;
    this.success = '';
    this.error = '';
    this.draft = this.emptyDraft(this.selected.key);
  }

  edit(item: Record<string, unknown>) {
    this.editingId = String(item['id']);
    this.selectedFile = undefined;
    this.draft = { ...this.emptyDraft(this.selected.key), ...this.prepareForForm(item) };
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  submit() {
    this.saving = true;
    this.error = '';
    this.success = '';

    const payload = this.selected.key === 'publications' ? this.publicationFormData() : this.cleanPayload(this.draft);
    const request = this.editingId
      ? this.api.update(this.selected.key, this.editingId, payload)
      : this.api.create(this.selected.key, payload);

    request.pipe(finalize(() => (this.saving = false))).subscribe({
      next: () => {
        this.success = this.editingId ? 'Registro actualizado.' : 'Registro creado.';
        this.resetDraft();
        this.load();
      },
      error: () => (this.error = 'No pudimos guardar. Revisa los campos obligatorios y la sesión.')
    });
  }

  remove(item: Record<string, unknown>) {
    const label = this.titleFor(item);
    if (!confirm(`¿Eliminar "${label}"?`)) {
      return;
    }

    this.api.delete(this.selected.key, String(item['id'])).subscribe({
      next: () => this.load(),
      error: () => (this.error = 'No pudimos eliminar el registro.')
    });
  }

  onFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0];
  }

  preview(item: Record<string, unknown>) {
    this.previewTitle = this.titleFor(item);
    this.previewUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
      this.api.publicationFileUrl(String(item['id']), 'preview')
    );
  }

  downloadUrl(item: Record<string, unknown>) {
    return this.api.publicationFileUrl(String(item['id']), 'download');
  }

  logout() {
    this.auth.logout();
  }

  titleFor(item: Record<string, unknown>) {
    return String(item['title'] ?? item['name'] ?? '');
  }

  subtitleFor(item: Record<string, unknown>) {
    if (this.selected.key === 'publications') {
      return [item['authors'], item['year'], item['country']].filter(Boolean).join(' · ');
    }
    if (this.selected.key === 'researchers') {
      return [item['institution'], item['country'], item['specialty']].filter(Boolean).join(' · ');
    }
    if (this.selected.key === 'events') {
      return [this.formatDate(item['starts_at']), item['location'], item['modality']].filter(Boolean).join(' · ');
    }
    if (this.selected.key === 'news') {
      return this.formatDate(item['published_at']);
    }
    return [item['type'], Array.isArray(item['tags']) ? item['tags'].join(', ') : ''].filter(Boolean).join(' · ');
  }

  hasPdf(item: Record<string, unknown>) {
    return Boolean(item['file_path']);
  }

  private emptyDraft(key: CollectionKey): Draft {
    const common = { is_featured: false };
    if (key === 'publications') {
      return {
        ...common,
        title: '',
        abstract: '',
        authors: '',
        year: '',
        country: '',
        tags: '',
        published_at: ''
      };
    }
    if (key === 'researchers') {
      return {
        ...common,
        name: '',
        institution: '',
        country: '',
        specialty: '',
        bio: '',
        email: '',
        profile_url: ''
      };
    }
    if (key === 'events') {
      return {
        ...common,
        title: '',
        description: '',
        starts_at: '',
        location: '',
        modality: 'Presencial',
        category: '',
        url: ''
      };
    }
    if (key === 'news') {
      return {
        ...common,
        title: '',
        summary: '',
        body: '',
        image_url: '',
        source_url: '',
        published_at: ''
      };
    }
    return {
      ...common,
      title: '',
      description: '',
      type: 'Enlace',
      url: '',
      tags: ''
    };
  }

  private prepareForForm(item: Record<string, unknown>): Draft {
    const prepared: Draft = {};
    Object.entries(item).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        prepared[key] = value.join(', ');
      } else if (key === 'starts_at' && value) {
        prepared[key] = this.toDateTimeLocal(String(value));
      } else if (key === 'published_at' && value) {
        prepared[key] = String(value).slice(0, 10);
      } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
        prepared[key] = value;
      }
    });
    return prepared;
  }

  private publicationFormData() {
    const form = new FormData();
    Object.entries(this.cleanPayload(this.draft)).forEach(([key, value]) => {
      form.append(key, String(value ?? ''));
    });
    if (this.selectedFile) {
      form.append('file', this.selectedFile);
    }
    return form;
  }

  private cleanPayload(payload: Draft) {
    const clean: Draft = {};
    Object.entries(payload).forEach(([key, value]) => {
      if (key === 'id' || key === 'created_at' || key === 'updated_at' || key.startsWith('file_')) {
        return;
      }
      clean[key] = value;
    });
    return clean;
  }

  private formatDate(value: unknown) {
    if (!value) {
      return '';
    }
    return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(String(value)));
  }

  private toDateTimeLocal(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toISOString().slice(0, 16);
  }
}
