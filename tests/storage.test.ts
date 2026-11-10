import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

const tempRoot = await mkdtemp(join(tmpdir(), 'observatorio-storage-'));
process.env.LOCAL_UPLOAD_DIR = tempRoot;
process.env.STORAGE_DRIVER = 'local';
const { PublicationStorage, publicationStorage, safeDownloadName } = await import('../src/storage.js');

after(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

test('safeDownloadName normalizes empty, quoted and extensionless names', () => {
  assert.equal(safeDownloadName(), 'publicacion.pdf');
  assert.equal(safeDownloadName('paper'), 'paper.pdf');
  assert.equal(safeDownloadName('"paper.pdf"'), 'paper.pdf');
});

test('local publication storage saves, downloads and removes PDFs', async () => {
  const stored = await publicationStorage.savePdf({
    buffer: Buffer.from('pdf-content'),
    originalName: 'Artículo POT.pdf',
    mimeType: 'application/pdf',
    ownerId: 'publication-1'
  });

  assert.equal(stored.originalName, 'Artículo POT.pdf');
  assert.match(stored.path, /^publication-1\/\d+-articulo-pot\.pdf$/);
  assert.equal(await readFile(join(tempRoot, stored.path), 'utf8'), 'pdf-content');

  const downloaded = await publicationStorage.download(stored.path);

  assert.equal(downloaded.buffer.toString(), 'pdf-content');
  assert.equal(downloaded.contentType, 'application/pdf');

  await publicationStorage.remove(stored.path);
  await assert.rejects(() => readFile(join(tempRoot, stored.path)));
  await publicationStorage.remove(null);
});

test('supabase publication storage handles upload, download, remove and provider errors', async () => {
  const { env } = await import('../src/config.js');
  const originalStorageDriver = env.storageDriver;
  const originalSupabaseUrl = env.supabaseUrl;
  const originalServiceKey = env.supabaseServiceRoleKey;
  const originalBucket = env.supabasePublicationBucket;
  let uploadError: { message: string } | null = null;
  let downloadError: { message: string } | null = null;
  const calls: Array<{ action: string; bucket: string; path: string; contentType?: string }> = [];

  env.storageDriver = 'supabase';
  env.supabaseUrl = 'https://example.supabase.co';
  env.supabaseServiceRoleKey = 'service-role';
  env.supabasePublicationBucket = 'papers';

  const fakeClient = {
    storage: {
      from(bucket: string) {
        return {
          async upload(path: string, _buffer: Buffer, options: { contentType: string }) {
            calls.push({ action: 'upload', bucket, path, contentType: options.contentType });
            return { error: uploadError };
          },
          async download(path: string) {
            calls.push({ action: 'download', bucket, path });
            return {
              data: downloadError ? null : new Blob(['pdf-from-supabase'], { type: '' }),
              error: downloadError
            };
          },
          async remove(paths: string[]) {
            calls.push({ action: 'remove', bucket, path: paths[0] });
            return { error: null };
          }
        };
      }
    }
  };

  try {
    const storage = new PublicationStorage(fakeClient as never);
    const stored = await storage.savePdf({
      buffer: Buffer.from('pdf'),
      originalName: '!!!.pdf',
      mimeType: '',
      ownerId: 'publication-2'
    });

    assert.match(stored.path, /^publication-2\/\d+-[a-f0-9-]+\.pdf$/);
    assert.equal(stored.mimeType, 'application/pdf');
    assert.equal(calls[0].contentType, 'application/pdf');

    const downloaded = await storage.download('publication-2/file.pdf');
    assert.equal(downloaded.buffer.toString(), 'pdf-from-supabase');
    assert.equal(downloaded.contentType, 'application/pdf');

    await storage.remove('publication-2/file.pdf');
    assert.deepEqual(
      calls.map((call) => call.action),
      ['upload', 'download', 'remove']
    );

    uploadError = { message: 'bucket offline' };
    await assert.rejects(
      () =>
        storage.savePdf({
          buffer: Buffer.from('pdf'),
          originalName: 'paper.pdf',
          mimeType: 'application/pdf',
          ownerId: 'publication-3'
        }),
      /No se pudo subir el PDF/
    );

    uploadError = null;
    downloadError = { message: 'missing' };
    await assert.rejects(() => storage.download('missing.pdf'), /No se encontr/);
  } finally {
    env.storageDriver = originalStorageDriver;
    env.supabaseUrl = originalSupabaseUrl;
    env.supabaseServiceRoleKey = originalServiceKey;
    env.supabasePublicationBucket = originalBucket;
  }
});

test('supabase storage validates required credentials at construction time', async () => {
  const { env } = await import('../src/config.js');
  const originalStorageDriver = env.storageDriver;
  const originalSupabaseUrl = env.supabaseUrl;
  const originalServiceKey = env.supabaseServiceRoleKey;

  env.storageDriver = 'supabase';
  env.supabaseUrl = undefined;
  env.supabaseServiceRoleKey = undefined;

  await assert.rejects(() => import(`../src/storage.js?missing-${Date.now()}`), /SUPABASE_URL/);

  env.storageDriver = originalStorageDriver;
  env.supabaseUrl = originalSupabaseUrl;
  env.supabaseServiceRoleKey = originalServiceKey;
});

test('R2 uploads, downloads, signs private PDFs and deletes without using local disk', async () => {
  const { env } = await import('../src/config.js');
  const { pdfDisposition } = await import('../src/storage.js');
  const original = { ...env };
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  let missingBody = false;
  let failure: unknown;
  const client = {
    async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
      commands.push({ name: command.constructor.name, input: command.input });
      if (failure) throw failure;
      return { Body: missingBody ? undefined : { transformToByteArray: async () => Buffer.from('private-pdf') } };
    }
  };
  let signedInput: Record<string, unknown> = {};
  const signer = async (_client: unknown, command: { input: Record<string, unknown> }, options: { expiresIn: number }) => {
    signedInput = command.input;
    assert.equal(options.expiresIn, 300);
    return 'https://private.example.com/file?signature=temporary';
  };
  Object.assign(env, { storageDriver: 'r2', r2AccountId: 'a'.repeat(32), r2AccessKeyId: 'test-access', r2SecretAccessKey: 'test-secret', r2Bucket: 'papers' });
  try {
    const storage = new PublicationStorage(undefined, client as never, signer as never);
    const file = await storage.savePdf({ buffer: Buffer.from('pdf'), originalName: 'paper.pdf', mimeType: 'application/pdf', ownerId: 'p1' });
    assert.equal(commands[0].name, 'PutObjectCommand');
    assert.equal(commands[0].input.Bucket, 'papers');
    assert.equal(commands[0].input.Key, file.path);
    assert.equal((await storage.download(file.path)).buffer.toString(), 'private-pdf');
    assert.equal((await storage.download(file.path)).contentType, 'application/pdf');
    assert.match((await storage.fileUrl(file.path, 'Psicologia.pdf', false))!, /signature=temporary/);
    assert.match(String(signedInput.ResponseContentDisposition), /^inline;/);
    await storage.fileUrl(file.path, 'Artículo.pdf', true);
    assert.match(String(signedInput.ResponseContentDisposition), /^attachment;/);
    assert.match(String(signedInput.ResponseContentDisposition), /filename\*=UTF-8''Art%C3%ADculo.pdf/);
    assert.equal(signedInput.ResponseContentType, 'application/pdf');
    await storage.remove(file.path);
    assert.equal(commands.at(-1)?.name, 'DeleteObjectCommand');
    missingBody = true;
    await assert.rejects(() => storage.download('empty.pdf'), /No se encontro/);
    failure = { $metadata: { httpStatusCode: 404 } };
    await assert.rejects(() => storage.fileUrl('missing.pdf', null, false), /No se encontro/);
    failure = new Error('provider unavailable');
    await assert.rejects(() => storage.fileUrl('file.pdf', null, false), /provider unavailable/);
    await assert.rejects(() => storage.savePdf({ buffer: Buffer.from('pdf'), originalName: 'paper', mimeType: '', ownerId: 'p2' }), /provider unavailable/);
    assert.match(pdfDisposition('paper\r\n"(1).pdf', true), /paper%281%29/);
    assert.match(pdfDisposition(null, false), /publicacion.pdf/);
    new PublicationStorage(); // Real client construction needs no network.
    env.r2AccountId = undefined;
    assert.throws(() => new PublicationStorage(), /R2_/);
    env.storageDriver = 'invalid';
    assert.throws(() => new PublicationStorage(), /STORAGE_DRIVER/);
  } finally { Object.assign(env, original); }
  assert.equal(await publicationStorage.fileUrl('local.pdf', null, false), null);
});
