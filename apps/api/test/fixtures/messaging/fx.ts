import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/**
 * Fixtures of the vendors' webhook and API payloads. HONEST NOTE: they are written from the vendors' published documentation (Meta WhatsApp Cloud API webhooks,
 * Amazon SES event publishing over SNS, Twilio status callbacks, FCM v1, Expo, APNs), NOT recorded from a live account (no credentials exist yet).
 * Replace them with recorded samples at go-live (Docs/INTEGRATION_RUNBOOK_MESSAGING.md, "Record a fixture") and keep the tests: they pin the parser, not the vendor.
 */
export const fxRaw = (name: string): string => readFileSync(join(__dirname, name), 'utf8');
export const fx = <T = any>(name: string): T => JSON.parse(fxRaw(`${name}.json`));
export const fxText = (name: string): string => fxRaw(`${name}.txt`);
