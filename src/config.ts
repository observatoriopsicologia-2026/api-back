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
  databaseSslCa: process.env.DATABASE_SSL_CA,
  adminName: process.env.ADMIN_NAME ?? 'Administrador POT',
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  storageDriver: process.env.STORAGE_DRIVER ?? 'local',
  localUploadDir: process.env.LOCAL_UPLOAD_DIR ?? 'uploads',
  r2AccountId: process.env.R2_ACCOUNT_ID,
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID,
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  r2Bucket: process.env.R2_BUCKET ?? 'observatorio-pdfs',
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  supabasePublicationBucket: process.env.SUPABASE_PUBLICATION_BUCKET ?? 'publications'
};

export function validateR2Config(config: typeof env) {
  if (!config.r2AccountId || !/^[a-f0-9]{32}$/i.test(config.r2AccountId) ||
      !config.r2AccessKeyId || !config.r2SecretAccessKey || !config.r2Bucket) {
    throw new Error('R2_ACCOUNT_ID (32 hexadecimal characters), R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET are required for R2.');
  }
}

export function validateProductionConfig(config: typeof env) {
  if (config.nodeEnv !== 'production') {
    return;
  }

  if (config.jwtSecret === 'dev-only-change-me' || config.jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must contain at least 32 characters in production.');
  }

  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required in production.');
  }

  const origins = config.clientOrigin.split(',').map((origin) => origin.trim());
  for (const origin of origins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error('CLIENT_ORIGIN must contain valid HTTPS origins in production.');
    }

    if (url.protocol !== 'https:' || url.origin !== origin) {
      throw new Error('CLIENT_ORIGIN must contain HTTPS origins without paths or trailing slashes.');
    }
  }

  if (config.storageDriver === 'r2') {
    validateR2Config(config);
  } else if (config.storageDriver !== 'supabase' || !config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error('Production requires R2 or Supabase Storage and its server-side credentials.');
  }
}

validateProductionConfig(env);
