import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { cfg } from '../common/config';
import { decryptBytes, encryptBytes } from '../common/crypto';

/** Object storage behind an adapter (KX-10). Bytes are AES-256-GCM encrypted BEFORE they reach any adapter. */
export interface StorageAdapter {
  readonly mode: 'local' | 's3';
  put(key: string, plain: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

/** STORAGE_MODE=local (default): files under STORAGE_LOCAL_DIR (git-ignored .data/). */
export class LocalStorageAdapter implements StorageAdapter {
  readonly mode = 'local' as const;
  private path(key: string) {
    const root = resolve(cfg().storageLocalDir);
    const p = resolve(root, key);
    if (!p.startsWith(root + sep)) throw new Error('invalid storage key');
    return p;
  }
  async put(key: string, plain: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, encryptBytes(plain));
  }
  async get(key: string) { return decryptBytes(await readFile(this.path(key))); }
  async delete(key: string) { await rm(this.path(key), { force: true }); }
}

/** STORAGE_MODE=s3 placeholder: bucket, KMS key and IAM are NEEDS_HUMAN (KX-21; AWS SDK only under src/platform/adapters). */
export class UnconfiguredStorageAdapter implements StorageAdapter {
  readonly mode = 's3' as const;
  async put(): Promise<never> { throw new Error('NEEDS_HUMAN: object storage (S3 + KMS) not configured'); }
  async get(): Promise<never> { throw new Error('NEEDS_HUMAN: object storage (S3 + KMS) not configured'); }
  async delete(): Promise<never> { throw new Error('NEEDS_HUMAN: object storage (S3 + KMS) not configured'); }
}

export const STORAGE = Symbol('KX_STORAGE');
export const storageAdapter = (): StorageAdapter => (cfg().storageMode === 's3' ? new UnconfiguredStorageAdapter() : new LocalStorageAdapter());
