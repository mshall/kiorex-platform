import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, JWK } from 'jose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { TOKEN_VERIFIER, JoseTokenVerifier } from '../src/auth/auth-public';
import { FlagsService } from '../src/control-plane/control-plane-public';
import { KiorlyClient } from '../src/kiorly/kiorly-public';
import { CatalogService } from '../src/catalog/catalog-public';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakeKiorly } from './fake-kiorly';
import { signControlPlaneRequest, signWebhook } from '@kiorex/contracts';

let keys: { privateKey: CryptoKey; jwk: JWK } | undefined;
async function getKeys() {
  if (!keys) {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' } as JWK;
    keys = { privateKey: privateKey as CryptoKey, jwk };
  }
  return keys;
}

export const KIORLY_WEBHOOK_SECRET = 'kx_dev_webhook_secret';

export interface TestCtx {
  app: INestApplication; prisma: PrismaService; flags: FlagsService; kiorly: FakeKiorly;
  http: () => ReturnType<typeof request>;
  token(o?: { sub?: string; roles?: string[]; sid?: string; phone?: string; name?: string; aud?: string; iss?: string }): Promise<string>;
  logoutToken(o: { sub?: string; sid?: string; event?: string }): Promise<string>;
  as(sub: string, o?: { sid?: string; roles?: string[] }): Promise<{ Authorization: string }>;
  webhook(type: string, data: Record<string, unknown>, o?: { aggregateId?: string; eventId?: string; aggregateType?: string; badSig?: boolean }): Promise<request.Response>;
  get<T>(c: new (...a: any[]) => T): T;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createCtx(): Promise<TestCtx> {
  const kiorly = await new FakeKiorly().start();
  const { privateKey, jwk } = await getKeys();
  const verifier = new JoseTokenVerifier(createLocalJWKSet({ keys: [jwk] }) as any);
  const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(TOKEN_VERIFIER).useValue(verifier).compile();
  const app = mod.createNestApplication({ rawBody: true, logger: false });
  setupApp(app);
  await app.init();
  const prisma = app.get(PrismaService);
  const flags = app.get(FlagsService);
  const sign = async (claims: Record<string, unknown>, o: { aud?: string; iss?: string; sub?: string }) =>
    new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(o.iss ?? 'http://localhost:4400').setAudience(o.aud ?? 'kiorex-api').setSubject(o.sub ?? 'sub_x').setIssuedAt().setExpirationTime('15m').sign(privateKey);
  const ctx: TestCtx = {
    app, prisma, flags, kiorly,
    http: () => request(app.getHttpServer()),
    token: (o = {}) => sign({ kx_roles: o.roles ?? ['patient'], phone_number: o.phone ?? '+201000000001', name: o.name ?? 'Amira Samy', locale: 'ar', ...(o.sid ? { sid: o.sid } : {}) }, { aud: o.aud, iss: o.iss, sub: o.sub ?? 'sub_amira' }),
    logoutToken: (o) => sign({ events: { 'http://schemas.openid.net/event/backchannel-logout': {} }, ...(o.event ? { event: o.event } : {}), ...(o.sid ? { sid: o.sid } : {}) }, { aud: 'kiorex-api', sub: o.sub }),
    as: async (sub, o = {}) => ({ Authorization: `Bearer ${await ctx.token({ sub, sid: o.sid, roles: o.roles })}` }),
    webhook: async (type, data, o = {}) => {
      const body = JSON.stringify({ eventId: o.eventId ?? `ev_${Math.random().toString(36).slice(2)}`, type, aggregateType: o.aggregateType ?? 'Appointment', aggregateId: o.aggregateId ?? 'apt_1', target: 'KIOREX', occurredAt: new Date().toISOString(), data });
      const s = signWebhook({ secret: o.badSig ? 'wrong' : KIORLY_WEBHOOK_SECRET, body, eventType: type });
      return request(app.getHttpServer()).post('/api/v1/webhooks/kiorly').set({ ...s.headers, 'content-type': 'application/json' }).send(body);
    },
    get: (c) => app.get(c as any),
    reset: async () => {
      kiorly.reset();
      app.get(KiorlyClient).resetCircuit();
      const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
      await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(',')} RESTART IDENTITY CASCADE`);
      await flags.seed();
      kiorly.reset();
    },
    close: async () => { await app.close(); await kiorly.stop(); },
  };
  return ctx;
}

/** HMAC-signed control-plane / product-key request headers. */
export function productHeaders(product: string, path: string, secret = 'ff_dev_secret_change_me', method = 'GET', body?: string) {
  const s = signControlPlaneRequest({ productKey: `ff_${product}_dev`, productSecret: secret, method, path, body });
  return s.headers;
}

export const hmacHex = (secret: string, raw: string) => createHmac('sha256', secret).update(raw).digest('hex');

/** Seed one LIVE provider and register it in Kiorly's fake; returns the provider id. */
export async function seedProvider(ctx: TestCtx, o: Parameters<typeof FakeKiorly.provider>[0] = {}) {
  const dto = FakeKiorly.provider(o);
  ctx.kiorly.providers.push(dto);
  await ctx.get(CatalogService).syncOnce();
  return dto.listingId as string;
}

export const futureSlot = (hours = 48) => {
  const s = new Date(Date.now() + hours * 3600_000);
  s.setUTCMinutes(0, 0, 0);
  return { startsAt: s.toISOString(), endsAt: new Date(s.getTime() + 30 * 60_000).toISOString() };
};
