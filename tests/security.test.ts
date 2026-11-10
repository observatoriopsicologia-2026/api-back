import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import test, { afterEach, mock } from 'node:test';
import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { env } from '../src/config.js';
import { setQueryImplementationForTests } from '../src/db.js';

const originalNodeEnv = env.nodeEnv;
const originalDatabaseUrl = env.databaseUrl;

afterEach(() => {
  env.nodeEnv = originalNodeEnv;
  env.databaseUrl = originalDatabaseUrl;
  setQueryImplementationForTests(undefined);
  mock.restoreAll();
});

async function withServer(app: Express, run: (baseUrl: string) => Promise<void>) {
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    await run(`http://127.0.0.1:${address.port}/api`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('failed login attempts are rate limited without limiting public health requests', async () => {
  setQueryImplementationForTests(async () => ({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] }));
  await withServer(createApp(), async (baseUrl) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.com', password: 'incorrect' })
      });
      assert.equal(response.status, 401);
      await response.json();
    }

    const blocked = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'incorrect' })
    });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    assert.match((await blocked.json() as { error: string }).error, /Demasiados intentos/);

    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    await health.json();
  });
});

test('successful logins do not consume the failed-login allowance', async () => {
  const passwordHash = await bcrypt.hash('correct-password', 4);
  setQueryImplementationForTests(async () => ({
    rows: [{ id: 'admin-id', email: 'admin@example.com', name: 'Admin', role: 'admin', password_hash: passwordHash }],
    rowCount: 1, command: 'SELECT', oid: 0, fields: []
  }));

  await withServer(createApp(), async (baseUrl) => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.com', password: 'correct-password' })
      });
      assert.equal(response.status, 200);
      assert.ok((await response.json() as { token: string }).token);
    }
  });
});

test('production health reports readiness and hides internal database errors', async () => {
  env.nodeEnv = 'production';
  env.databaseUrl = 'postgresql://example.com/postgres';
  const app = createApp();
  assert.equal(app.get('trust proxy'), 1);

  await withServer(app, async (baseUrl) => {
    setQueryImplementationForTests(async () => ({ rows: [{ ok: 1 }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] }));
    const healthy = await fetch(`${baseUrl}/health`);
    assert.equal(healthy.status, 200);
    assert.equal((await healthy.json() as { ok: boolean }).ok, true);

    setQueryImplementationForTests(async () => { throw new Error('internal-host-and-credentials'); });
    const unhealthy = await fetch(`${baseUrl}/health`);
    assert.equal(unhealthy.status, 503);
    const body = await unhealthy.json() as { ok: boolean; databaseError: string };
    assert.equal(body.ok, false);
    assert.equal(body.databaseError, 'Database unavailable');

    env.databaseUrl = undefined;
    const missing = await fetch(`${baseUrl}/health`);
    assert.equal(missing.status, 503);
    await missing.json();
  });
});

test('production errors do not expose query details through ordinary API routes', async () => {
  env.nodeEnv = 'production';
  mock.method(console, 'error', () => undefined);
  setQueryImplementationForTests(async () => { throw new Error('sensitive SQL and database host'); });

  await withServer(createApp(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/publications`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'No pudimos completar la solicitud.' });
  });
});
