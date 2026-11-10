import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { env, validateR2Config } from '../dist/config.js';
import { pool, query } from '../dist/db.js';

// Dry run by default. This tool never changes database references or deletes files.
const apply = process.argv.includes('--apply');
let client;
try {
  if (apply) validateR2Config(env);
  const root = await realpath(resolve(env.localUploadDir));
  if (apply) {
    client = new S3Client({ region: 'auto', endpoint: `https://${env.r2AccountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.r2AccessKeyId, secretAccessKey: env.r2SecretAccessKey } });
  }
  const { rows } = await query('select distinct file_path from publications where file_path is not null');
  let completed = 0;
  let failed = 0;
  for (const { file_path: key } of rows) {
    try {
      const local = await realpath(resolve(root, key));
      if (!local.startsWith(root + sep)) throw new Error('File is outside LOCAL_UPLOAD_DIR');
      const info = await stat(local);
      if (!info.isFile()) throw new Error('Not a regular file');
      if (!apply) { console.log(`[dry run] ${key}: ${info.size} bytes`); continue; }
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(local)) hash.update(chunk);
      const sha256 = hash.digest('hex');
      let existing;
      try { existing = await client.send(new HeadObjectCommand({ Bucket: env.r2Bucket, Key: key })); }
      catch (error) { if (error.$metadata?.httpStatusCode !== 404) throw error; }
      if (existing) {
        if (existing.Metadata?.sha256 !== sha256) throw new Error('Object already exists with a different or unverified checksum; not overwritten');
      } else {
        await client.send(new PutObjectCommand({ Bucket: env.r2Bucket, Key: key, IfNoneMatch: '*', Body: createReadStream(local),
          ContentLength: info.size, ContentType: 'application/pdf', Metadata: { sha256 } }));
      }
      completed++;
      console.log(`[verified/uploaded] ${key}`);
    } catch (error) { failed++; console.error(`[failed] ${key}: ${error.message}`); }
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', references: rows.length, completed, failed }));
  if (failed) process.exitCode = 1;
} catch (error) {
  console.error('Migration could not run:', error.code || error.name);
  process.exitCode = 1;
} finally { client?.destroy(); await pool?.end(); }
