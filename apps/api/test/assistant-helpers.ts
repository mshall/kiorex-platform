import { createCtx, futureSlot, seedProvider, TestCtx } from './harness';

export const PHONE = '+201000000001';

/** Gate evidence for the launch-locked assistant flag: a TEST FIXTURE (DEV-prefixed gate id), never a real safety review. */
export async function unlockAssistant(c: TestCtx, keys: Array<'kiorex.whatsapp_ai_assistant' | 'growth.assistant_real_model'> = ['kiorex.whatsapp_ai_assistant']) {
  for (const key of keys) await c.prisma.flagGateEvidence.upsert({ where: { flagKey_gateId: { flagKey: key, gateId: 'DEV-TEST-FIXTURE-NOT-A-REAL-GATE' } }, create: { flagKey: key, gateId: 'DEV-TEST-FIXTURE-NOT-A-REAL-GATE', approver: 'test fixture', approvedOn: new Date(), documentUrl: 'https://dev.invalid/fixture', recordedBy: 'TEST_FIXTURE' }, update: {} });
  c.flags.invalidate();
}

/** A seeded database with one dermatology provider, a verified patient with the AI_PROCESSING consent and the assistant unlocked. */
export async function setupAssistant(c: TestCtx, o: { consent?: boolean; profile?: boolean; locale?: 'ar' | 'en' } = {}) {
  await c.reset();
  c.kiorly.slots = [futureSlot(30), futureSlot(31), futureSlot(52), futureSlot(53)];
  await seedProvider(c, { specialty: 'dermatology', fee: 300 });
  await unlockAssistant(c);
  const auth = await c.as('sub_amira'); const admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
  if (o.profile !== false) {
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy', preferredLocale: o.locale ?? 'en' }).expect(200);
    if (o.consent !== false) await c.http().put('/api/v1/me/consents/AI_PROCESSING').set(auth).send({ granted: true }).expect(200);
  }
  return { auth, admin };
}

/** Simulates a patient message (or a button press) on the mock WhatsApp inbox; returns the bodies of what the platform sent back. */
export async function say(c: TestCtx, text: string | undefined, o: { from?: string; button?: string } = {}): Promise<string[]> {
  const r = await c.http().post('/api/v1/dev/messaging/inbound').send({ channel: 'WHATSAPP', from: o.from ?? PHONE, ...(o.button ? { buttonPayload: o.button } : text === undefined ? {} : { text }) }).expect(200);
  return r.body.replies.map((m: any) => m.body as string);
}
export const buttonsOf = (body: string) => Object.fromEntries([...body.matchAll(/^\[([^\]]+)\] ((?:CONFIRM|DECLINE):\S+)$/gm)].map((m) => [m[1], m[2]])) as Record<string, string>;
export { createCtx, futureSlot, seedProvider };
export type { TestCtx };

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HarnessIo } from '../src/ai-gateway/assistant/assistant-fixture-harness';
export const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', 'assistant', name), 'utf8');

/** The harness IO over the dev inbox and the tool-call table. */
export function harnessIo(c: TestCtx, from = PHONE): HarnessIo {
  let seen = 0;
  return {
    send: (m) => say(c, m.text, { from, button: m.button }),
    toolsSinceMark: async () => { const rows = await c.prisma.assistantToolCall.findMany({ orderBy: { createdAt: 'asc' }, select: { tool: true } }); const fresh = rows.slice(seen).map((r) => r.tool); seen = rows.length; return fresh; },
  };
}
