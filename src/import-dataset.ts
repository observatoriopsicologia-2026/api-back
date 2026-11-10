import AdmZip from 'adm-zip';
import { query } from './db.js';

interface CsvRow {
  titulo?: string;
  autor?: string;
  fecha?: string;
  idioma?: string;
  tipo_documento?: string;
  url_fuente?: string;
  archivo_local?: string;
  texto_extraido?: string;
}

const zipPath = process.argv.slice(2).join(' ');
const maxTextLength = Number(process.env.DATASET_IMPORT_TEXT_LIMIT ?? 3000);

if (!zipPath) {
  console.error('Uso: npm run dataset:import -- "C:\\ruta\\Dataset Observatorio.zip"');
  process.exit(1);
}

function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(field);
      if (row.some((value) => value.trim() !== '')) {
        rows.push(row);
      }
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((value) => value.trim() !== '')) {
    rows.push(row);
  }

  const headers = rows.shift()?.map((header) => header.trim()) ?? [];
  return rows.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])) as CsvRow
  );
}

function topicFromPath(fullName: string) {
  const parts = fullName.split('/');
  const rawTopic = parts[1] ?? 'Dataset';
  const batch = parts[2] ?? '';
  const sourceOrg = rawTopic.match(/\(([^)]+)\)/)?.[1] ?? '';
  const topic = rawTopic.replace(/\s*\([^)]+\)\s*/g, '').trim();
  return { topic, sourceOrg, batch };
}

function toDate(value?: string) {
  const clean = value?.trim();
  if (!clean) {
    return null;
  }
  if (/^\d{4}$/.test(clean)) {
    return `${clean}-01-01`;
  }
  const date = new Date(clean);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function toYear(value?: string) {
  const clean = value?.trim();
  const match = clean?.match(/\d{4}/);
  return match ? Number(match[0]) : null;
}

function languages(value?: string) {
  return (value ?? '')
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function importRows(rows: CsvRow[], context: { topic: string; sourceOrg: string; batch: string }) {
  let imported = 0;

  for (const row of rows) {
    const title = row.titulo?.trim();
    const localFile = row.archivo_local?.trim();
    if (!title || !localFile) {
      continue;
    }

    await query(
      `insert into dataset_documents (
        title, author, publication_date, year, language, document_type, source_org,
        topic, batch, source_url, local_file, extracted_text, is_visible
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true)
      on conflict (topic, batch, local_file)
      do update set
        title = excluded.title,
        author = excluded.author,
        publication_date = excluded.publication_date,
        year = excluded.year,
        language = excluded.language,
        document_type = excluded.document_type,
        source_org = excluded.source_org,
        source_url = excluded.source_url,
        extracted_text = excluded.extracted_text
      returning id`,
      [
        title,
        row.autor?.trim() ?? '',
        toDate(row.fecha),
        toYear(row.fecha),
        languages(row.idioma),
        row.tipo_documento?.trim() || 'Documento',
        context.sourceOrg,
        context.topic,
        context.batch,
        row.url_fuente?.trim() ?? '',
        localFile,
        (row.texto_extraido ?? '').slice(0, maxTextLength)
      ]
    );
    imported += 1;
  }

  return imported;
}

const zip = new AdmZip(zipPath);
const metadataEntries = zip
  .getEntries()
  .filter((entry) => !entry.isDirectory && entry.entryName.endsWith('/metadata.csv'));

let total = 0;
for (const entry of metadataEntries) {
  const context = topicFromPath(entry.entryName);
  const rows = parseCsv(entry.getData().toString('utf8'));
  const imported = await importRows(rows, context);
  total += imported;
  console.info(`${entry.entryName}: ${imported} documentos importados`);
}

console.info(`Importacion finalizada: ${total} documentos del dataset.`);
