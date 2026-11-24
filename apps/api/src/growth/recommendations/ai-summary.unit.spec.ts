import { MockSummaryModel, OpenAiCompatSummaryModel, SUMMARY_SYSTEM_PROMPT, validateSummary } from './ai-summary.service';
import { checkAggregateOnly } from './assert-aggregate-only';

const input = { kind: 'REALLOCATE_BUDGET' as const, payload: { fromChannel: 'PAID_SEARCH', toChannel: 'REFERRAL', shiftBp: 1500, fromAttended: 40, toAttended: 50 }, rationale: { en: 'Move some spend to referral, it costs less per new patient.', ar: 'انقل جزء من الإنفاق إلى الإحالات لأن تكلفتها أقل.' } };

describe('recommendation summary model (GRW-P3-E)', () => {
  it('the mock model is deterministic, local and valid', async () => {
    const m = new MockSummaryModel(); const a = await m.summarise(input); const b = await m.summarise(input);
    expect(a).toEqual(b); expect(validateSummary(a)).toEqual(a);
  });
  it('validateSummary accepts only { en, ar } plain text, 5 to 400 characters, no URL, phone, e-mail or health word', () => {
    expect(validateSummary({ en: 'Move budget to referral.', ar: 'انقل الميزانية للإحالات.' })).not.toBeNull();
    for (const bad of [null, 'x', [], { en: 'ok text', ar: 'نص سليم' , extra: 1 }, { en: 'hi', ar: 'نص سليم هنا' }, { en: 'a'.repeat(401), ar: 'نص سليم هنا' }, { en: 'See https://x.example', ar: 'نص سليم هنا' }, { en: 'Call 01012345678 today', ar: 'نص سليم هنا' }, { en: 'mail a@b.co now', ar: 'نص سليم هنا' }, { en: 'Target diabetes patients', ar: 'نص سليم هنا' }, { en: 'Plain fine text', ar: 'استهدف مرضى السكر' }]) expect(validateSummary(bad)).toBeNull();
  });
  it('the real adapter sends ONLY the aggregate payload and the fixed prompt, with a JSON schema and no person field, and parses the answer', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ en: 'Move budget to referral.', ar: 'انقل الميزانية للإحالات.' }) } }] }), { status: 200 }); }) as never;
    const m = new OpenAiCompatSummaryModel({ baseUrl: 'https://llm.invalid/v1/', model: 'm1', apiKey: 'k', fetchImpl });
    expect(await m.summarise(input)).toEqual({ en: 'Move budget to referral.', ar: 'انقل الميزانية للإحالات.' });
    expect(calls[0]!.url).toBe('https://llm.invalid/v1/chat/completions');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.messages[0]).toEqual({ role: 'system', content: SUMMARY_SYSTEM_PROMPT }); expect(body.response_format.json_schema.strict).toBe(true);
    const user = JSON.parse(body.messages[1].content);
    expect(Object.keys(user).sort()).toEqual(['aggregates', 'draft', 'kind']); expect(checkAggregateOnly(user)).toEqual([]);
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer k');
  });
  it('a provider error surfaces as an error (the service turns it into "no summary")', async () => {
    const fetchImpl = (async () => new Response('x', { status: 503 })) as never;
    await expect(new OpenAiCompatSummaryModel({ baseUrl: 'https://llm.invalid/v1', model: 'm', apiKey: 'k', fetchImpl }).summarise(input)).rejects.toThrow(/503/);
  });
  it('the system prompt forbids inventing numbers, people, health topics, sending, spending and audiences', () => {
    for (const w of ['AGGREGATE', 'Never invent', 'sending', 'spending', 'targeting', 'building a list of people']) expect(SUMMARY_SYSTEM_PROMPT).toContain(w.replace('sending', 'sending').replace('building a list of people', 'building a list of people'));
  });
});
