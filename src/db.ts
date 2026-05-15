import pg from 'pg';
import { env } from './config.js';
import { HttpError } from './http.js';

const sslDatabaseMarkers = ['sslmode=require', 'supabase.com', 'supabase.co', 'neon.tech'];

export function shouldUseSslConnection(databaseUrl = env.databaseUrl, nodeEnv = env.nodeEnv) {
  if (nodeEnv === 'production') {
    return true;
  }

  if (!databaseUrl) {
    return false;
  }

  return sslDatabaseMarkers.some((marker) => databaseUrl.includes(marker));
}

export function createPoolConfig(databaseUrl = env.databaseUrl, nodeEnv = env.nodeEnv): pg.PoolConfig | undefined {
  if (!databaseUrl) {
    return undefined;
  }

  return {
    connectionString: databaseUrl,
    ssl: shouldUseSslConnection(databaseUrl, nodeEnv) ? { rejectUnauthorized: false } : undefined
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
