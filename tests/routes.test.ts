import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import test, { afterEach, beforeEach } from 'node:test';
import jwt from 'jsonwebtoken';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { env } from '../src/config.js';
import { setQueryImplementationForTests } from '../src/db.js';
import { publicationStorage } from '../src/storage.js';

type QueryCall = { sql: string; params: unknown[] };

let calls: QueryCall[] = [];
let app: Express;

function result<T extends Record<string, unknown>>(rows: T[], rowCount = rows.length) {
  return {
    rows,
    rowCount,
    command: 'MOCK',
    oid: 0,
    fields: []
  };
}

async function request(method: string, path: string, body?: unknown, token?: string) {
  const server = http.createServer(app);
  server.listen(0);
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const isFormData = body instanceof FormData;

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        ...(body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body ? (isFormData ? body : JSON.stringify(body)) : undefined
    });
    const text = await response.text();
    const isJson = response.headers.get('content-type')?.includes('application/json');
    const json = text && isJson ? JSON.parse(text) : undefined;
    return { response, json, text };
  } finally {
    server.close();
    await once(server, 'close');
  }
}

function token(role = 'admin') {
  return jwt.sign({ id: 'user-1', name: 'Admin', email: 'admin@example.com', role }, env.jwtSecret);
}

beforeEach(() => {
  calls = [];
  app = createApp();
});

afterEach(() => {
  setQueryImplementationForTests(undefined);
});

test('publication PDF redirects to a short-lived R2 URL without downloading through the API', async () => {
  setQueryImplementationForTests(async () => result([{ file_path: 'p1/paper.pdf', file_name: 'paper.pdf', file_mime: 'application/pdf' }]));
  const original = publicationStorage.fileUrl;
  publicationStorage.fileUrl = async (path, name, download) => {
    assert.equal(path, 'p1/paper.pdf');
    assert.equal(name, 'paper.pdf');
    assert.equal(download, true);
    return 'https://private.example.com/paper.pdf?temporary=signature';
  };
  try {
    const { response } = await request('GET', '/api/publications/p1/file?mode=download');
    assert.equal(response.status, 302);
    assert.match(response.headers.get('location')!, /temporary=signature/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally { publicationStorage.fileUrl = original; }
});

test('native dataset charts receive visible document metadata through the neutral endpoint', async () => {
  setQueryImplementationForTests(async (sql) => {
    assert.match(sql, /where is_visible/);
    assert.doesNotMatch(sql, /extracted_text/);
    return result([{ id: 'd1', title: 'Paper', topic: 'wellbeing', source_org: 'ILO', year: 2020 }]);
  });
  const { response, json } = await request('GET', '/api/dataset/documents');
  assert.equal(response.status, 200);
  assert.equal(json[0].id, 'd1');
});

test('hidden dataset documents are restricted to authenticated administrators and editors', async () => {
  setQueryImplementationForTests(async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('where id = $1')) return result(params[1] ? [{ id: 'hidden', is_visible: false }] : []);
    return result(/where\s+is_visible/.test(sql) ? [{ id: 'visible' }] : [{ id: 'visible' }, { id: 'hidden' }]);
  });
  const guest = await request('GET', '/api/dataset');
  assert.equal(guest.json.items.length, 1);
  const denied = await request('GET', '/api/dataset/hidden');
  assert.equal(denied.response.status, 404);
  for (const role of ['admin', 'editor']) {
    const managed = await request('GET', '/api/dataset', undefined, token(role));
    assert.equal(managed.json.items.length, 2);
    const hidden = await request('GET', '/api/dataset/hidden', undefined, token(role));
    assert.equal(hidden.json.item.is_visible, false);
  }
  const viewer = await request('GET', '/api/dataset', undefined, token('viewer'));
  assert.equal(viewer.json.items.length, 1);
  assert.equal((await request('GET', '/api/dataset', undefined, 'invalid-token')).response.status, 401);
});

