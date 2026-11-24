export { MarketService } from './market.service';
export { MarketModule } from './market.module';
export { buildAppleAppSiteAssociation, buildAssetLinks, resolveAppLinksConfig, appLinksConfigFromEnv, IOS_APP_LINK_PATHS } from './app-links';
export { chooseMarket, normalizeProviderCode, isRefCode, isSafeSegment, PROVIDER_LINK_CODE_RE, REF_CODE_RE } from './deep-link-rules';
