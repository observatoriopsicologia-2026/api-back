import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs';
import { ApiService } from './api.service';
import { AuthUser } from './models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly tokenKey = 'pot_token';
  private readonly userKey = 'pot_user';

  constructor(
    private readonly api: ApiService,
    private readonly router: Router
  ) {}

  get token(): string | null {
    return localStorage.getItem(this.tokenKey);
  }

  get user(): AuthUser | null {
    const raw = localStorage.getItem(this.userKey);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  }

  get isLoggedIn(): boolean {
    return Boolean(this.token);
  }

  login(email: string, password: string) {
    return this.api.login(email, password).pipe(
      tap((response) => {
        localStorage.setItem(this.tokenKey, response.token);
        localStorage.setItem(this.userKey, JSON.stringify(response.user));
      })
    );
  }

  logout() {
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.userKey);
    this.router.navigateByUrl('/admin/login');
  }
}