test('GET /api/health reports database success and failure', async () => {
  setQueryImplementationForTests(async (sql, params = []) => {
    calls.push({ sql, params });
    return result([{ ok: 1 }]);
  });

  const ok = await request('GET', '/api/health');
  assert.equal(ok.response.status, 200);
  assert.equal(ok.json.databaseConnected, true);

  setQueryImplementationForTests(async () => {
    throw new Error('network down');
  });

  const down = await request('GET', '/api/health');
  assert.equal(down.response.status, 200);
  assert.equal(down.json.databaseConnected, false);
  assert.equal(down.json.databaseError, 'network down');
});

test('collections can be listed, created, updated and deleted', async () => {
  setQueryImplementationForTests(async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('select *') && sql.includes('from researchers')) {
      return result([{ id: 'r1', name: 'Tatiana', institution: 'UC', country: 'Colombia' }]);
    }
    if (sql.includes('insert into researchers')) {
      return result([{ id: 'r2', name: params[0], country: params[2] }]);
    }
    if (sql.includes('update researchers')) {
      return result([{ id: params.at(-1), name: params[0] }]);
    }
    if (sql.includes('delete from researchers')) {
      return result([], 1);
    }
    return result([]);
  });

  const listed = await request('GET', '/api/researchers?q=Tati&limit=200');
  assert.equal(listed.response.status, 200);
  assert.equal(listed.json.items[0].name, 'Tatiana');
  assert.equal(calls[0].params[1], 100);

  const created = await request('POST', '/api/researchers', { name: 'Nueva', country: 'Colombia' }, token());
  assert.equal(created.response.status, 201);
  assert.equal(created.json.item.name, 'Nueva');

  const badCreate = await request('POST', '/api/researchers', { country: 'Colombia' }, token());
  assert.equal(badCreate.response.status, 400);

  const updated = await request('PUT', '/api/researchers/r2', { name: 'Actualizada' }, token('editor'));
  assert.equal(updated.response.status, 200);
  assert.equal(updated.json.item.name, 'Actualizada');

  const emptyUpdate = await request('PUT', '/api/researchers/r2', {}, token());
  assert.equal(emptyUpdate.response.status, 400);

  const deleted = await request('DELETE', '/api/researchers/r2', undefined, token());
  assert.equal(deleted.response.status, 204);
});

test('collection routes cover limits, payload normalization and not found branches', async () => {
  setQueryImplementationForTests(async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('select *') && sql.includes('from resources')) {
      return result([{ id: 'res1', title: 'Recurso', tags: [] }]);
    }
    if (sql.includes('insert into resources')) {
      return result([{ id: 'res2', title: params[0], tags: params[4], is_featured: params[5] }]);
    }
    if (sql.includes('insert into events')) {
      return result([{ id: 'e1', title: params[0], starts_at: params[2], is_featured: params[7] }]);
    }
    if (sql.includes('update events')) {
      return result([{ id: params.at(-1), starts_at: params[0], is_featured: params[1] }]);
    }
    if (sql.includes('select *') && sql.includes('where id')) {
      return result([]);
    }
    if (sql.includes('update researchers')) {
      return result([]);
    }
    if (sql.includes('delete from resources')) {
      return result([], 0);
    }
    return result([]);
  });

  const invalidLimit = await request('GET', '/api/resources?limit=nan');
  assert.equal(invalidLimit.response.status, 200);
  assert.equal(calls[0].params[0], 50);

  const lowLimit = await request('GET', '/api/resources?limit=0');
  assert.equal(lowLimit.response.status, 200);
  assert.equal(calls[1].params[0], 1);

  const createdResource = await request(
    'POST',
    '/api/resources',
    { title: 'Guia', tags: ['clima', 'liderazgo'], is_featured: 'on' },
    token()
  );
  assert.equal(createdResource.response.status, 201);
  assert.deepEqual(createdResource.json.item.tags, ['clima', 'liderazgo']);
  assert.equal(createdResource.json.item.is_featured, true);

  const createdEvent = await request(
    'POST',
    '/api/events',
    { title: 'Webinar', starts_at: '', is_featured: 1 },
    token()
  );
  assert.equal(createdEvent.response.status, 201);
  assert.equal(createdEvent.json.item.starts_at, null);
  assert.equal(createdEvent.json.item.is_featured, true);

  const updatedEvent = await request('PUT', '/api/events/e1', { starts_at: null, is_featured: '1' }, token());
  assert.equal(updatedEvent.response.status, 200);
  assert.equal(updatedEvent.json.item.starts_at, null);
  assert.equal(updatedEvent.json.item.is_featured, true);

  const missingDetail = await request('GET', '/api/news/missing');
  assert.equal(missingDetail.response.status, 404);

  const missingUpdate = await request('PUT', '/api/researchers/missing', { name: 'Nadie' }, token());
  assert.equal(missingUpdate.response.status, 404);

  const missingDelete = await request('DELETE', '/api/resources/missing', undefined, token());
  assert.equal(missingDelete.response.status, 404);
});

