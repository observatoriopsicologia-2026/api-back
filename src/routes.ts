import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireAdmin, requireAuth, login, type AuthRequest } from './auth.js';
import { env } from './config.js';
import {
  createDatasetDocument,
  deleteDatasetDocument,
  getDatasetDocument,
  listDatasetDocuments,
  listDatasetPowerBiDocuments,
  loadDatasetPivot,
  loadDatasetAnalytics,
  toDatasetPowerBiRows,
  updateDatasetDocument
} from './dataset.js';
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

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Verificar estado de la API
 *     description: Comprueba si la API y la conexión a la base de datos están funcionando correctamente.
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Estado actual de la API
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 databaseConnected:
 *                   type: boolean
 *                   example: true
 *                 databaseError:
 *                   type: string
 *                   example: ""
 */
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

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Iniciar sesión
 *     description: Autentica un usuario y devuelve un token JWT.
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 example: admin@observatorio.local
 *               password:
 *                 type: string
 *                 example: password123
 *     responses:
 *       200:
 *         description: Login exitoso
 *       401:
 *         description: Credenciales inválidas
 */
router.post(
  '/auth/login',
  asyncHandler(async (req, res) => {
    const credentials = loginSchema.parse(req.body);
    res.json(await login(credentials.email, credentials.password));
  })
);

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Obtener usuario autenticado
 *     description: Devuelve la información del usuario autenticado mediante JWT.
 *     tags:
 *       - Auth
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Información del usuario autenticado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *       401:
 *         description: No autorizado
 */
router.get('/auth/me', requireAuth, (req: AuthRequest, res) => {
  res.json({ user: req.user });
});

/**
 * @swagger
 * /api/analytics:
 *   get:
 *     summary: Obtener analíticas del observatorio
 *     description: Devuelve métricas y estadísticas generales del dataset documental.
 *     tags:
 *       - Analytics
 *     responses:
 *       200:
 *         description: Analíticas obtenidas correctamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 summary:
 *                   type: object
 *                   properties:
 *                     documents:
 *                       type: number
 *                       example: 120
 *                     visible_documents:
 *                       type: number
 *                       example: 110
 *                     topics:
 *                       type: number
 *                       example: 8
 *                     sources:
 *                       type: number
 *                       example: 4
 *                     years:
 *                       type: number
 *                       example: 15
 *                 documents_by_year:
 *                   type: array
 *                   items:
 *                     type: object
 *                 documents_by_topic:
 *                   type: array
 *                   items:
 *                     type: object
 */
router.get(
  '/analytics',
  asyncHandler(async (_req, res) => {
    res.json(await loadAnalytics());
  })
);

/**
 * @swagger
 * /api/analytics/powerbi:
 *   get:
 *     summary: Obtener datos para Power BI
 *     description: Devuelve la información analítica transformada para integración con Power BI.
 *     tags:
 *       - Analytics
 *     responses:
 *       200:
 *         description: Datos preparados para Power BI
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   category:
 *                     type: string
 *                     example: Salud mental
 *                   value:
 *                     type: number
 *                     example: 25
 *                   year:
 *                     type: number
 *                     example: 2025
 */
router.get(
  '/analytics/powerbi',
  asyncHandler(async (_req, res) => {
    res.json(toPowerBiRows(await loadAnalytics()));
  })
);

/**
 * @swagger
 * /api/dataset/analytics:
 *   get:
 *     summary: Obtener analíticas del dataset
 *     description: Devuelve estadísticas y métricas asociadas al dataset documental del observatorio.
 *     tags:
 *       - Dataset
 *     responses:
 *       200:
 *         description: Analíticas del dataset obtenidas correctamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 summary:
 *                   type: object
 *                   properties:
 *                     documents:
 *                       type: number
 *                       example: 150
 *                     topics:
 *                       type: number
 *                       example: 12
 *                     sources:
 *                       type: number
 *                       example: 5
 *                 documents_by_year:
 *                   type: array
 *                   items:
 *                     type: object
 *                 documents_by_topic:
 *                   type: array
 *                   items:
 *                     type: object
 *                 documents_by_source:
 *                   type: array
 *                   items:
 *                     type: object
 */
router.get(
  '/dataset/analytics',
  asyncHandler(async (_req, res) => {
    res.json(await loadDatasetAnalytics());
  })
);

/**
 * @swagger
 * /api/dataset/powerbi:
 *   get:
 *     summary: Obtener dataset para Power BI
 *     description: Devuelve los datos del dataset transformados y estructurados para visualización en Power BI.
 *     tags:
 *       - Dataset
 *     responses:
 *       200:
 *         description: Datos exportados correctamente para Power BI
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   title:
 *                     type: string
 *                     example: Riesgos psicosociales en el trabajo
 *                   topic:
 *                     type: string
 *                     example: Salud mental
 *                   source:
 *                     type: string
 *                     example: ILO
 *                   year:
 *                     type: number
 *                     example: 2024
 *                   value:
 *                     type: number
 *                     example: 18
 */
