import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireAdmin, requireAuth, login, type AuthRequest } from './auth.js';
import { env } from './config.js';
import { query } from './db.js';
import { asyncHandler, HttpError } from './http.js';
import { publicationStorage, safeDownloadName } from './storage.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, done) => {
    const isPdf = file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      done(new HttpError(400, 'Solo se permiten archivos PDF.'));
      return;
    }
    done(null, true);
  }
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const parseBoolean = (value: unknown) =>
  value === true || value === 'true' || value === '1' || value === 'on' || value === 1;

const parseTags = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
};

const nullable = (value: unknown) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return value;
};

const toInteger = (value: unknown) => {
  const clean = nullable(value);
  if (clean === null) {
    return null;
  }
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : null;
};

const clampLimit = (value: unknown) => {
  const limit = Number(value ?? 50);
  if (!Number.isFinite(limit)) {
    return 50;
  }
  return Math.min(Math.max(limit, 1), 100);
};

const searchClause = (fields: string[], search: unknown, startIndex = 1) => {
  const q = typeof search === 'string' ? search.trim() : '';
  if (!q) {
    return { sql: '', params: [] as unknown[] };
  }

  const parts = fields.map((field) => `${field} ilike $${startIndex}`);
  return {
    sql: `where ${parts.join(' or ')}`,
    params: [`%${q}%`]
  };
};

function recordNotFound(): never {
  throw new HttpError(404, 'No se encontró el registro solicitado.');
}

type CollectionName = 'researchers' | 'events' | 'news' | 'resources';

const collections: Record<
  CollectionName,
  {
    table: string;
    fields: string[];
    search: string[];
    order: string;
  }
> = {
  researchers: {
    table: 'researchers',
    fields: ['name', 'institution', 'country', 'specialty', 'bio', 'email', 'profile_url', 'is_featured'],
    search: ['name', 'institution', 'country', 'specialty'],
    order: 'is_featured desc, name asc'
  },
  events: {
    table: 'events',
    fields: ['title', 'description', 'starts_at', 'location', 'modality', 'category', 'url', 'is_featured'],
    search: ['title', 'description', 'location', 'category'],
    order: 'starts_at asc nulls last, created_at desc'
  },
  news: {
    table: 'news',
    fields: ['title', 'summary', 'body', 'image_url', 'source_url', 'published_at', 'is_featured'],
    search: ['title', 'summary', 'body'],
    order: 'published_at desc nulls last, created_at desc'
  },
  resources: {
    table: 'resources',
    fields: ['title', 'description', 'type', 'url', 'tags', 'is_featured'],
    search: ['title', 'description', 'type', "array_to_string(tags, ' ')"],
    order: 'is_featured desc, title asc'
  }
};

function normalizeField(field: string, value: unknown) {
  if (field === 'is_featured') {
    return parseBoolean(value);
  }
  if (field === 'tags') {
    return parseTags(value);
  }
  if (field === 'starts_at' || field === 'published_at') {
    return nullable(value);
  }
  return value ?? '';
}

function pickPayload(fields: string[], body: Record<string, unknown>, partial = false) {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    if (!partial || Object.prototype.hasOwnProperty.call(body, field)) {
      payload[field] = normalizeField(field, body[field]);
    }
  }
  return payload;
}

async function listCollection(name: CollectionName, reqQuery: Record<string, unknown>) {
  const config = collections[name];
  const search = searchClause(config.search, reqQuery.q);
  const limit = clampLimit(reqQuery.limit);
  const result = await query(
    `select *
     from ${config.table}
     ${search.sql}
     order by ${config.order}
     limit $${search.params.length + 1}`,
    [...search.params, limit]
  );
  return result.rows;
}

async function createCollectionItem(name: CollectionName, body: Record<string, unknown>) {
  const config = collections[name];
  const payload = pickPayload(config.fields, body);
  const fields = Object.keys(payload);

  if (!payload.title && !payload.name) {
    throw new HttpError(400, 'El nombre o título es obligatorio.');
  }

  const placeholders = fields.map((_, index) => `$${index + 1}`);
  const result = await query(
    `insert into ${config.table} (${fields.join(', ')})
     values (${placeholders.join(', ')})
     returning *`,
    fields.map((field) => payload[field])
  );
  return result.rows[0];
}

