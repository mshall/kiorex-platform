import { burstPerIpHash, clickWithoutRender, providerLedShareJump } from './touch-rules';

describe('fraud signal rules (pure)', () => {
  it('click without render: provider-owned landing with missing or too short dwell', () => {
    expect(clickWithoutRender({ providerOwned: true, dwellMs: 20 }, 1000)).toMatchObject({ ruleId: 'CLICK_WITHOUT_RENDER' });
    expect(clickWithoutRender({ providerOwned: true }, 1000)).not.toBeNull();
    expect(clickWithoutRender({ providerOwned: true, dwellMs: 1000 }, 1000)).toBeNull();
    expect(clickWithoutRender({ providerOwned: false, dwellMs: 0 }, 1000)).toBeNull();
  });
  it('burst per ip hash fires only above the per-minute limit', () => {
    expect(burstPerIpHash(20, 20)).toBeNull();
    expect(burstPerIpHash(21, 20)).toMatchObject({ ruleId: 'BURST_PER_IP_HASH' });
  });
  it('provider-led share jump needs a sample on both sides and a jump of at least 35 points', () => {
    expect(providerLedShareJump({ recentLed: 9, recentTotal: 10, baselineLed: 6, baselineTotal: 30 })).toMatchObject({ ruleId: 'PROVIDER_LED_SHARE_JUMP' });
    expect(providerLedShareJump({ recentLed: 4, recentTotal: 10, baselineLed: 12, baselineTotal: 30 })).toBeNull();
    expect(providerLedShareJump({ recentLed: 3, recentTotal: 3, baselineLed: 0, baselineTotal: 30 })).toBeNull();
    expect(providerLedShareJump({ recentLed: 10, recentTotal: 10, baselineLed: 0, baselineTotal: 5 })).toBeNull();
  });
});