test('publication list, create, update, delete and file download work', async () => {
  const originalDownload = publicationStorage.download;
  const originalRemove = publicationStorage.remove;
  publicationStorage.download = async () => ({ buffer: Buffer.from('pdf'), contentType: 'application/pdf' });
  publicationStorage.remove = async () => undefined;

  setQueryImplementationForTests(async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('from publications') && sql.includes('order by is_featured')) {
      return result([{ id: 'p1', title: 'Paper', country: 'Colombia' }]);
    }
    if (sql.includes('select * from publications where id')) {
      return result([{ id: 'p1', title: 'Paper' }]);
    }
    if (sql.includes('select file_path, file_name, file_mime')) {
      return result([{ file_path: 'p1/paper.pdf', file_name: 'paper.pdf', file_mime: 'application/pdf' }]);
    }
    if (sql.includes('insert into publications')) {
      return result([{ id: params[0], title: params[1], tags: params[6], is_featured: params[11] }]);
    }
    if (sql.includes('select file_path from publications')) {
      return result([{ file_path: 'old/file.pdf' }]);
    }
    if (sql.includes('update publications')) {
      return result([{ id: params.at(-1), title: params[0] }]);
    }
    if (sql.includes('delete from publications')) {
      return result([{ file_path: 'p1/paper.pdf' }], 1);
    }
    return result([]);
  });

  try {
    const listed = await request('GET', '/api/publications?q=Paper&limit=1');
    assert.equal(listed.response.status, 200);
    assert.equal(listed.json.items[0].title, 'Paper');

    const detail = await request('GET', '/api/publications/p1');
    assert.equal(detail.json.item.id, 'p1');

    const file = await request('GET', '/api/publications/p1/file?mode=download');
    assert.equal(file.response.status, 200);
    assert.match(file.response.headers.get('content-disposition') ?? '', /attachment/);

    const unauthorized = await request('POST', '/api/publications', { title: 'Paper' });
    assert.equal(unauthorized.response.status, 401);

    const bad = await request('POST', '/api/publications', { abstract: 'Sin titulo' }, token());
    assert.equal(bad.response.status, 400);

    const created = await request(
      'POST',
      '/api/publications',
      {
        title: 'Paper',
        year: '2026',
        tags: 'clima, bienestar',
        is_featured: 'true',
        published_at: ''
      },
      token()
    );
    assert.equal(created.response.status, 201);
    assert.deepEqual(created.json.item.tags, ['clima', 'bienestar']);
    assert.equal(created.json.item.is_featured, true);

    const updated = await request('PUT', '/api/publications/p1', { title: 'Nuevo' }, token());
    assert.equal(updated.response.status, 200);
    assert.equal(updated.json.item.title, 'Nuevo');

    const noPayload = await request('PUT', '/api/publications/p1', {}, token());
    assert.equal(noPayload.response.status, 400);

    const deleted = await request('DELETE', '/api/publications/p1', undefined, token());
    assert.equal(deleted.response.status, 204);
  } finally {
    publicationStorage.download = originalDownload;
    publicationStorage.remove = originalRemove;
  }
});