async function updateCollectionItem(name: CollectionName, id: string, body: Record<string, unknown>) {
  const config = collections[name];
  const payload = pickPayload(config.fields, body, true);
  const fields = Object.keys(payload);

  if (!fields.length) {
    throw new HttpError(400, 'No se enviaron campos para actualizar.');
  }

  const set = fields.map((field, index) => `${field} = $${index + 1}`);
  const result = await query(
    `update ${config.table}
     set ${set.join(', ')}
     where id = $${fields.length + 1}
     returning *`,
    [...fields.map((field) => payload[field]), id]
  );

  return result.rows[0] ?? recordNotFound();
}

interface MetricPoint {
  label: string;
  value: number;
}

interface AnalyticsSummaryRow {
  publications: number | string;
  publications_with_pdf: number | string;
  researchers: number | string;
  events: number | string;
  news: number | string;
  resources: number | string;
  countries: number | string;
}

interface LatestPublicationRow {
  title: string;
  authors: string;
  country: string;
  year: number | null;
}

interface AnalyticsData {
  generated_at: string;
  summary: {
    publications: number;
    publications_with_pdf: number;
    researchers: number;
    events: number;
    news: number;
    resources: number;
    countries: number;
  };
  publications_by_year: MetricPoint[];
  publications_by_country: MetricPoint[];
  publications_by_tag: MetricPoint[];
  researchers_by_country: MetricPoint[];
  researchers_by_specialty: MetricPoint[];
  events_by_modality: MetricPoint[];
  events_by_month: MetricPoint[];
  news_by_month: MetricPoint[];
  resources_by_type: MetricPoint[];
  latest_publications: LatestPublicationRow[];
}

function toNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function metricQuery(sql: string, params: unknown[] = []): Promise<MetricPoint[]> {
  const result = await query<{ label: string | null; value: number | string }>(sql, params);
  return result.rows.map((row) => ({
    label: row.label?.trim() || 'Sin dato',
    value: toNumber(row.value)
  }));
}

async function loadAnalytics(): Promise<AnalyticsData> {
  const [
    summaryResult,
    publicationsByYear,
    publicationsByCountry,
    publicationsByTag,
    researchersByCountry,
    researchersBySpecialty,
    eventsByModality,
    eventsByMonth,
    newsByMonth,
    resourcesByType,
    latestPublications
  ] = await Promise.all([
    query<AnalyticsSummaryRow>(
      `select
        (select count(*)::int from publications) as publications,
        (select count(*)::int from publications where file_path is not null) as publications_with_pdf,
        (select count(*)::int from researchers) as researchers,
        (select count(*)::int from events) as events,
        (select count(*)::int from news) as news,
        (select count(*)::int from resources) as resources,
        (
          select count(*)::int
          from (
            select nullif(trim(country), '') as country from publications
            union
            select nullif(trim(country), '') as country from researchers
          ) countries
          where country is not null
        ) as countries`
    ),
    metricQuery(
      `select coalesce(year, extract(year from published_at)::int)::text as label, count(*)::int as value
       from publications
       where coalesce(year, extract(year from published_at)::int) is not null
       group by coalesce(year, extract(year from published_at)::int)
       order by coalesce(year, extract(year from published_at)::int)`
    ),
    metricQuery(
      `select country as label, count(*)::int as value
       from publications
       where nullif(trim(country), '') is not null
       group by country
       order by value desc, label asc
       limit 10`
    ),
    metricQuery(
      `select tag as label, count(*)::int as value
       from publications, unnest(tags) tag
       where nullif(trim(tag), '') is not null
       group by tag
       order by value desc, label asc
       limit 10`
    ),
    metricQuery(
      `select country as label, count(*)::int as value
       from researchers
       where nullif(trim(country), '') is not null
       group by country
       order by value desc, label asc
       limit 10`
    ),
    metricQuery(
      `select specialty as label, count(*)::int as value
       from researchers
       where nullif(trim(specialty), '') is not null
       group by specialty
       order by value desc, label asc
       limit 10`
    ),
    metricQuery(
      `select coalesce(nullif(trim(modality), ''), 'Sin modalidad') as label, count(*)::int as value
       from events
       group by coalesce(nullif(trim(modality), ''), 'Sin modalidad')
       order by value desc, label asc`
    ),
    metricQuery(
      `select to_char(date_trunc('month', starts_at), 'YYYY-MM') as label, count(*)::int as value
       from events
       where starts_at is not null
       group by date_trunc('month', starts_at)
       order by date_trunc('month', starts_at)`
    ),
    metricQuery(
      `select to_char(date_trunc('month', published_at), 'YYYY-MM') as label, count(*)::int as value
       from news
       where published_at is not null
       group by date_trunc('month', published_at)
       order by date_trunc('month', published_at)`
    ),
    metricQuery(
      `select coalesce(nullif(trim(type), ''), 'Sin tipo') as label, count(*)::int as value
       from resources
       group by coalesce(nullif(trim(type), ''), 'Sin tipo')
       order by value desc, label asc
       limit 10`
    ),
    query<LatestPublicationRow>(
      `select title, authors, country, year
       from publications
       order by published_at desc nulls last, created_at desc
       limit 5`
    )
  ]);

  const summary = summaryResult.rows[0];

  return {
    generated_at: new Date().toISOString(),
    summary: {
      publications: toNumber(summary?.publications),
      publications_with_pdf: toNumber(summary?.publications_with_pdf),
      researchers: toNumber(summary?.researchers),
      events: toNumber(summary?.events),
      news: toNumber(summary?.news),
      resources: toNumber(summary?.resources),
      countries: toNumber(summary?.countries)
    },
    publications_by_year: publicationsByYear,
    publications_by_country: publicationsByCountry,
    publications_by_tag: publicationsByTag,
    researchers_by_country: researchersByCountry,
    researchers_by_specialty: researchersBySpecialty,
    events_by_modality: eventsByModality,
    events_by_month: eventsByMonth,
    news_by_month: newsByMonth,
    resources_by_type: resourcesByType,
    latest_publications: latestPublications.rows
  };
}

