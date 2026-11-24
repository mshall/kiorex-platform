import { NeedsHumanError } from './types';
import type { RealSpec } from './real-adapter';

/** App Store Connect API analytics reports (VERIFY AT BUILD). Reports are gzip CSV segments behind a JWT; the parse fails closed until a sample is recorded (H-9). */
export const appStoreConnectSpec: RealSpec = {
  kind: 'appstoreconnect', api: 'analyticsReportRequests', host: 'api.appstoreconnect.apple.com', pulls: ['performance'],
  build: (_r, secret, _w, account) => ({ url: `https://api.appstoreconnect.apple.com/v1/apps/${encodeURIComponent(account)}/analyticsReportRequests`, method: 'GET', headers: { authorization: `Bearer ${secret}` } }),
  parse: () => { throw new NeedsHumanError('appstoreconnect', 'response shape not recorded yet (H-9)'); },
};
