import type { CheckContext, CheckResult, PageContent } from '../page-model';
import { canonical } from './canonical';
import { claims } from './claims';
import { hreflang } from './hreflang';
import { orphan } from './orphan';
import { parity } from './parity-ar-en';
import { similarity } from './similarity';
import { structuredData } from './structured-data';
import { thinContent } from './thin-content';
import { titleMeta } from './title-meta';

export const CHECKS: readonly ((p: PageContent, c: CheckContext) => CheckResult[])[] = [thinContent, similarity, parity, titleMeta, structuredData, canonical, hreflang, orphan, claims];
export { canonical, claims, hreflang, orphan, parity, similarity, structuredData, thinContent, titleMeta };
