import { googleAdsSpec } from './googleads.adapter';
import { searchConsoleSpec } from './searchconsole.adapter';
import { ga4Spec } from './ga4.adapter';
import { playConsoleSpec } from './playconsole.adapter';
import { appStoreConnectSpec } from './appstoreconnect.adapter';
import { metaAdsSpec } from './metaads.adapter';
import { tiktokSpec } from './tiktok.adapter';
import { whatsappCloudSpec } from './whatsappcloud.adapter';
import { fcmApnsSpec } from './fcmapns.adapter';
import { cruxSpec } from './crux.adapter';
import { RealAdapter, type RealConfig, type RealSpec } from './real-adapter';
import type { GrowthIntegrationKind } from './types';

export const REAL_SPECS: Record<GrowthIntegrationKind, RealSpec> = {
  googleads: googleAdsSpec, searchconsole: searchConsoleSpec, ga4: ga4Spec, playconsole: playConsoleSpec, appstoreconnect: appStoreConnectSpec,
  metaads: metaAdsSpec, tiktok: tiktokSpec, whatsappcloud: whatsappCloudSpec, fcmapns: fcmApnsSpec, crux: cruxSpec,
};
export const realAdapterFor = (kind: GrowthIntegrationKind, cfg: RealConfig) => new RealAdapter(REAL_SPECS[kind], cfg);
