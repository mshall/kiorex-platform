import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cfg } from './config';

function key(): Buffer {
  const k = Buffer.from(cfg().fieldKey, 'base64');
  if (k.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY must be 32 bytes (base64)');
  return k;
}

/** AES-256-GCM; output v1.<iv>.<tag>.<ct> (base64url). Used for national ID at rest (KXM-AC-02). */
export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptField(enc: string): string {
  const [v, iv, tag, ct] = enc.split('.');
  if (v !== 'v1') throw new Error('unknown ciphertext version');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

/** Deterministic keyed hash for equality match (Kiorly link rule) without storing plaintext. */
export function blindIndex(value: string): string {
  return createHmac('sha256', key()).update(value.trim()).digest('hex');
}

export const sha256Hex = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** AES-256-GCM for file bytes (vault uploads): iv(12) | tag(16) | ciphertext. */
export function encryptBytes(plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}
export function decryptBytes(enc: Buffer): Buffer {
  const d = createDecipheriv('aes-256-gcm', key(), enc.subarray(0, 12));
  d.setAuthTag(enc.subarray(12, 28));
  return Buffer.concat([d.update(enc.subarray(28)), d.final()]);
}
