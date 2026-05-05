import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.component.html'
})
export class AppComponent {
  nav = [
    { label: 'Inicio', path: '/' },
    { label: 'Publicaciones', path: '/publicaciones' },
    { label: 'Directorio', path: '/directorio' },
    { label: 'Eventos', path: '/eventos' },
    { label: 'Noticias', path: '/noticias' },
    { label: 'Recursos', path: '/recursos' }
  ];

  menuOpen = false;
  searchOpen = false;
  searchTerm = '';

  constructor(
    public readonly auth: AuthService,
    private readonly router: Router
  ) {}

  search() {
    const q = this.searchTerm.trim();
    if (!q) {
      return;
    }
    this.searchOpen = false;
    this.menuOpen = false;
    this.router.navigate(['/publicaciones'], { queryParams: { q } });
  }
}