router.get(
  '/dataset/powerbi',
  asyncHandler(async (_req, res) => {
    res.json(toDatasetPowerBiRows(await loadDatasetAnalytics()));
  })
);

/**
 * @swagger
 * /api/dataset/powerbi/documents:
 *   get:
 *     summary: Obtener documentos del dataset para Power BI
 *     description: Devuelve el listado de documentos preparados para consumo y visualización en Power BI.
 *     tags:
 *       - Dataset
 *     responses:
 *       200:
 *         description: Lista de documentos obtenida correctamente
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: number
 *                     example: 1
 *                   title:
 *                     type: string
 *                     example: Bienestar laboral y salud mental
 *                   author:
 *                     type: string
 *                     example: Organización Internacional del Trabajo
 *                   topic:
 *                     type: string
 *                     example: Salud ocupacional
 *                   source_org:
 *                     type: string
 *                     example: ILO
 *                   year:
 *                     type: number
 *                     example: 2025
 *                   document_type:
 *                     type: string
 *                     example: Informe
 *                   source_url:
 *                     type: string
 *                     example: https://example.org/document.pdf
 */
router.get(
  '/dataset/powerbi/documents',
  asyncHandler(async (_req, res) => {
    res.json(await listDatasetPowerBiDocuments());
  })
);

/**
 * @swagger
 * /api/dataset/pivot:
 *   get:
 *     summary: Obtener datos dinámicos tipo pivot del dataset
 *     description: Devuelve información agrupada y filtrada dinámicamente para análisis estadístico y visualización.
 *     tags:
 *       - Dataset
 *     parameters:
 *       - in: query
 *         name: topic
 *         schema:
 *           type: string
 *         required: false
 *         description: Filtrar por temática
 *       - in: query
 *         name: year
 *         schema:
 *           type: number
 *         required: false
 *         description: Filtrar por año
 *       - in: query
 *         name: source
 *         schema:
 *           type: string
 *         required: false
 *         description: Filtrar por fuente documental
 *     responses:
 *       200:
 *         description: Datos pivot obtenidos correctamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 rows:
 *                   type: array
 *                   items:
 *                     type: object
 *                 summary:
 *                   type: object
 */
router.get(
  '/dataset/pivot',
  asyncHandler(async (req, res) => {
    res.json(await loadDatasetPivot(req.query));
  })
);

/**
 * @swagger
 * /api/dataset:
 *   get:
 *     summary: Obtener documentos del dataset
 *     description: Devuelve el listado de documentos del dataset documental con soporte de filtros mediante query params.
 *     tags:
 *       - Dataset
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         required: false
 *         description: Texto de búsqueda general
 *       - in: query
 *         name: topic
 *         schema:
 *           type: string
 *         required: false
 *         description: Filtrar por temática
 *       - in: query
 *         name: year
 *         schema:
 *           type: number
 *         required: false
 *         description: Filtrar por año
 *     responses:
 *       200:
 *         description: Lista de documentos obtenida correctamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: number
 *                         example: 1
 *                       title:
 *                         type: string
 *                         example: Salud mental y bienestar laboral
 *                       author:
 *                         type: string
 *                         example: Organización Internacional del Trabajo
 *                       topic:
 *                         type: string
 *                         example: Riesgos psicosociales
 *                       source_org:
 *                         type: string
 *                         example: ILO
 *                       year:
 *                         type: number
 *                         example: 2025
 *                       document_type:
 *                         type: string
 *                         example: Informe
 *                       source_url:
 *                         type: string
 *                         example: https://example.org/document.pdf
 */
router.get(
  '/dataset',
  asyncHandler(async (req, res) => {
    res.json({ items: await listDatasetDocuments(req.query) });
  })
);

/**
 * @swagger
 * /api/dataset/{id}:
 *   get:
 *     summary: Obtener un documento del dataset por ID
 *     description: Devuelve la información detallada de un documento específico del dataset documental.
 *     tags:
 *       - Dataset
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del documento
 *     responses:
 *       200:
 *         description: Documento obtenido correctamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 item:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: number
 *                       example: 1
 *                     title:
 *                       type: string
 *                       example: Salud ocupacional y teletrabajo
 *                     author:
 *                       type: string
 *                       example: Organización Internacional del Trabajo
 *                     topic:
 *                       type: string
 *                       example: Bienestar laboral
 *                     source_org:
 *                       type: string
 *                       example: ILO
 *                     year:
 *                       type: number
 *                       example: 2025
 *                     document_type:
 *                       type: string
 *                       example: Informe técnico
 *                     source_url:
 *                       type: string
 *                       example: https://example.org/document.pdf
 *       404:
 *         description: Documento no encontrado
 */
