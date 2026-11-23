import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { KiorlyClient } from '../kiorly/kiorly-public';
import type { Entity } from './lib/mapper';

/** Quarantine blob store. Local FS by default; the S3 adapter (SSE, private bucket, lifecycle) is wired in the provider go-live pass (ADR-036 pipeline). */
export interface StagingStore { put(batchId: string, fileId: string, bytes: Buffer): Promise<string>; get(key: string): Promise<Buffer>; deleteBatch(batchId: string): Promise<void> }
export const STAGING_STORE = Symbol('STAGING_STORE');
export const IMPORT_TARGET = Symbol('IMPORT_TARGET');

@Injectable()
export class LocalStagingStore implements StagingStore {
  private root = () => process.env.ONBOARDING_STAGING_DIR ?? '.data/onboarding-staging';
  async put(batchId: string, fileId: string, bytes: Buffer) { const dir = join(this.root(), batchId); await mkdir(dir, { recursive: true }); const key = join(batchId, fileId); await writeFile(join(this.root(), key), bytes, { mode: 0o600 }); return key; }
  async get(key: string) { if (key.includes('..')) throw new Error('bad key'); return readFile(join(this.root(), key)); }
  async deleteBatch(batchId: string) { await rm(join(this.root(), batchId), { recursive: true, force: true }); }
}

export interface CommitItem { idempotencyKey: string; sourceKey: string; data: Record<string, unknown>; file?: { name: string; contentBase64: string } }
export interface CommitArgs { batchId: string; orgId: string; entity: Entity; items: CommitItem[] }
export interface ImportTarget { readonly mode: 'mock' | 'kiorly'; commit(a: CommitArgs): Promise<Array<{ sourceKey: string; targetId: string }>>; rollback(a: { batchId: string; orgId: string }): Promise<{ removed: number }> }

/** Default (MODE=mock): deterministic ids, same code path, nothing leaves the platform. `failAfter` lets tests simulate a crash mid-commit. */
@Injectable()
export class MockImportTarget implements ImportTarget {
  readonly mode = 'mock' as const;
  failAfter: number | null = null; committed = new Map<string, Set<string>>();
  async commit(a: CommitArgs) {
    const set = this.committed.get(a.batchId) ?? new Set<string>(); this.committed.set(a.batchId, set);
    const out: Array<{ sourceKey: string; targetId: string }> = [];
    for (const it of a.items) {
      if (this.failAfter !== null) { if (this.failAfter <= 0) { this.failAfter = null; throw new Error('MOCK_TARGET_UNAVAILABLE'); } this.failAfter--; }
      set.add(it.idempotencyKey);
      out.push({ sourceKey: it.sourceKey, targetId: `mock_${a.entity}_${createHash('sha1').update(it.idempotencyKey).digest('hex').slice(0, 12)}` });
    }
    return out;
  }
  async rollback(a: { batchId: string }) { const n = this.committed.get(a.batchId)?.size ?? 0; this.committed.delete(a.batchId); return { removed: n }; }
}

/** HMAC contract path to Kiorly Clinic (kiorex-contracts: POST /marketplace/v1/imports/{batchId}/records, POST …/rollback). Idempotent per item key. */
@Injectable()
export class KiorlyImportTarget implements ImportTarget {
  readonly mode = 'kiorly' as const;
  constructor(private readonly kiorly: KiorlyClient) {}
  async commit(a: CommitArgs) {
    const r = await this.kiorly.importRecords(a.batchId, { orgId: a.orgId, entity: a.entity, items: a.items });
    return r.data.results;
  }
  async rollback(a: { batchId: string; orgId: string }) { const r = await this.kiorly.importRollback(a.batchId, { orgId: a.orgId }); return { removed: r.data.removed }; }
}
