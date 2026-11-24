import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureHasPersonalData, parseJsonl, replay, type FixtureConversation } from '../src/ai-gateway/assistant/assistant-fixture-harness';
import { createCtx, fixture, harnessIo, setupAssistant, TestCtx } from './assistant-helpers';

/** GRW-P2-D: the recorded and hand-written conversations run through the real orchestrator, the mock model and the real BookingService. */
describe('GRW-P2-D assistant fixture conversations', () => {
  let c: TestCtx;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });

  const files = ['booking-en.jsonl', 'booking-ar-eg.jsonl', 'booking-ar-msa.jsonl'];
  for (const f of files) {
    const convs = parseJsonl<FixtureConversation>(fixture(f));
    it.each(convs.map((v) => [v.name, v] as const))(`${f}: %s`, async (_n, conv) => {
      await setupAssistant(c, { locale: conv.locale ?? 'en' });
      const r = await replay(conv, harnessIo(c));
      expect(r.failures).toEqual([]);
    });
  }

  it('no committed fixture carries a phone number, an e-mail address or a name', () => {
    const dir = join(__dirname, 'fixtures', 'assistant');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl') && x !== 'redteam.jsonl')) expect({ f, personal: fixtureHasPersonalData(fixture(f)) }).toEqual({ f, personal: false });
  });
});
