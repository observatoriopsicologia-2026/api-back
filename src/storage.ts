import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { env, validateR2Config } from './config.js';
import { HttpError } from './http.js';

export interface StoredFile {
  path: string;
  originalName: string;
  mimeType: string;
  size: number;
}

export interface DownloadedFile {
  buffer: Buffer;
  contentType: string;
}

const slugify = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);

export class PublicationStorage {
  private supabase?: SupabaseClient;
  private r2?: S3Client;
  private localDir = resolve(process.cwd(), env.localUploadDir);

  constructor(client?: SupabaseClient, r2Client?: S3Client, private readonly signUrl = getSignedUrl) {
    if (!['local', 'supabase', 'r2'].includes(env.storageDriver)) {
      throw new Error('STORAGE_DRIVER must be local, supabase or r2.');
    }
    if (env.storageDriver === 'r2') {
      validateR2Config(env);
      this.r2 = r2Client ?? new S3Client({
        region: 'auto',
        endpoint: `https://${env.r2AccountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: env.r2AccessKeyId!, secretAccessKey: env.r2SecretAccessKey! }
      });
    }
    if (env.storageDriver === 'supabase') {
      if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when STORAGE_DRIVER=supabase.');
      }

      this.supabase =
        client ??
        createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
          auth: { persistSession: false }
        });
    }
  }

  async savePdf(input: { buffer: Buffer; originalName: string; mimeType: string; ownerId: string }): Promise<StoredFile> {
    const safeName = `${Date.now()}-${slugify(input.originalName.replace(/\.pdf$/i, '')) || randomUUID()}.pdf`;
    const storagePath = `${input.ownerId}/${safeName}`;

    if (this.r2) {
      await this.r2.send(new PutObjectCommand({
        Bucket: env.r2Bucket, Key: storagePath, Body: input.buffer, ContentType: 'application/pdf'
      }));
    } else if (env.storageDriver === 'supabase') {
      const { error } = await this.supabase!.storage
        .from(env.supabasePublicationBucket)
        .upload(storagePath, input.buffer, {
          contentType: input.mimeType || 'application/pdf',
          upsert: true
        });

      if (error) {
        throw new HttpError(500, `No se pudo subir el PDF: ${error.message}`);
      }
    } else {
      const targetDir = join(this.localDir, input.ownerId);
      await mkdir(targetDir, { recursive: true });
      await writeFile(join(targetDir, safeName), input.buffer);
    }

    return {
      path: storagePath,
      originalName: input.originalName,
      mimeType: input.mimeType || 'application/pdf',
      size: input.buffer.length
    };
  }

  async download(path: string): Promise<DownloadedFile> {
    if (this.r2) {
      const object = await this.r2.send(new GetObjectCommand({ Bucket: env.r2Bucket, Key: path }));
      if (!object.Body) throw new HttpError(404, 'No se encontro el archivo solicitado.');
      return { buffer: Buffer.from(await object.Body.transformToByteArray()), contentType: object.ContentType || 'application/pdf' };
    }
    if (env.storageDriver === 'supabase') {
      const { data, error } = await this.supabase!.storage.from(env.supabasePublicationBucket).download(path);
      if (error || !data) {
        throw new HttpError(404, 'No se encontró el archivo solicitado.');
      }

      return {
        buffer: Buffer.from(await data.arrayBuffer()),
        contentType: data.type || 'application/pdf'
      };
    }

    const file = await readFile(join(this.localDir, path));
    return {
      buffer: file,
      contentType: 'application/pdf'
    };
  }

  async remove(path?: string | null) {
    if (!path) {
      return;
    }

    if (this.r2) {
      await this.r2.send(new DeleteObjectCommand({ Bucket: env.r2Bucket, Key: path }));
      return;
    }
    if (env.storageDriver === 'supabase') {
      await this.supabase!.storage.from(env.supabasePublicationBucket).remove([path]);
      return;
    }

    await rm(join(this.localDir, path), { force: true });
  }

  async fileUrl(path: string, name: string | null, download: boolean): Promise<string | null> {
    if (!this.r2) return null;
    try {
      await this.r2.send(new HeadObjectCommand({ Bucket: env.r2Bucket, Key: path }));
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
        throw new HttpError(404, 'No se encontro el archivo solicitado.');
      }
      throw error;
    }
    // The browser downloads from R2, not through the API server's memory/bandwidth.
    return this.signUrl(this.r2, new GetObjectCommand({
      Bucket: env.r2Bucket, Key: path, ResponseContentType: 'application/pdf',
      ResponseContentDisposition: pdfDisposition(name, download)
    }), { expiresIn: 300 });
  }
}

export const publicationStorage = new PublicationStorage();

export function safeDownloadName(value?: string | null) {
  const name = basename(value || 'publicacion.pdf').replace(/["\r\n]/g, '');
  return name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`;
}

export function pdfDisposition(value: string | null, download: boolean) {
  const name = safeDownloadName(value);
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/\\/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16)}`);
  return `${download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