router.get(
  '/dataset/:id',
  asyncHandler(async (req, res) => {
    res.json({ item: await getDatasetDocument(req.params.id) });
  })
);

/**
 * @swagger
 * /api/dataset:
 *   post:
 *     summary: Crear un documento en el dataset
 *     description: Permite crear un nuevo documento documental en el dataset del observatorio. Requiere autenticación y permisos de administrador.
 *     tags:
 *       - Dataset
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *             properties:
 *               title:
 *                 type: string
 *                 example: Salud mental en el teletrabajo
 *               author:
 *                 type: string
 *                 example: Organización Internacional del Trabajo
 *               topic:
 *                 type: string
 *                 example: Riesgos psicosociales
 *               source_org:
 *                 type: string
 *                 example: ILO
 *               year:
 *                 type: number
 *                 example: 2025
 *               document_type:
 *                 type: string
 *                 example: Informe
 *               source_url:
 *                 type: string
 *                 example: https://example.org/document.pdf
 *     responses:
 *       201:
 *         description: Documento creado correctamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 item:
 *                   type: object
 *       401:
 *         description: No autenticado
 *       403:
 *         description: Acceso denegado
 */
router.post(
  '/dataset',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.status(201).json({ item: await createDatasetDocument(req.body) });
  })
);

/**
 * @swagger
 * /api/dataset/{id}:
 *   put:
 *     summary: Actualizar un documento del dataset
 *     description: Actualiza la información de un documento existente en el dataset documental. Requiere autenticación y permisos de administrador.
 *     tags:
 *       - Dataset
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del documento a actualizar
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 example: Salud mental y trabajo híbrido
 *               author:
 *                 type: string
 *                 example: Organización Internacional del Trabajo
 *               topic:
 *                 type: string
 *                 example: Bienestar laboral
 *               source_org:
 *                 type: string
 *                 example: ILO
 *               year:
 *                 type: number
 *                 example: 2025
 *               document_type:
 *                 type: string
 *                 example: Informe técnico
 *               source_url:
 *                 type: string
 *                 example: https://example.org/document.pdf
 *     responses:
 *       200:
 *         description: Documento actualizado correctamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 item:
 *                   type: object
 *       401:
 *         description: No autenticado
 *       403:
 *         description: Acceso denegado
 *       404:
 *         description: Documento no encontrado
 */
router.put(
  '/dataset/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json({ item: await updateDatasetDocument(req.params.id, req.body) });
  })
);

/**
 * @swagger
 * /api/dataset/{id}:
 *   delete:
 *     summary: Eliminar un documento del dataset
 *     description: Elimina un documento existente del dataset documental. Requiere autenticación y permisos de administrador.
 *     tags:
 *       - Dataset
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del documento a eliminar
 *     responses:
 *       204:
 *         description: Documento eliminado correctamente
 *       401:
 *         description: No autenticado
 *       403:
 *         description: Acceso denegado
 *       404:
 *         description: Documento no encontrado
 */
router.delete(
  '/dataset/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    await deleteDatasetDocument(req.params.id);
    res.status(204).send();
  })
);

/**
 * @swagger
 * /api/publications:
 *   get:
 *     summary: Obtener publicaciones
 *     description: Devuelve el listado de publicaciones del observatorio con soporte de búsqueda y límite de resultados.
 *     tags:
 *       - Publications
 *     parameters:
 *       - in: query
 *         name: q
 *         required: false
 *         schema:
 *           type: string
 *         description: Texto de búsqueda para filtrar publicaciones
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: number
 *         description: Número máximo de resultados a devolver
 *     responses:
 *       200:
 *         description: Lista de publicaciones obtenida correctamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: number
 *                         example: 1
 *                       title:
 *                         type: string
 *                         example: Salud mental y riesgos psicosociales
 *                       abstract:
 *                         type: string
 *                         example: Estudio sobre bienestar laboral en Iberoamérica.
 *                       authors:
 *                         type: string
 *                         example: Juan Pérez, Ana Gómez
 *                       country:
 *                         type: string
 *                         example: Colombia
 *                       tags:
 *                         type: array
 *                         items:
 *                           type: string
 *                         example:
 *                           - bienestar
 *                           - salud mental
 *                       is_featured:
 *                         type: boolean
 *                         example: true
 *                       published_at:
 *                         type: string
 *                         format: date-time
 *                         example: 2025-05-14T10:00:00Z
 */
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

