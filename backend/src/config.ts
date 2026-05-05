import dotenv from 'dotenv';
import { resolve } from 'node:path';

dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config();

const required = (key: string, fallback?: string) => {
  const value = process.env[key] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const optionalNumber = (key: string, fallback: number) => {
  const raw = process.env[key];
  return raw ? Number(raw) : fallback;
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: optionalNumber('PORT', 4000),
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:4200',
  jwtSecret: required('JWT_SECRET', 'dev-only-change-me'),
  databaseUrl: process.env.DATABASE_URL,
  adminName: process.env.ADMIN_NAME ?? 'Administrador POT',
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  storageDriver: process.env.STORAGE_DRIVER === 'supabase' ? 'supabase' : 'local',
  localUploadDir: process.env.LOCAL_UPLOAD_DIR ?? 'uploads',
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  supabasePublicationBucket: process.env.SUPABASE_PUBLICATION_BUCKET ?? 'publications'
};

if (env.nodeEnv === 'production' && env.jwtSecret === 'dev-only-change-me') {
  throw new Error('JWT_SECRET must be set to a strong value in production.');
}
