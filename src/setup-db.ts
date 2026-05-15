import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { query } from './db.js';

const schemaPath = resolve(process.cwd(), 'database/schema.sql');
const schema = await readFile(schemaPath, 'utf8');

await query(schema);

console.info('Base de datos actualizada correctamente.');
