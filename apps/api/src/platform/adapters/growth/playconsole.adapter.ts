import { NeedsHumanError } from './types';
import type { RealSpec } from './real-adapter';

/**
 * Play Developer Reporting API and Play Console statistics exports (VERIFY AT BUILD). The installs and listing numbers come from CSV export buckets, whose recorded sample the build agent could not obtain
 * without an account: the request is built, the parse fails closed until `fixtures/playconsole-installs.csv` is recorded (H-9).
 */
export const playConsoleSpec: RealSpec = {
  kind: 'playconsole', api: 'playdeveloperreporting.v1beta1', host: 'playdeveloperreporting.googleapis.com', pulls: ['performance'],
  build: (_r, secret, _w, account) => ({ url: `https://playdeveloperreporting.googleapis.com/v1beta1/apps/${encodeURIComponent(account)}/crashRateMetricSet:query`, method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: '{}' }),
  parse: () => { throw new NeedsHumanError('playconsole', 'response shape not recorded yet (H-9)'); },
};
