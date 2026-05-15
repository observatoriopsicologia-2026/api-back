import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { env } from './config.js';
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
  private localDir = resolve(process.cwd(), env.localUploadDir);

  constructor(client?: SupabaseClient) {
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

    if (env.storageDriver === 'supabase') {
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

    if (env.storageDriver === 'supabase') {
      await this.supabase!.storage.from(env.supabasePublicationBucket).remove([path]);
      return;
    }

    await rm(join(this.localDir, path), { force: true });
  }
}

export const publicationStorage = new PublicationStorage();

export function safeDownloadName(value?: string | null) {
  const name = basename(value || 'publicacion.pdf').replace(/"/g, '');
  return name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`;
}