/**
 * @swagger
 * /api/publications/{id}:
 *   get:
 *     summary: Obtener una publicación por ID
 *     description: Devuelve la información detallada de una publicación específica del observatorio.
 *     tags:
 *       - Publications
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la publicación
 *     responses:
 *       200:
 *         description: Publicación obtenida correctamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 item:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: number
 *                       example: 1
 *                     title:
 *                       type: string
 *                       example: Salud mental en entornos laborales
 *                     abstract:
 *                       type: string
 *                       example: Investigación sobre factores psicosociales en el trabajo.
 *                     authors:
 *                       type: string
 *                       example: Juan Pérez, Ana Gómez
 *                     country:
 *                       type: string
 *                       example: Colombia
 *                     tags:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example:
 *                         - bienestar
 *                         - salud ocupacional
 *                     published_at:
 *                       type: string
 *                       format: date-time
 *                       example: 2025-05-14T10:00:00Z
 *       404:
 *         description: Publicación no encontrada
 */
router.get(
  '/publications/:id',
  asyncHandler(async (req, res) => {
    const result = await query('select * from publications where id = $1', [req.params.id]);
    res.json({ item: result.rows[0] ?? recordNotFound() });
  })
);

/**
 * @swagger
 * /api/publications/{id}/file:
 *   get:
 *     summary: Descargar o visualizar archivo PDF de una publicación
 *     description: Devuelve el archivo PDF asociado a una publicación. Puede visualizarse en el navegador o descargarse según el parámetro mode.
 *     tags:
 *       - Publications
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la publicación
 *       - in: query
 *         name: mode
 *         required: false
 *         schema:
 *           type: string
 *           enum:
 *             - inline
 *             - download
 *         description: Define si el archivo se visualiza en navegador o se descarga.
 *     responses:
 *       200:
 *         description: Archivo PDF obtenido correctamente
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Publicación no encontrada o sin PDF cargado
 */
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

/**
 * @swagger
 * /api/publications:
 *   post:
 *     summary: Crear una publicación
 *     description: Permite crear una nueva publicación y opcionalmente subir un archivo PDF asociado. Requiere autenticación y permisos de administrador.
 *     tags:
 *       - Publications
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *             properties:
 *               title:
 *                 type: string
 *                 example: Riesgos psicosociales en el teletrabajo
 *               abstract:
 *                 type: string
 *                 example: Investigación sobre bienestar laboral y salud mental.
 *               authors:
 *                 type: string
 *                 example: Juan Pérez, Ana Gómez
 *               year:
 *                 type: number
 *                 example: 2025
 *               country:
 *                 type: string
 *                 example: Colombia
 *               tags:
 *                 type: string
 *                 example: salud mental,bienestar,teletrabajo
 *               is_featured:
 *                 type: boolean
 *                 example: true
 *               published_at:
 *                 type: string
 *                 format: date-time
 *                 example: 2025-05-14T10:00:00Z
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Publicación creada correctamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 item:
 *                   type: object
 *       400:
 *         description: Datos inválidos
 *       401:
 *         description: No autenticado
 *       403:
 *         description: Acceso denegado
 */
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

/**
 * @swagger
 * /api/publications/{id}:
 *   put:
 *     summary: Actualizar una publicación
 *     description: Actualiza la información de una publicación existente y opcionalmente reemplaza el archivo PDF asociado. Requiere autenticación y permisos de administrador.
 *     tags:
 *       - Publications
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la publicación a actualizar
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 example: Bienestar laboral y salud ocupacional
 *               abstract:
 *                 type: string
 *                 example: Actualización de estudio sobre salud mental en el trabajo.
 *               authors:
 *                 type: string
 *                 example: Ana Gómez, Carlos Ruiz
 *               year:
 *                 type: number
 *                 example: 2025
 *               country:
 *                 type: string
 *                 example: Colombia
 *               tags:
 *                 type: string
 *                 example: bienestar,salud mental,teletrabajo
 *               is_featured:
 *                 type: boolean
 *                 example: true
 *               published_at:
 *                 type: string
 *                 format: date-time
 *                 example: 2025-05-14T10:00:00Z
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Publicación actualizada correctamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 item:
 *                   type: object
 *       400:
 *         description: No se enviaron campos válidos para actualizar
 *       401:
 *         description: No autenticado
 *       403:
 *         description: Acceso denegado
 *       404:
 *         description: Publicación no encontrada
 */
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

/**
 * @swagger
 * /api/publications/{id}:
 *   delete:
 *     summary: Eliminar una publicación
 *     description: Elimina una publicación existente y su archivo PDF asociado. Requiere autenticación y permisos de administrador.
 *     tags:
 *       - Publications
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la publicación a eliminar
 *     responses:
 *       204:
 *         description: Publicación eliminada correctamente
 *       401:
 *         description: No autenticado
 *       403:
 *         description: Acceso denegado
 *       404:
 *         description: Publicación no encontrada
 */
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
