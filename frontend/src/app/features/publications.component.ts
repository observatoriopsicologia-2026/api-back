import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Publication } from '../core/models';

@Component({
  selector: 'app-publications',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './publications.component.html'
})
export class PublicationsComponent implements OnInit {
  publications: Publication[] = [];
  loading = false;
  error = '';
  q = '';
  previewTitle = '';
  previewUrl?: SafeResourceUrl;

  constructor(
    private readonly api: ApiService,
    private readonly route: ActivatedRoute,
    private readonly sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      this.q = params.get('q') ?? '';
      this.load();
    });
  }

  load() {
    this.loading = true;
    this.error = '';
    this.api
      .getPublications(this.q, 100)
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: (response) => (this.publications = response.items),
        error: () => (this.error = 'No pudimos cargar las publicaciones en este momento.')
      });
  }

  preview(item: Publication) {
    this.previewTitle = item.title;
    this.previewUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.api.publicationFileUrl(item.id, 'preview'));
  }

  downloadUrl(item: Publication) {
    return this.api.publicationFileUrl(item.id, 'download');
  }
}

