import type { MessagingMapping } from './mapping-types';
import { aggregatorBuildSend, aggregatorConfig, aggregatorParseDlr, aggregatorParseSend, aggregatorVerifyDlr } from './vendors/sms-aggregator';

/** SMS_PROVIDER=aggregator: a generic Egyptian SMS aggregator described by data (see vendors/sms-aggregator.ts). */
export const smsAggregatorMapping: MessagingMapping = {
  authHeaders: () => ({}), // the credential placement is part of buildSend (headers / body / query)
  buildSend: (i) => aggregatorBuildSend(aggregatorConfig(), { to: i.to, from: i.senderId, text: i.body, reference: i.reference, apiKey: i.apiKey ?? '', callback: i.publicWebhookUrl }),
  parseSend: (json, reference) => aggregatorParseSend(aggregatorConfig(), json, reference ?? ''),
  parseStatusWebhook: (raw) => aggregatorParseDlr(aggregatorConfig(), raw),
  verifyWebhook: (o) => aggregatorVerifyDlr(aggregatorConfig(), o.secret, o.rawBody, o.headers, o.query),
};
