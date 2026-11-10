import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import {
  createPoolConfig,
  query,
  resetPoolForTests,
  setPoolForTests,
  setQueryImplementationForTests,
  shouldUseSslConnection
} from '../src/db.js';
import { HttpError } from '../src/http.js';

function result<T extends Record<string, unknown>>(rows: T[], rowCount = rows.length) {
  return {
    rows,
    rowCount,
    command: 'MOCK',
    oid: 0,
    fields: []
  };
}

afterEach(() => {
  setQueryImplementationForTests(undefined);
  resetPoolForTests();
});

test('shouldUseSslConnection detects production and hosted Postgres URLs', () => {
  assert.equal(shouldUseSslConnection('', 'development'), false);
  assert.equal(shouldUseSslConnection('postgresql://localhost:5432/postgres', 'development'), false);
  assert.equal(shouldUseSslConnection('', 'production'), true);
  assert.equal(shouldUseSslConnection('postgresql://db.example.com/postgres?sslmode=require', 'development'), true);
  assert.equal(shouldUseSslConnection('postgresql://db.project.supabase.com/postgres', 'development'), true);
  assert.equal(shouldUseSslConnection('postgresql://db.project.supabase.co/postgres', 'development'), true);
  assert.equal(shouldUseSslConnection('postgresql://db.project.neon.tech/postgres', 'development'), true);
  assert.equal(shouldUseSslConnection('postgresql://db.example.com/postgres?sslmode=verify-full', 'development'), true);
  assert.equal(shouldUseSslConnection('postgresql://db.example.com/postgres?sslmode=disable', 'development'), false);
  assert.equal(shouldUseSslConnection('postgresql://user:supabase.co@localhost/postgres', 'development'), false);
});

test('createPoolConfig returns undefined without a database URL and SSL config when needed', () => {
  assert.equal(createPoolConfig('', 'development'), undefined);

  const local = createPoolConfig('postgresql://localhost:5432/postgres', 'development');
  assert.equal(local?.connectionString, 'postgresql://localhost:5432/postgres');
  assert.equal(local?.ssl, undefined);

  const hosted = createPoolConfig('postgresql://db.project.supabase.co/postgres', 'development');
  const ssl = hosted?.ssl as { rejectUnauthorized: boolean; ca: string };
  assert.equal(ssl.rejectUnauthorized, true);
  assert.match(ssl.ca, /-----BEGIN CERTIFICATE-----/);
});

test('TLS configuration preserves application parameters and cannot be weakened by URI SSL options', () => {
  const configured = createPoolConfig(
    'postgresql://db.project.supabase.co/postgres?sslmode=no-verify&sslrootcert=other.pem&uselibpqcompat=true&application_name=observatorio',
    'production',
    '-----BEGIN CERTIFICATE-----\\nroot-ca\\n-----END CERTIFICATE-----'
  );
  const url = new URL(configured!.connectionString!);

  assert.equal(url.searchParams.get('sslmode'), null);
  assert.equal(url.searchParams.get('sslrootcert'), null);
  assert.equal(url.searchParams.get('uselibpqcompat'), null);
  assert.equal(url.searchParams.get('application_name'), 'observatorio');
  assert.deepEqual(configured?.ssl, {
    rejectUnauthorized: true,
    ca: '-----BEGIN CERTIFICATE-----\nroot-ca\n-----END CERTIFICATE-----'
  });
  assert.equal(configured?.max, 5);
  assert.equal(configured?.connectionTimeoutMillis, 10000);

  const disabled = createPoolConfig('postgresql://db.example.com/postgres?sslmode=disable', 'production');
  assert.deepEqual(disabled?.ssl, { rejectUnauthorized: true });
});

test('query uses the injected implementation when provided', async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  setQueryImplementationForTests(async (sql, params = []) => {
    calls.push({ sql, params });
    return result([{ ok: 1 }]);
  });

  const response = await query<{ ok: number }>('select $1::int as ok', [1]);

  assert.equal(response.rows[0].ok, 1);
  assert.deepEqual(calls, [{ sql: 'select $1::int as ok', params: [1] }]);
});

test('query throws a service error when no database pool is available', async () => {
  setPoolForTests(undefined);

  await assert.rejects(query('select 1'), (error) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 503);
    assert.match(error.message, /base de datos/i);
    return true;
  });
});

test('query delegates to the active pool when configured', async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  setPoolForTests({
    async query(sql, params = []) {
      calls.push({ sql, params });
      return result([{ ok: 1 }]);
    }
  });

  const response = await query<{ ok: number }>('select $1::int as ok', [1]);

  assert.equal(response.rows[0].ok, 1);
  assert.deepEqual(calls, [{ sql: 'select $1::int as ok', params: [1] }]);
});
