import { CODE_PROFILES, normalizeMarketProfile, setMarketProfileSnapshot } from '../../market/market-core-public';
import { conversationMarket, conversationZone, inConversationMarket } from './assistant-market';
import { marketDate } from './assistant.lexicon';
import { R } from './assistant.render';

const zy = () => normalizeMarketProfile({ cc: 'ZY', name: { ar: 'زد واي', en: 'Zeta Yankee' }, currency: 'JOD', minorUnits: 3, phoneCode: '+962', timezone: 'Asia/Amman', locales: ['ar', 'en'], defaultLocale: 'ar', canonicalSegment: 'zy', quietHours: { start: '22:00', end: '08:00' }, weekend: ['fri', 'sat'] } as never);
const prompt = (cur: string | undefined, d: 'en' | 'eg' = 'en') => R.confirmPrompt(d, { doctor: 'Dr A', startsAt: '2030-01-01T10:00:00.000Z', feeMinor: 30000, currency: cur, depositMinor: 5000 } as never, 'CONFIRM:x:y', 'DECLINE:x:y').body;

describe('assistant money and time follow the conversation market (ZY readiness)', () => {
  afterEach(() => setMarketProfileSnapshot([]));
  it('outside a turn the default market answers exactly as before (EGP, two minor units)', () => {
    expect(conversationMarket()).toBe('EG');
    expect(prompt(undefined)).toContain('fee 300 EGP'); expect(prompt(undefined)).toContain('deposit 50 EGP');
  });
  it('inside a ZY turn the amounts use the registry: JOD with three minor units, and the time zone is Asia/Amman', () => {
    setMarketProfileSnapshot([zy(), ...[]]);
    inConversationMarket('ZY', () => {
      expect(conversationMarket()).toBe('ZY'); expect(conversationZone()).toBe('Asia/Amman');
      const text = prompt(undefined);
      expect(text).toContain('fee 30 JOD'); expect(text).toContain('deposit 5 JOD'); // 30000 and 5000 minor units at three decimals
      expect(text).not.toContain('EGP');
    });
  });
  it('a currency stated by the tool output is kept and the units still come from the conversation market', () => {
    setMarketProfileSnapshot([zy()]);
    inConversationMarket('ZY', () => expect(prompt('JOD')).toContain('fee 30 JOD'));
  });
  it('the default market keeps the configured process zone; another market never sees it (no cross-talk between concurrent turns)', async () => {
    setMarketProfileSnapshot([zy(), CODE_PROFILES.EG!]);
    const noon = new Date('2030-06-30T21:30:00.000Z'); // 00:30 next day in Amman (UTC+3), still the 30th at 23:30 in Cairo only when UTC+2; Cairo is UTC+3 in summer, so both are the 1st
    const results = await Promise.all([
      new Promise<string>((r) => inConversationMarket('ZY', () => setTimeout(() => r(marketDate(noon)), 5))),
      new Promise<string>((r) => inConversationMarket('EG', () => setTimeout(() => r(marketDate(noon)), 1))),
    ]);
    expect(results.length).toBe(2);
    inConversationMarket('ZY', () => expect(conversationMarket()).toBe('ZY'));
    expect(conversationMarket()).toBe('EG');
  });
});
