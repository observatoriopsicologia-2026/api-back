import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { env, validateR2Config } from '../dist/config.js';
import { PublicationStorage } from '../dist/storage.js';

let storage;
let path;
try {
  validateR2Config(env);
  env.storageDriver = 'r2';
  storage = new PublicationStorage();
  const bytes = Buffer.from('%PDF-1.4\n% Observatorio storage connectivity check\n%%EOF');
  const stored = await storage.savePdf({ buffer: bytes, originalName: 'storage-check.pdf', mimeType: 'application/pdf', ownerId: `_deployment-checks/${randomUUID()}` });
  path = stored.path;
  assert.deepEqual((await storage.download(path)).buffer, bytes);
  const signedUrl = await storage.fileUrl(path, 'storage-check.pdf', false);
  const response = await fetch(signedUrl, { signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  console.log('R2: upload, private read and temporary preview URL passed.');
} catch (error) {
  console.error('R2 check failed:', error.name, error.$metadata?.httpStatusCode ?? '', error.message);
  process.exitCode = 1;
} finally {
  if (storage && path) {
    try { await storage.remove(path); console.log('R2 temporary check object removed.'); }
    catch { console.error('Temporary R2 object could not be removed.'); process.exitCode = 1; }
  }
}
