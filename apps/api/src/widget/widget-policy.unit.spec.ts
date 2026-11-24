import { GROWTH_DEFAULT_PAYLOADS } from '../growth/config/growth-defaults';
import { WIDGET_POLICY_DEFAULT } from './widget-policy.service';

describe('WIDGET_POLICY fallback', () => {
  it('equals the growth config PROPOSED_DEFAULT (the widget module reads the table directly, so the copy must not drift)', () => {
    expect(WIDGET_POLICY_DEFAULT).toEqual((GROWTH_DEFAULT_PAYLOADS as Record<string, unknown>).WIDGET_POLICY);
  });
});
