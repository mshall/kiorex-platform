import { Logger } from '@nestjs/common';
import { assertProviderConfig, PROVIDER_KINDS, providerEnv, ProviderConfigError } from './env';

type Env = Record<string, string | undefined>;

/**
 * Startup gate (called from main.ts before the HTTP server starts). Throws ProviderConfigError (variable NAMES only, never values)
 * when any <KIND>_MODE=real is missing its URL / credentials, or when SAFETY_DELIVERY_MODE=real has no SMS provider / on-call phones.
 * Returns a one-line-per-kind summary that is safe to log.
 */
export function verifyProviderStartup(env: Env = process.env): string[] {
  assertProviderConfig(env);
  if (env.SAFETY_DELIVERY_MODE === 'real') {
    const problems: string[] = [];
    if (providerEnv('SMS', env).mode !== 'real') problems.push('SAFETY_DELIVERY_MODE=real requires SMS_MODE=real');
    if (!(env.SAFETY_ONCALL_PHONES ?? '').trim()) problems.push('SAFETY_ONCALL_PHONES is required when SAFETY_DELIVERY_MODE=real');
    if (problems.length) throw new ProviderConfigError(problems);
  }
  return PROVIDER_KINDS.map((k) => `${k}=${providerEnv(k, env).mode}`);
}

export function logProviderStartup(env: Env = process.env, log = new Logger('providers')): void {
  const summary = verifyProviderStartup(env);
  log.log(`provider modes: ${summary.join(' ')}`);
  if (env.NODE_ENV === 'production') {
    const mocked = PROVIDER_KINDS.filter((k) => providerEnv(k, env).mode === 'mock');
    if (mocked.length) log.warn(`NODE_ENV=production but ${mocked.join(', ')} still run in MOCK mode (no real delivery / payments). Set <KIND>_MODE=real plus API_URL/API_KEY/SENDER_ID/WEBHOOK_SECRET to go live.`);
  }
}