test('publication routes cover missing records, inline files, uploads and validation branches', async () => {
  const originalDownload = publicationStorage.download;
  const originalRemove = publicationStorage.remove;
  const originalSavePdf = publicationStorage.savePdf;
  publicationStorage.download = async () => ({ buffer: Buffer.from('pdf'), contentType: '' });
  publicationStorage.remove = async () => undefined;
  publicationStorage.savePdf = async ({ originalName, mimeType, ownerId }) => ({
    path: `${ownerId}/${originalName}`,
    originalName,
    mimeType,
    size: 3
  });

  setQueryImplementationForTests(async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('from publications') && sql.includes('order by is_featured')) {
      return result([]);
    }
    if (sql.includes('select * from publications where id')) {
      return result([]);
    }
    if (sql.includes('select file_path, file_name, file_mime')) {
      if (params[0] === 'no-file') {
        return result([{ file_path: null, file_name: null, file_mime: null }]);
      }
      return result([{ file_path: 'p1/file.pdf', file_name: null, file_mime: null }]);
    }
    if (sql.includes('insert into publications')) {
      return result([
        {
          id: params[0],
          title: params[1],
          year: params[4],
          tags: params[6],
          file_path: params[7],
          is_featured: params[11],
          published_at: params[12]
        }
      ]);
    }
    if (sql.includes('select file_path from publications')) {
      return params[0] === 'missing' ? result([], 0) : result([{ file_path: 'old/file.pdf' }]);
    }
    if (sql.includes('update publications')) {
      return result([{ id: params.at(-1), year: params[0], tags: params[1], is_featured: params[2], published_at: params[3] }]);
    }
    if (sql.includes('delete from publications')) {
      return result([], 0);
    }
    return result([]);
  });

  try {
    const emptyList = await request('GET', '/api/publications?limit=0');
    assert.equal(emptyList.response.status, 200);
    assert.equal(calls[0].params[0], 1);

    const missingDetail = await request('GET', '/api/publications/missing');
    assert.equal(missingDetail.response.status, 404);

    const noFile = await request('GET', '/api/publications/no-file/file');
    assert.equal(noFile.response.status, 404);

    const inlineFile = await request('GET', '/api/publications/p1/file');
    assert.equal(inlineFile.response.status, 200);
    assert.match(inlineFile.response.headers.get('content-disposition') ?? '', /inline/);
    assert.equal(inlineFile.response.headers.get('content-type'), 'application/pdf');

    const invalidFile = new FormData();
    invalidFile.set('title', 'Paper');
    invalidFile.set('file', new Blob(['txt'], { type: 'text/plain' }), 'notes.txt');
    const rejectedUpload = await request('POST', '/api/publications', invalidFile, token());
    assert.equal(rejectedUpload.response.status, 400);

    const validFile = new FormData();
    validFile.set('title', 'Paper con PDF');
    validFile.set('year', 'abc');
    validFile.set('tags', '');
    validFile.set('published_at', '');
    validFile.set('file', new Blob(['pdf'], { type: 'application/pdf' }), 'paper.pdf');
    const created = await request('POST', '/api/publications', validFile, token());
    assert.equal(created.response.status, 201);
    assert.equal(created.json.item.year, null);
    assert.deepEqual(created.json.item.tags, []);
    assert.match(created.json.item.file_path, /paper\.pdf$/);

    const missingUpdate = await request('PUT', '/api/publications/missing', { title: 'Nuevo' }, token());
    assert.equal(missingUpdate.response.status, 404);

    const updated = await request(
      'PUT',
      '/api/publications/p1',
      { year: '', tags: ['datos'], is_featured: 'on', published_at: null },
      token()
    );
    assert.equal(updated.response.status, 200);
    assert.equal(updated.json.item.year, null);
    assert.deepEqual(updated.json.item.tags, ['datos']);
    assert.equal(updated.json.item.is_featured, true);
    assert.equal(updated.json.item.published_at, null);

    const missingDelete = await request('DELETE', '/api/publications/missing', undefined, token());
    assert.equal(missingDelete.response.status, 404);
  } finally {
    publicationStorage.download = originalDownload;
    publicationStorage.remove = originalRemove;
    publicationStorage.savePdf = originalSavePdf;
  }
});

