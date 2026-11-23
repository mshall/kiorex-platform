import { Logger } from '@nestjs/common';
import { assertProviderConfig, PROVIDER_KINDS, providerEnv, providerProblems, ProviderConfigError } from './env';
import { pushProblems } from './vendors/push';
import { aiProblems, mapsProblems, PSP_VENDOR_MODE, vendorPspProblems, videoProblems } from './problems';

type Env = Record<string, string | undefined>;

/**
 * Startup gate (called from main.ts before the HTTP server starts). Throws ProviderConfigError (variable NAMES only, never values)
 * when any <KIND>_MODE=real is missing its URL / credentials, or when SAFETY_DELIVERY_MODE=real has no SMS provider / on-call phones.
 * Returns a one-line-per-kind summary that is safe to log.
 */
export const pushMode = (env: Env = process.env): 'mock' | 'real' => (env.PUSH_MODE === 'real' || (!env.PUSH_MODE && env.MESSAGING_MODE === 'real') ? 'real' : 'mock');

export interface ProviderStatus { provider: string; mode: 'mock' | 'real'; vendor: string; ready: boolean }
/** Active mode of every provider for /health/ready + /health/providers: no secrets, no values, only mode / vendor / "all required variables present". */
export function providerStatus(env: Env = process.env): ProviderStatus[] {
  const msg = (k: 'SMS' | 'EMAIL' | 'WHATSAPP'): ProviderStatus => { const p = providerEnv(k, env); return { provider: k.toLowerCase(), mode: p.mode, vendor: p.mode === 'real' ? p.provider : 'mock', ready: p.mode === 'mock' || providerProblems(k, env).length === 0 }; };
  const pay = providerEnv('PAYMENT', env);
  const vendorPay = PSP_VENDOR_MODE(env);
  return [
    msg('SMS'), msg('EMAIL'), msg('WHATSAPP'),
    { provider: 'push', mode: pushMode(env), vendor: pushMode(env) === 'real' ? 'fcm+expo' : 'mock', ready: pushMode(env) === 'mock' || pushProblems(env).length === 0 },
    { provider: 'payment', mode: pay.mode, vendor: pay.mode === 'real' ? (vendorPay ? 'vendor' : 'gateway') : 'mock', ready: pay.mode === 'mock' || (vendorPay ? vendorPspProblems(env).length === 0 : providerProblems('PAYMENT', env).length === 0) },
    { provider: 'video', mode: env.VIDEO_MODE === 'real' ? 'real' : 'mock', vendor: env.VIDEO_MODE === 'real' ? 'daily' : 'mock', ready: videoProblems(env).length === 0 },
    { provider: 'maps', mode: env.MAPS_MODE === 'real' ? 'real' : 'mock', vendor: env.MAPS_MODE === 'real' ? 'amazon-location' : 'mock', ready: mapsProblems(env).length === 0 },
    { provider: 'ai', mode: (env.AI_PROVIDER ?? 'fake') === 'fake' ? 'mock' : 'real', vendor: env.AI_PROVIDER ?? 'fake', ready: aiProblems(env).length === 0 },
  ];
}

export function verifyProviderStartup(env: Env = process.env): string[] {
  assertProviderConfig(env);
  const extra = [
    ...(providerEnv('PAYMENT', env).mode === 'real' && PSP_VENDOR_MODE(env) ? vendorPspProblems(env) : []),
    ...(pushMode(env) === 'real' ? pushProblems(env) : []), ...(['mock', 'real', undefined, ''].includes(env.PUSH_MODE) ? [] : ['PUSH_MODE must be mock or real']),
    ...videoProblems(env), ...mapsProblems(env), ...aiProblems(env),
  ];
  if (extra.length) throw new ProviderConfigError(extra);
  if (env.SAFETY_DELIVERY_MODE === 'real') {
    const problems: string[] = [];
    if (providerEnv('SMS', env).mode !== 'real') problems.push('SAFETY_DELIVERY_MODE=real requires SMS_MODE=real');
    if (!(env.SAFETY_ONCALL_PHONES ?? '').trim()) problems.push('SAFETY_ONCALL_PHONES is required when SAFETY_DELIVERY_MODE=real');
    if (problems.length) throw new ProviderConfigError(problems);
  }
  return providerStatus(env).map((s) => `${s.provider}=${s.mode}`);
}

export function logProviderStartup(env: Env = process.env, log = new Logger('providers')): void {
  const summary = verifyProviderStartup(env);
  log.log(`provider modes: ${summary.join(' ')}`);
  if (env.NODE_ENV === 'production') {
    const mocked = providerStatus(env).filter((s) => s.mode === 'mock').map((s) => s.provider);
    if (mocked.length) log.warn(`NODE_ENV=production but ${mocked.join(', ')} still run in MOCK mode (no real delivery / payments). Set <KIND>_MODE=real plus API_URL/API_KEY/SENDER_ID/WEBHOOK_SECRET to go live.`);
  }
}
