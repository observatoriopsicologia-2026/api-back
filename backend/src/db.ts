import pg from 'pg';
import { env } from './config.js';
import { HttpError } from './http.js';

const shouldUseSsl =
  env.nodeEnv === 'production' ||
  env.databaseUrl?.includes('sslmode=require') ||
  env.databaseUrl?.includes('supabase.com') ||
  env.databaseUrl?.includes('supabase.co') ||
  env.databaseUrl?.includes('neon.tech');

export const pool = env.databaseUrl
  ? new pg.Pool({
      connectionString: env.databaseUrl,
      ssl: shouldUseSsl ? { rejectUnauthorized: false } : undefined
    })
  : undefined;

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) {
  if (!pool) {
    throw new HttpError(
      503,
      'La base de datos no está configurada. Crea backend/.env y define DATABASE_URL con la conexión de Supabase.'
    );
  }

  const result = await pool.query<T>(text, params);
  return result;
}