test('analytics endpoints shape dashboard and Power BI rows', async () => {
  setQueryImplementationForTests(async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('select') && sql.includes('publications_with_pdf')) {
      return result([
        {
          publications: 2,
          publications_with_pdf: 1,
          researchers: 3,
          events: 4,
          news: 5,
          resources: 6,
          countries: 7,
          institutions: 3
        }
      ]);
    }
    if (sql.includes('from publications') && sql.includes('coalesce(year')) {
      return result([{ label: '2026', value: '2' }]);
    }
    if (sql.includes('from publications') && sql.includes('group by country')) {
      return result([{ label: 'Colombia', value: 2 }]);
    }
    if (sql.includes('unnest(tags)')) {
      return result([{ label: 'bienestar', value: 1 }]);
    }
    if (sql.includes('from researchers') && sql.includes('group by country')) {
      return result([{ label: 'Colombia', value: 3 }]);
    }
    if (sql.includes('from researchers') && sql.includes('specialty')) {
      return result([{ label: 'POT', value: 3 }]);
    }
    if (sql.includes('from events') && sql.includes('modality')) {
      return result([{ label: 'Virtual', value: 4 }]);
    }
    if (sql.includes('from events') && sql.includes('date_trunc')) {
      return result([{ label: '2026-05', value: 2 }]);
    }
    if (sql.includes('from news') && sql.includes('date_trunc')) {
      return result([{ label: '2026-05', value: 1 }]);
    }
    if (sql.includes('from resources') && sql.includes('group by')) {
      return result([{ label: 'Guia', value: 2 }]);
    }
    if (sql.includes('select title, authors')) {
      return result([{ title: 'Paper', authors: 'Autor', country: 'Colombia', year: 2026 }]);
    }
    return result([]);
  });

  const analytics = await request('GET', '/api/analytics');
  assert.equal(analytics.response.status, 200);
  assert.equal(analytics.json.summary.publications, 2);
  assert.equal(analytics.json.summary.institutions, 3);
  assert.equal(analytics.json.publications_by_country[0].label, 'Colombia');

  const powerBi = await request('GET', '/api/analytics/powerbi');
  assert.equal(powerBi.response.status, 200);
  assert.ok(powerBi.json.some((row: { metric: string; label: string }) => row.metric === 'Resumen' && row.label === 'Publicaciones'));
});