function toPowerBiRows(data: AnalyticsData) {
  const summaryRows = [
    { label: 'Publicaciones', value: data.summary.publications },
    { label: 'Publicaciones con PDF', value: data.summary.publications_with_pdf },
    { label: 'Investigadores', value: data.summary.researchers },
    { label: 'Eventos', value: data.summary.events },
    { label: 'Noticias', value: data.summary.news },
    { label: 'Recursos', value: data.summary.resources },
    { label: 'Paises', value: data.summary.countries }
  ];

  const sections: Array<[string, MetricPoint[]]> = [
    ['Resumen', summaryRows],
    ['Publicaciones por ano', data.publications_by_year],
    ['Publicaciones por pais', data.publications_by_country],
    ['Publicaciones por etiqueta', data.publications_by_tag],
    ['Investigadores por pais', data.researchers_by_country],
    ['Investigadores por especialidad', data.researchers_by_specialty],
    ['Eventos por modalidad', data.events_by_modality],
    ['Eventos por mes', data.events_by_month],
    ['Noticias por mes', data.news_by_month],
    ['Recursos por tipo', data.resources_by_type]
  ];

  return sections.flatMap(([metric, points]) =>
    points.map((point) => ({
      metric,
      label: point.label,
      value: point.value,
      generated_at: data.generated_at
    }))
  );
}

router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    let databaseConnected = false;
    let databaseError = '';

    if (env.databaseUrl) {
      try {
        await query('select 1 as ok');
        databaseConnected = true;
      } catch (error) {
        databaseError = error instanceof Error ? error.message : 'Unknown database error';
        databaseConnected = false;
      }
    }

  res.json({
    ok: true,
    service: 'observatorio-pot-api',
    databaseConfigured: Boolean(env.databaseUrl),
      databaseConnected,
      databaseError,
    storageDriver: env.storageDriver
  });
  })
);

router.post(
  '/auth/login',
  asyncHandler(async (req, res) => {
    const credentials = loginSchema.parse(req.body);
    res.json(await login(credentials.email, credentials.password));
  })
);

router.get('/auth/me', requireAuth, (req: AuthRequest, res) => {
  res.json({ user: req.user });
});

router.get(
  '/analytics',
  asyncHandler(async (_req, res) => {
    res.json(await loadAnalytics());
  })
);

router.get(
  '/analytics/powerbi',
  asyncHandler(async (_req, res) => {
    res.json(toPowerBiRows(await loadAnalytics()));
  })
);

router.get(
  '/publications',
  asyncHandler(async (req, res) => {
    const search = searchClause(['title', 'abstract', 'authors', 'country', "array_to_string(tags, ' ')"], req.query.q);
    const limit = clampLimit(req.query.limit);
    const result = await query(
      `select *
       from publications
       ${search.sql}
       order by is_featured desc, published_at desc nulls last, created_at desc
       limit $${search.params.length + 1}`,
      [...search.params, limit]
    );
    res.json({ items: result.rows });
  })
);

router.get(
  '/publications/:id',
  asyncHandler(async (req, res) => {
    const result = await query('select * from publications where id = $1', [req.params.id]);
    res.json({ item: result.rows[0] ?? recordNotFound() });
  })
);

