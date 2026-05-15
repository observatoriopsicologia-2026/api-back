import { query } from './db.js';
import { HttpError } from './http.js';

export interface MetricPoint {
  label: string;
  value: number;
}

export interface DatasetSummaryRow {
  documents: number | string;
  visible_documents: number | string;
  topics: number | string;
  sources: number | string;
  years: number | string;
}

export interface DatasetDocumentRow {
  id: string;
  title: string;
  author: string;
  publication_date: string | null;
  year: number | null;
  language: string[];
  document_type: string;
  source_org: string;
  topic: string;
  batch: string;
  source_url: string;
  local_file: string;
  extracted_text: string;
  manual_notes: string;
  is_visible: boolean;
}

export interface DatasetAnalyticsData {
  generated_at: string;
  summary: {
    documents: number;
    visible_documents: number;
    topics: number;
    sources: number;
    years: number;
  };
  documents_by_topic: MetricPoint[];
  documents_by_source: MetricPoint[];
  documents_by_year: MetricPoint[];
  documents_by_language: MetricPoint[];
  documents_by_type: MetricPoint[];
  latest_documents: DatasetDocumentRow[];
}

export interface DatasetPivotResponse {
  row_dimension: DatasetDimensionKey;
  column_dimension: DatasetDimensionKey;
  columns: string[];
  rows: Array<{
    label: string;
    total: number;
    values: Record<string, number>;
  }>;
}

export type DatasetDimensionKey = 'topic' | 'source_org' | 'year' | 'document_type' | 'batch';

const datasetDimensions: Record<DatasetDimensionKey, string> = {
  topic: 'topic',
  source_org: 'source_org',
  year: 'year::text',
  document_type: 'document_type',
  batch: 'batch'
};

const datasetFields = [
  'title',
  'author',
  'publication_date',
  'year',
  'language',
  'document_type',
  'source_org',
  'topic',
  'batch',
  'source_url',
  'local_file',
  'extracted_text',
  'manual_notes',
  'is_visible'
];

function toNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullable(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return value;
}

function parseBoolean(value: unknown) {
  return value === true || value === 'true' || value === '1' || value === 'on' || value === 1;
}

function parseStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(/[;,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function toInteger(value: unknown) {
  const clean = nullable(value);
  if (clean === null) {
    return null;
  }
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDatasetField(field: string, value: unknown) {
  if (field === 'publication_date') {
    return nullable(value);
  }
  if (field === 'year') {
    return toInteger(value);
  }
  if (field === 'language') {
    return parseStringArray(value);
  }
  if (field === 'is_visible') {
    return parseBoolean(value);
  }
  return value ?? '';
}

function pickDatasetPayload(body: Record<string, unknown>, partial = false) {
  const payload: Record<string, unknown> = {};
  for (const field of datasetFields) {
    if (!partial || Object.prototype.hasOwnProperty.call(body, field)) {
      payload[field] = normalizeDatasetField(field, body[field]);
    }
  }
  return payload;
}

function clampLimit(value: unknown) {
  const limit = Number(value ?? 50);
  if (!Number.isFinite(limit)) {
    return 50;
  }
  return Math.min(Math.max(limit, 1), 100);
}

function datasetFilters(reqQuery: Record<string, unknown>) {
  const params: unknown[] = [];
  const filters: string[] = [];
  const q = typeof reqQuery.q === 'string' ? reqQuery.q.trim() : '';
  const topic = typeof reqQuery.topic === 'string' ? reqQuery.topic.trim() : '';

  if (q) {
    params.push(`%${q}%`);
    filters.push(
      `(title ilike $${params.length} or author ilike $${params.length} or source_org ilike $${params.length} or topic ilike $${params.length})`
    );
  }

  if (topic) {
    params.push(topic);
    filters.push(`topic = $${params.length}`);
  }

  return {
    sql: filters.length ? `where ${filters.join(' and ')}` : '',
    params
  };
}

function recordNotFound(): never {
  throw new HttpError(404, 'No se encontro el documento del dataset.');
}

function datasetDimension(value: unknown, fallback: DatasetDimensionKey): DatasetDimensionKey {
  return typeof value === 'string' && value in datasetDimensions ? (value as DatasetDimensionKey) : fallback;
}

export async function listDatasetDocuments(reqQuery: Record<string, unknown>) {
  const filters = datasetFilters(reqQuery);
  const limit = clampLimit(reqQuery.limit);
  const result = await query<DatasetDocumentRow>(
    `select *
     from dataset_documents
     ${filters.sql}
     order by is_visible desc, year desc nulls last, updated_at desc
     limit $${filters.params.length + 1}`,
    [...filters.params, limit]
  );
  return result.rows;
}

export async function getDatasetDocument(id: string) {
  const result = await query<DatasetDocumentRow>('select * from dataset_documents where id = $1', [id]);
  return result.rows[0] ?? recordNotFound();
}

export async function createDatasetDocument(body: Record<string, unknown>) {
  const payload = pickDatasetPayload(body);
  const fields = Object.keys(payload);

  if (!payload.title) {
    throw new HttpError(400, 'El titulo del documento es obligatorio.');
  }

  const placeholders = fields.map((_, index) => `$${index + 1}`);
  const result = await query<DatasetDocumentRow>(
    `insert into dataset_documents (${fields.join(', ')})
     values (${placeholders.join(', ')})
     returning *`,
    fields.map((field) => payload[field])
  );
  return result.rows[0];
}

export async function updateDatasetDocument(id: string, body: Record<string, unknown>) {
  const payload = pickDatasetPayload(body, true);
  const fields = Object.keys(payload);

  if (!fields.length) {
    throw new HttpError(400, 'No se enviaron campos para actualizar.');
  }

  const set = fields.map((field, index) => `${field} = $${index + 1}`);
  const result = await query<DatasetDocumentRow>(
    `update dataset_documents
     set ${set.join(', ')}
     where id = $${fields.length + 1}
     returning *`,
    [...fields.map((field) => payload[field]), id]
  );

  return result.rows[0] ?? recordNotFound();
}

export async function deleteDatasetDocument(id: string) {
  const result = await query('delete from dataset_documents where id = $1', [id]);
  if (!result.rowCount) {
    recordNotFound();
  }
}

export async function loadDatasetPivot(reqQuery: Record<string, unknown>): Promise<DatasetPivotResponse> {
  const rowDimension = datasetDimension(reqQuery.row, 'topic');
  const columnDimension = datasetDimension(reqQuery.column, 'source_org');
  const rowExpression = datasetDimensions[rowDimension];
  const columnExpression = datasetDimensions[columnDimension];
  const result = await query<{ row_label: string; column_label: string; value: number | string }>(
    `select
       coalesce(nullif(trim(${rowExpression}), ''), 'Sin dato') as row_label,
       coalesce(nullif(trim(${columnExpression}), ''), 'Sin dato') as column_label,
       count(*)::int as value
     from dataset_documents
     where is_visible
     group by 1, 2
     order by 1 asc, 2 asc`
  );

  const columns = [...new Set(result.rows.map((row) => row.column_label))];
  const grouped = new Map<string, Record<string, number>>();

  for (const row of result.rows) {
    const values = grouped.get(row.row_label) ?? {};
    values[row.column_label] = toNumber(row.value);
    grouped.set(row.row_label, values);
  }

  return {
    row_dimension: rowDimension,
    column_dimension: columnDimension,
    columns,
    rows: [...grouped.entries()].map(([label, values]) => ({
      label,
      values,
      total: Object.values(values).reduce((sum, value) => sum + value, 0)
    }))
  };
}

export async function listDatasetPowerBiDocuments() {
  const result = await query<{
    title: string;
    author: string;
    publication_date: string | null;
    year: number | null;
    language: string;
    document_type: string;
    source_org: string;
    topic: string;
    batch: string;
    source_url: string;
    local_file: string;
    manual_notes: string;
  }>(
    `select
       title,
       author,
       publication_date,
       year,
       array_to_string(language, ', ') as language,
       document_type,
       source_org,
       topic,
       batch,
       source_url,
       local_file,
       manual_notes
     from dataset_documents
     where is_visible
     order by topic asc, year desc nulls last, title asc`
  );
  return result.rows;
}

async function metricQuery(sql: string, params: unknown[] = []): Promise<MetricPoint[]> {
  const result = await query<{ label: string | null; value: number | string }>(sql, params);
  return result.rows.map((row) => ({
    label: row.label?.trim() || 'Sin dato',
    value: toNumber(row.value)
  }));
}

export async function loadDatasetAnalytics(): Promise<DatasetAnalyticsData> {
  const [
    summaryResult,
    documentsByTopic,
    documentsBySource,
    documentsByYear,
    documentsByLanguage,
    documentsByType,
    latestDocuments
  ] = await Promise.all([
    query<DatasetSummaryRow>(
      `select
        count(*)::int as documents,
        count(*) filter (where is_visible)::int as visible_documents,
        count(distinct nullif(trim(topic), ''))::int as topics,
        count(distinct nullif(trim(source_org), ''))::int as sources,
        count(distinct year)::int as years
       from dataset_documents`
    ),
    metricQuery(
      `select topic as label, count(*)::int as value
       from dataset_documents
       where is_visible and nullif(trim(topic), '') is not null
       group by topic
       order by value desc, label asc
       limit 12`
    ),
    metricQuery(
      `select source_org as label, count(*)::int as value
       from dataset_documents
       where is_visible and nullif(trim(source_org), '') is not null
       group by source_org
       order by value desc, label asc
       limit 8`
    ),
    metricQuery(
      `select year::text as label, count(*)::int as value
       from dataset_documents
       where is_visible and year is not null
       group by year
       order by year`
    ),
    metricQuery(
      `select lang as label, count(*)::int as value
       from dataset_documents, unnest(language) lang
       where is_visible and nullif(trim(lang), '') is not null
       group by lang
       order by value desc, label asc
       limit 10`
    ),
    metricQuery(
      `select document_type as label, count(*)::int as value
       from dataset_documents
       where is_visible
       group by document_type
       order by value desc, label asc
       limit 10`
    ),
    query<DatasetDocumentRow>(
      `select *
       from dataset_documents
       where is_visible
       order by year desc nulls last, updated_at desc
       limit 6`
    )
  ]);

  const summary = summaryResult.rows[0];
  return {
    generated_at: new Date().toISOString(),
    summary: {
      documents: toNumber(summary?.documents),
      visible_documents: toNumber(summary?.visible_documents),
      topics: toNumber(summary?.topics),
      sources: toNumber(summary?.sources),
      years: toNumber(summary?.years)
    },
    documents_by_topic: documentsByTopic,
    documents_by_source: documentsBySource,
    documents_by_year: documentsByYear,
    documents_by_language: documentsByLanguage,
    documents_by_type: documentsByType,
    latest_documents: latestDocuments.rows
  };
}

export function toDatasetPowerBiRows(data: DatasetAnalyticsData) {
  const summaryRows = [
    { label: 'Documentos', value: data.summary.documents },
    { label: 'Documentos visibles', value: data.summary.visible_documents },
    { label: 'Tematicas', value: data.summary.topics },
    { label: 'Fuentes', value: data.summary.sources },
    { label: 'Anos', value: data.summary.years }
  ];

  const sections: Array<[string, MetricPoint[]]> = [
    ['Dataset resumen', summaryRows],
    ['Dataset por tematica', data.documents_by_topic],
    ['Dataset por fuente', data.documents_by_source],
    ['Dataset por ano', data.documents_by_year],
    ['Dataset por idioma', data.documents_by_language],
    ['Dataset por tipo documental', data.documents_by_type]
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
