import type { RealSpec } from './real-adapter';

/** FCM and APNs: delivery health comes from the existing messaging adapters (counts in the platform's own tables). This adapter offers no pull of its own; `health()` checks the secret reference only. */
export const fcmApnsSpec: RealSpec = {
  kind: 'fcmapns', api: 'messaging/adapters.ts', host: 'internal', pulls: [],
  build: () => { throw new Error('fcmapns has no upstream pull'); },
  parse: () => [],
};