router.get(
  '/publications/:id/file',
  asyncHandler(async (req, res) => {
    const result = await query<{
      file_path: string | null;
      file_name: string | null;
      file_mime: string | null;
    }>('select file_path, file_name, file_mime from publications where id = $1', [req.params.id]);
    const item = result.rows[0] ?? recordNotFound();

    if (!item.file_path) {
      throw new HttpError(404, 'Esta publicación no tiene PDF cargado.');
    }

    const file = await publicationStorage.download(item.file_path);
    const disposition = req.query.mode === 'download' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', item.file_mime || file.contentType || 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${safeDownloadName(item.file_name)}"`);
    res.send(file.buffer);
  })
);

router.post(
  '/publications',
  requireAuth,
  requireAdmin,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const id = randomUUID();

    if (!body.title) {
      throw new HttpError(400, 'El título es obligatorio.');
    }

    let storedFile = null;
    if (req.file) {
      storedFile = await publicationStorage.savePdf({
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        ownerId: id
      });
    }

    const result = await query(
      `insert into publications (
        id, title, abstract, authors, year, country, tags, file_path, file_name,
        file_mime, file_size, is_featured, published_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      returning *`,
      [
        id,
        body.title,
        body.abstract ?? '',
        body.authors ?? '',
        toInteger(body.year),
        body.country ?? '',
        parseTags(body.tags),
        storedFile?.path ?? null,
        storedFile?.originalName ?? null,
        storedFile?.mimeType ?? null,
        storedFile?.size ?? null,
        parseBoolean(body.is_featured),
        nullable(body.published_at)
      ]
    );

    res.status(201).json({ item: result.rows[0] });
  })
);

router.put(
  '/publications/:id',
  requireAuth,
  requireAdmin,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const existing = await query<{ file_path: string | null }>('select file_path from publications where id = $1', [
      req.params.id
    ]);
    if (!existing.rowCount) {
      recordNotFound();
    }

    const body = req.body as Record<string, unknown>;
    const payload: Record<string, unknown> = {};
    const fields = ['title', 'abstract', 'authors', 'year', 'country', 'tags', 'is_featured', 'published_at'];

    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        payload[field] =
          field === 'year'
            ? toInteger(body[field])
            : field === 'tags'
              ? parseTags(body[field])
              : field === 'is_featured'
                ? parseBoolean(body[field])
                : field === 'published_at'
                  ? nullable(body[field])
                  : body[field] ?? '';
      }
    }

    if (req.file) {
      await publicationStorage.remove(existing.rows[0].file_path);
      const storedFile = await publicationStorage.savePdf({
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        ownerId: req.params.id
      });
      payload.file_path = storedFile.path;
      payload.file_name = storedFile.originalName;
      payload.file_mime = storedFile.mimeType;
      payload.file_size = storedFile.size;
    }

    const setFields = Object.keys(payload);
    if (!setFields.length) {
      throw new HttpError(400, 'No se enviaron campos para actualizar.');
    }

    const set = setFields.map((field, index) => `${field} = $${index + 1}`);
    const result = await query(
      `update publications
       set ${set.join(', ')}
       where id = $${setFields.length + 1}
       returning *`,
      [...setFields.map((field) => payload[field]), req.params.id]
    );

    res.json({ item: result.rows[0] });
  })
);

router.delete(
  '/publications/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const existing = await query<{ file_path: string | null }>(
      'delete from publications where id = $1 returning file_path',
      [req.params.id]
    );
    if (!existing.rowCount) {
      recordNotFound();
    }
    await publicationStorage.remove(existing.rows[0].file_path);
    res.status(204).send();
  })
);

for (const name of Object.keys(collections) as CollectionName[]) {
  router.get(
    `/${name}`,
    asyncHandler(async (req, res) => {
      res.json({ items: await listCollection(name, req.query) });
    })
  );

  router.get(
    `/${name}/:id`,
    asyncHandler(async (req, res) => {
      const config = collections[name];
      const result = await query(`select * from ${config.table} where id = $1`, [req.params.id]);
      res.json({ item: result.rows[0] ?? recordNotFound() });
    })
  );

  router.post(
    `/${name}`,
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      res.status(201).json({ item: await createCollectionItem(name, req.body) });
    })
  );

  router.put(
    `/${name}/:id`,
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      res.json({ item: await updateCollectionItem(name, req.params.id, req.body) });
    })
  );

  router.delete(
    `/${name}/:id`,
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const config = collections[name];
      const result = await query(`delete from ${config.table} where id = $1`, [req.params.id]);
      if (!result.rowCount) {
        recordNotFound();
      }
      res.status(204).send();
    })
  );
}

export default router;
