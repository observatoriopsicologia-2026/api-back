import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from './config.js';
import { query } from './db.js';
import { HttpError } from './http.js';

export type Role = 'admin' | 'editor';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

interface UserRow extends AuthUser {
  password_hash: string;
}

export async function seedAdminUser() {
  if (!env.databaseUrl) {
    console.warn('DATABASE_URL is not configured. API started without database-backed content routes.');
    return;
  }

  if (!env.adminEmail || !env.adminPassword) {
    return;
  }

  try {
    const existing = await query<{ id: string }>('select id from users where email = $1', [env.adminEmail]);
    if (existing.rowCount) {
      return;
    }

    const passwordHash = await bcrypt.hash(env.adminPassword, 12);
    await query(
      `insert into users (name, email, password_hash, role)
       values ($1, $2, $3, 'admin')`,
      [env.adminName, env.adminEmail, passwordHash]
    );

    console.info(`Initial admin user created: ${env.adminEmail}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown database error';
    console.warn(`Database is configured but not reachable: ${message}`);
  }
}

export async function login(email: string, password: string) {
  const result = await query<UserRow>(
    `select id, name, email, role, password_hash
     from users
     where lower(email) = lower($1)
     limit 1`,
    [email]
  );

  const user = result.rows[0];
  if (!user) {
    throw new HttpError(401, 'Correo o contraseña inválidos.');
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    throw new HttpError(401, 'Correo o contraseña inválidos.');
  }

  const authUser: AuthUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  };

  const token = jwt.sign(authUser, env.jwtSecret, { expiresIn: '8h' });
  return { token, user: authUser };
}

export function requireAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

  if (!token) {
    next(new HttpError(401, 'Debes iniciar sesión.'));
    return;
  }

  try {
    req.user = jwt.verify(token, env.jwtSecret) as AuthUser;
    next();
  } catch {
    next(new HttpError(401, 'La sesión expiró. Inicia sesión nuevamente.'));
  }
}

export function requireAdmin(req: AuthRequest, _res: Response, next: NextFunction) {
  if (!req.user || !['admin', 'editor'].includes(req.user.role)) {
    next(new HttpError(403, 'No tienes permisos para esta acción.'));
    return;
  }

  next();
}