test('dataset endpoints list, manage and expose Power BI rows', async () => {
  setQueryImplementationForTests(async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('from dataset_documents') && sql.includes('order by is_visible')) {
      return result([
        {
          id: 'd1',
          title: 'Worker wellbeing',
          author: 'ILO',
          topic: 'worker wellbeing',
          source_org: 'ILO',
          year: 2024,
          language: ['en'],
          document_type: 'Report',
          is_visible: true
        }
      ]);
    }
    if (sql.includes('select * from dataset_documents where id')) {
      return params[0] === 'missing'
        ? result([])
        : result([{ id: 'd1', title: 'Worker wellbeing', language: ['en'], is_visible: true }]);
    }
    if (sql.includes('insert into dataset_documents')) {
      return result([{ id: 'd2', title: params[0], language: params[4], is_visible: params[13] }]);
    }
    if (sql.includes('update dataset_documents')) {
      return params.at(-1) === 'missing'
        ? result([])
        : result([{ id: params.at(-1), title: params[0], language: params[1], is_visible: params[2] }]);
    }
    if (sql.includes('delete from dataset_documents')) {
      return result([], params[0] === 'missing' ? 0 : 1);
    }
    if (sql.includes('count(*)::int as documents')) {
      return result([{ documents: 8, visible_documents: 7, topics: 3, sources: 2, years: 5 }]);
    }
    if (sql.includes('group by topic')) {
      return result([{ label: 'worker wellbeing', value: 4 }]);
    }
    if (sql.includes('group by source_org')) {
      return result([{ label: 'ILO', value: 5 }]);
    }
    if (sql.includes('group by year')) {
      return result([{ label: '2024', value: 3 }]);
    }
    if (sql.includes('unnest(language)')) {
      return result([{ label: 'en', value: 7 }]);
    }
    if (sql.includes('group by document_type')) {
      return result([{ label: 'Report', value: 6 }]);
    }
    if (sql.includes('where is_visible') && sql.includes('limit 6')) {
      return result([{ id: 'd1', title: 'Worker wellbeing', language: ['en'], is_visible: true }]);
    }
    if (sql.includes('row_label') && sql.includes('column_label')) {
      return result([
        { row_label: 'worker wellbeing', column_label: 'ILO', value: 4 },
        { row_label: 'mental health', column_label: 'UN', value: '3' }
      ]);
    }
    if (sql.includes('array_to_string(language')) {
      return result([{ title: 'Worker wellbeing', topic: 'worker wellbeing', source_org: 'ILO', language: 'en' }]);
    }
    return result([]);
  });

  const listed = await request('GET', '/api/dataset?q=wellbeing&topic=worker wellbeing&limit=nan');
  assert.equal(listed.response.status, 200);
  assert.equal(listed.json.items[0].title, 'Worker wellbeing');
  assert.equal(calls[0].params.at(-1), 50);

  const detail = await request('GET', '/api/dataset/d1');
  assert.equal(detail.response.status, 200);
  assert.equal(detail.json.item.id, 'd1');

  const missingDetail = await request('GET', '/api/dataset/missing');
  assert.equal(missingDetail.response.status, 404);

  const badCreate = await request('POST', '/api/dataset', { author: 'ILO' }, token());
  assert.equal(badCreate.response.status, 400);

  const created = await request(
    'POST',
    '/api/dataset',
    {
      title: 'Manual document',
      language: 'en;es',
      year: '2024',
      publication_date: '',
      is_visible: 'on'
    },
    token()
  );
  assert.equal(created.response.status, 201);
  assert.deepEqual(created.json.item.language, ['en', 'es']);
  assert.equal(created.json.item.is_visible, true);

  const badUpdate = await request('PUT', '/api/dataset/d1', {}, token());
  assert.equal(badUpdate.response.status, 400);

  const updated = await request('PUT', '/api/dataset/d1', { title: 'Updated', language: ['en'], is_visible: false }, token());
  assert.equal(updated.response.status, 200);
  assert.equal(updated.json.item.title, 'Updated');
  assert.equal(updated.json.item.is_visible, false);

  const missingUpdate = await request('PUT', '/api/dataset/missing', { title: 'Nobody' }, token());
  assert.equal(missingUpdate.response.status, 404);

  const analytics = await request('GET', '/api/dataset/analytics');
  assert.equal(analytics.response.status, 200);
  assert.equal(analytics.json.summary.documents, 8);
  assert.equal(analytics.json.documents_by_topic[0].label, 'worker wellbeing');

  const powerbi = await request('GET', '/api/dataset/powerbi');
  assert.equal(powerbi.response.status, 200);
  assert.ok(powerbi.json.some((row: { metric: string; label: string }) => row.metric === 'Dataset resumen' && row.label === 'Documentos'));

  const powerbiDocuments = await request('GET', '/api/dataset/powerbi/documents');
  assert.equal(powerbiDocuments.response.status, 200);
  assert.equal(powerbiDocuments.json[0].language, 'en');

  const pivot = await request('GET', '/api/dataset/pivot?row=topic&column=source_org');
  assert.equal(pivot.response.status, 200);
  assert.deepEqual(pivot.json.columns, ['ILO', 'UN']);
  assert.equal(pivot.json.rows[0].total, 4);

  const deleted = await request('DELETE', '/api/dataset/d1', undefined, token());
  assert.equal(deleted.response.status, 204);

  const missingDelete = await request('DELETE', '/api/dataset/missing', undefined, token());
  assert.equal(missingDelete.response.status, 404);
});

test('unknown routes return 404', async () => {
  setQueryImplementationForTests(async () => result([]));

  const response = await request('GET', '/api/nope');

  assert.equal(response.response.status, 404);
});
