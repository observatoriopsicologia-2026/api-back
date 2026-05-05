import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiService } from '../core/api.service';
import { CollectionKey } from '../core/models';

@Component({
  selector: 'app-collection-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './collection-page.component.html'
})
export class CollectionPageComponent implements OnInit {
  key!: Exclude<CollectionKey, 'publications'>;
  title = '';
  subtitle = '';
  q = '';
  items: Record<string, unknown>[] = [];
  loading = false;
  error = '';

  constructor(
    private readonly route: ActivatedRoute,
    private readonly api: ApiService
  ) {}

  ngOnInit(): void {
    this.route.data.subscribe((data) => {
      this.key = data['key'] as Exclude<CollectionKey, 'publications'>;
      this.title = String(data['title']);
      this.subtitle = String(data['subtitle']);
      this.q = '';
      this.load();
    });
  }

  load() {
    this.loading = true;
    this.error = '';
    this.api
      .getCollection(this.key, this.q, 100)
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: (response) => (this.items = response.items as unknown as Record<string, unknown>[]),
        error: () => (this.error = 'No pudimos cargar la información en este momento.')
      });
  }

  titleFor(item: Record<string, unknown>) {
    return String(item['title'] ?? item['name'] ?? '');
  }

  descriptionFor(item: Record<string, unknown>) {
    return String(item['description'] ?? item['summary'] ?? item['bio'] ?? item['body'] ?? '');
  }

  metaFor(item: Record<string, unknown>) {
    if (this.key === 'researchers') {
      return [item['institution'], item['country'], item['specialty']].filter(Boolean).join(' · ');
    }
    if (this.key === 'events') {
      return [this.formatDate(item['starts_at']), item['location'], item['modality']].filter(Boolean).join(' · ');
    }
    if (this.key === 'news') {
      return this.formatDate(item['published_at']);
    }
    return [item['type'], Array.isArray(item['tags']) ? item['tags'].join(', ') : ''].filter(Boolean).join(' · ');
  }

  linkFor(item: Record<string, unknown>) {
    return String(item['profile_url'] ?? item['url'] ?? item['source_url'] ?? '');
  }

  private formatDate(value: unknown) {
    if (!value) {
      return '';
    }
    return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(String(value)));
  }
}
