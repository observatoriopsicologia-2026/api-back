import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { login, requireAdmin, requireAuth, seedAdminUser } from '../src/auth.js';
import { env } from '../src/config.js';
import { setQueryImplementationForTests } from '../src/db.js';
import { HttpError } from '../src/http.js';

afterEach(() => {
  setQueryImplementationForTests(undefined);
});

test('login returns token and user for valid credentials', async () => {
  const passwordHash = await bcrypt.hash('secret', 4);
  setQueryImplementationForTests(async () => ({
    rows: [
      {
        id: 'user-1',
        name: 'Admin',
        email: 'admin@example.com',
        role: 'admin',
        password_hash: passwordHash
      }
    ],
    rowCount: 1,
    command: 'SELECT',
    oid: 0,
    fields: []
  }));

  const response = await login('admin@example.com', 'secret');

  assert.equal(response.user.email, 'admin@example.com');
  assert.equal((jwt.verify(response.token, env.jwtSecret) as { id: string }).id, 'user-1');
});

test('login rejects missing users and bad passwords', async () => {
  setQueryImplementationForTests(async () => ({
    rows: [],
    rowCount: 0,
    command: 'SELECT',
    oid: 0,
    fields: []
  }));

  await assert.rejects(() => login('none@example.com', 'secret'), HttpError);

  const passwordHash = await bcrypt.hash('secret', 4);
  setQueryImplementationForTests(async () => ({
    rows: [
      {
        id: 'user-1',
        name: 'Admin',
        email: 'admin@example.com',
        role: 'admin',
        password_hash: passwordHash
      }
    ],
    rowCount: 1,
    command: 'SELECT',
    oid: 0,
    fields: []
  }));

  await assert.rejects(() => login('admin@example.com', 'wrong'), HttpError);
});

test('requireAuth accepts valid bearer tokens', () => {
  const token = jwt.sign({ id: '1', name: 'A', email: 'a@b.com', role: 'admin' }, env.jwtSecret);
  let nextCalled = false;
  const req = {
    headers: {
      authorization: `Bearer ${token}`
    }
  } as never;

  requireAuth(req, {} as never, (error?: unknown) => {
    assert.equal(error, undefined);
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal((req as { user: { email: string } }).user.email, 'a@b.com');
});

test('requireAuth rejects missing or invalid tokens', () => {
  const errors: unknown[] = [];

  requireAuth({ headers: {} } as never, {} as never, (error?: unknown) => errors.push(error));
  requireAuth({ headers: { authorization: 'Bearer bad' } } as never, {} as never, (error?: unknown) => errors.push(error));

  assert.equal(errors.length, 2);
  assert.ok(errors.every((error) => error instanceof HttpError));
});

test('requireAdmin accepts admin/editor and rejects other roles', () => {
  const errors: unknown[] = [];
  let allowed = 0;

  requireAdmin({ user: { role: 'admin' } } as never, {} as never, () => allowed++);
  requireAdmin({ user: { role: 'editor' } } as never, {} as never, () => allowed++);
  requireAdmin({ user: { role: 'viewer' } } as never, {} as never, (error?: unknown) => errors.push(error));
  requireAdmin({} as never, {} as never, (error?: unknown) => errors.push(error));

  assert.equal(allowed, 2);
  assert.equal(errors.length, 2);
});

test('seedAdminUser creates the initial admin when missing and ignores existing users', async () => {
  const originalDatabaseUrl = env.databaseUrl;
  const originalAdminEmail = env.adminEmail;
  const originalAdminPassword = env.adminPassword;
  const originalAdminName = env.adminName;
  const queries: Array<{ sql: string; params: unknown[] }> = [];

  env.databaseUrl = 'postgresql://example';
  env.adminEmail = 'admin@example.com';
  env.adminPassword = 'secret';
  env.adminName = 'Admin Test';

  setQueryImplementationForTests(async (sql, params = []) => {
    queries.push({ sql, params });
    if (sql.includes('select id from users')) {
      return {
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: []
      };
    }
    return {
      rows: [],
      rowCount: 1,
      command: 'INSERT',
      oid: 0,
      fields: []
    };
  });

  await seedAdminUser();

  assert.equal(queries.length, 2);
  assert.equal(queries[1].params[0], 'Admin Test');

  queries.length = 0;
  setQueryImplementationForTests(async () => ({
    rows: [{ id: 'existing' }],
    rowCount: 1,
    command: 'SELECT',
    oid: 0,
    fields: []
  }));

  await seedAdminUser();

  assert.equal(queries.length, 0);

  env.databaseUrl = originalDatabaseUrl;
  env.adminEmail = originalAdminEmail;
  env.adminPassword = originalAdminPassword;
  env.adminName = originalAdminName;
});

test('seedAdminUser exits quietly without database or admin credentials', async () => {
  const originalDatabaseUrl = env.databaseUrl;
  const originalAdminEmail = env.adminEmail;
  const originalAdminPassword = env.adminPassword;
  let called = false;

  env.databaseUrl = undefined;
  setQueryImplementationForTests(async () => {
    called = true;
    throw new Error('should not query');
  });
  await seedAdminUser();
  assert.equal(called, false);

  env.databaseUrl = 'postgresql://example';
  env.adminEmail = undefined;
  env.adminPassword = undefined;
  await seedAdminUser();
  assert.equal(called, false);

  env.databaseUrl = originalDatabaseUrl;
  env.adminEmail = originalAdminEmail;
  env.adminPassword = originalAdminPassword;
});
