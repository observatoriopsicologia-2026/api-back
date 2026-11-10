import assert from 'node:assert/strict';
import test from 'node:test';
import { env, validateProductionConfig } from '../src/config.js';

const production = () => ({
  ...env,
  nodeEnv: 'production',
  jwtSecret: 'a-random-production-secret-with-at-least-32-characters',
  databaseUrl: 'postgresql://database.example.com/postgres',
  clientOrigin: 'https://observatorio.example.com',
  storageDriver: 'supabase',
  supabaseUrl: 'https://example.supabase.co',
  supabaseServiceRoleKey: 'test-service-key'
});

test('production validation accepts managed storage and exact HTTPS frontend origins', () => {
  assert.doesNotThrow(() => validateProductionConfig(production()));
  assert.doesNotThrow(() => validateProductionConfig({
    ...production(), clientOrigin: 'https://observatorio.example.com, https://admin.example.com'
  }));
  assert.doesNotThrow(() => validateProductionConfig({ ...production(), nodeEnv: 'development', jwtSecret: 'dev' }));
});

test('production refuses weak JWT secrets and missing database credentials', () => {
  for (const jwtSecret of ['dev-only-change-me', 'short']) {
    assert.throws(() => validateProductionConfig({ ...production(), jwtSecret }), /JWT_SECRET/);
  }
  assert.throws(() => validateProductionConfig({ ...production(), databaseUrl: undefined }), /DATABASE_URL/);
});

test('production refuses wildcard, HTTP, malformed and non-origin CORS values', () => {
  for (const clientOrigin of ['*', '', 'http://localhost:4200', 'https://example.com/', 'https://example.com/path']) {
    assert.throws(() => validateProductionConfig({ ...production(), clientOrigin }), /CLIENT_ORIGIN/);
  }
});

test('production refuses ephemeral local storage and missing Supabase credentials', () => {
  assert.throws(() => validateProductionConfig({ ...production(), storageDriver: 'local' }), /Supabase Storage/);
  assert.throws(() => validateProductionConfig({ ...production(), supabaseUrl: undefined }), /Supabase Storage/);
  assert.throws(() => validateProductionConfig({ ...production(), supabaseServiceRoleKey: undefined }), /Supabase Storage/);
});

test('production supports R2 and rejects missing or malformed bucket credentials', () => {
  const config = { ...production(), storageDriver: 'r2', r2AccountId: 'a'.repeat(32),
    r2AccessKeyId: 'access', r2SecretAccessKey: 'secret', r2Bucket: 'papers' };
  assert.doesNotThrow(() => validateProductionConfig(config));
  for (const field of ['r2AccountId', 'r2AccessKeyId', 'r2SecretAccessKey', 'r2Bucket']) {
    assert.throws(() => validateProductionConfig({ ...config, [field]: '' }), /R2_/);
  }
  assert.throws(() => validateProductionConfig({ ...config, r2AccountId: 'https://invalid' }), /R2_/);
});
