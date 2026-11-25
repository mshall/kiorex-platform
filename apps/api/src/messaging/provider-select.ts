import { NATIVE_VENDORS, providerEnv, providerProblems, type ProviderEnv } from '../common/providers/env';
import { messagingKindOf, type MessagingKind } from '../common/providers/real-adapters';
import { resolveSecretRef, type MessagingChannelsConfig } from './messaging-config';
import type { MsgChannel } from './messaging.types';

type Env = Record<string, string | undefined>;

/**
 * Which provider(s) a channel uses, in order, and with which credentials. MODE (mock|real) is env-only on purpose: configuration can never switch a channel to real.
 * Everything else can come from the MESSAGING_CHANNELS config: the provider order (first = primary), a `secretRefs` path per provider (resolved from the environment
 * the platform injects from Secrets Manager), the sender id and the retry policy. A SECONDARY provider (failover) reads `<KIND>_<PROVIDER>_API_URL`, `_SENDER_ID`
 * and `_WEBHOOK_SECRET` from the environment (the key from its secretRef or `<KIND>_<PROVIDER>_API_KEY`).
 */
export function providerOrder(kind: MessagingKind, cfg: MessagingChannelsConfig, env: Env = process.env): string[] {
  const base = providerEnv(kind, env).provider;
  const configured = cfg.channels?.[kind as MsgChannel]?.providers;
  return configured?.length ? configured : [base];
}

export function providerEnvFor(kind: MessagingKind, provider: string, cfg: MessagingChannelsConfig, env: Env = process.env): ProviderEnv {
  const base = providerEnv(kind, env);
  const ch = cfg.channels?.[kind as MsgChannel];
  const refKey = ch?.secretRefs?.[provider] ?? ch?.secretRefs?.default;
  const fromRef = resolveSecretRef(refKey, env);
  const P = provider.toUpperCase();
  const own = provider === base.provider;
  const native = NATIVE_VENDORS[kind]?.name === provider ? NATIVE_VENDORS[kind] : undefined;
  const apiKey = fromRef ?? (own ? base.apiKey : env[`${kind}_${P}_API_KEY`] ?? '');
  const secondaryUrl = (env[`${kind}_${P}_API_URL`] ?? '').trim().replace(/\/+$/, '');
  return {
    ...base, provider, apiKey,
    apiUrl: own ? base.apiUrl : secondaryUrl || native?.defaultUrl || '',
    senderId: (ch?.senderId || (own ? base.senderId : env[`${kind}_${P}_SENDER_ID`] ?? base.senderId)) ?? '',
    webhookSecret: own ? base.webhookSecret : env[`${kind}_${P}_WEBHOOK_SECRET`] || (base.mode === 'mock' ? base.webhookSecret : native?.secretFromKey && apiKey.includes(':') ? native.secretFromKey(apiKey) : ''),
    publicWebhookUrl: own ? base.publicWebhookUrl : (env[`${kind}_${P}_WEBHOOK_PUBLIC_URL`] ?? '').trim(),
    maxRetries: ch?.retry?.maxRetries ?? base.maxRetries,
  };
}

/** Config problems for one provider of a kind (names only). Re-uses the single-provider validator by presenting the derived env as `<KIND>_*`. */
export function providerProblemsFor(kind: MessagingKind, provider: string, cfg: MessagingChannelsConfig, env: Env = process.env): string[] {
  const e = providerEnvFor(kind, provider, cfg, env);
  const synthetic: Env = { ...env, [`${kind}_MODE`]: e.mode, [`${kind}_PROVIDER`]: e.provider, [`${kind}_API_URL`]: e.apiUrl, [`${kind}_API_KEY`]: e.apiKey, [`${kind}_SENDER_ID`]: e.senderId, [`${kind}_WEBHOOK_SECRET`]: e.webhookSecret, [`${kind}_WEBHOOK_PUBLIC_URL`]: e.publicWebhookUrl };
  const p = providerProblems(kind, synthetic).map((x) => (provider === providerEnv(kind, env).provider ? x : x.replace(new RegExp(`^${kind}_`), `${kind}_${provider.toUpperCase()}_`)));
  return p;
}
export { messagingKindOf };
