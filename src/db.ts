import pg from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from './config.js';
import { HttpError } from './http.js';

const sslDatabaseMarkers = ['supabase.com', 'supabase.co', 'neon.tech'];

export function shouldUseSslConnection(databaseUrl = env.databaseUrl, nodeEnv = env.nodeEnv) {
  if (nodeEnv === 'production') {
    return true;
  }

  if (!databaseUrl) {
    return false;
  }

  const url = new URL(databaseUrl);
  const sslMode = url.searchParams.get('sslmode');
  return (sslMode !== null && sslMode !== 'disable') || sslDatabaseMarkers.some(
    (marker) => url.hostname === marker || url.hostname.endsWith('.' + marker)
  );
}

export function createPoolConfig(
  databaseUrl = env.databaseUrl,
  nodeEnv = env.nodeEnv,
  sslCa = env.databaseSslCa
): pg.PoolConfig | undefined {
  if (!databaseUrl) {
    return undefined;
  }

  if (!shouldUseSslConnection(databaseUrl, nodeEnv)) {
    return { connectionString: databaseUrl };
  }

  const url = new URL(databaseUrl);
  // pg lets URI SSL parameters replace the explicit TLS options below.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) {
    url.searchParams.delete(key);
  }

  const isSupabase = ['supabase.co', 'supabase.com'].some(
    (domain) => url.hostname === domain || url.hostname.endsWith('.' + domain)
  );
  const trustedCa = sslCa || (isSupabase
    ? readFileSync(resolve(process.cwd(), 'certificates/supabase-prod-ca-2021.crt'), 'utf8')
    : undefined);

  return {
    connectionString: url.toString(),
    ssl: {
      rejectUnauthorized: true,
      ...(trustedCa ? { ca: trustedCa.replace(/\\n/g, '\n') } : {})
    },
    max: 5,
    connectionTimeoutMillis: 10000
  };
}

const poolConfig = createPoolConfig();

export const pool = poolConfig ? new pg.Pool(poolConfig) : undefined;

type QueryImplementation = (text: string, params?: unknown[]) => Promise<pg.QueryResult<pg.QueryResultRow>>;
type QueryPool = {
  query(text: string, params?: unknown[]): Promise<pg.QueryResult<pg.QueryResultRow>>;
};

let queryImplementation: QueryImplementation | undefined;
let activePool: QueryPool | undefined = pool;

export function setQueryImplementationForTests(implementation?: QueryImplementation) {
  queryImplementation = implementation;
}

export function setPoolForTests(poolForTests: QueryPool | undefined) {
  activePool = poolForTests;
}

export function resetPoolForTests() {
  activePool = pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) {
  if (queryImplementation) {
    return (await queryImplementation(text, params)) as pg.QueryResult<T>;
  }

  if (!activePool) {
    throw new HttpError(
      503,
      'La base de datos no estÃ¡ configurada. Crea backend/.env y define DATABASE_URL con la conexiÃ³n de Supabase.'
    );
  }

  const result = await activePool.query(text, params);
  return result as pg.QueryResult<T>;
}
