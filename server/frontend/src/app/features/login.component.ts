import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login.component.html'
})
export class LoginComponent {
  email = '';
  password = '';
  loading = false;
  error = '';

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router
  ) {}

  submit() {
    this.loading = true;
    this.error = '';
    this.auth
      .login(this.email, this.password)
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: () => this.router.navigateByUrl('/admin'),
        error: () => (this.error = 'No pudimos iniciar sesión con esos datos.')
      });
  }
}

