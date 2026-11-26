/**
 * In-process job scheduler guard for a single always-on container (AWS_DEV_ENV_PLAN 3.1 gap 2: there is no /internal/jobs/* trigger endpoint; background work is `setInterval` timers
 * inside the services). The ~45 timers stay where they are; this module wraps `setInterval` ONCE at process start (main.ts only, never in tests) and, for timers created by application
 * code (never a library such as pg or express), adds:
 *   - run on start: a timer of one minute or more is also fired once shortly after boot (staggered), so a deploy or restart never leaves a daily job waiting a full period. Jobs are idempotent
 *     by design (each one is also callable on demand by tests and the ops console).
 *   - tick log: one line per tick of a slow job; a fast poller (outbox, flags) logs its first tick and then one summary line per minute, so the log shows the scheduler is alive without flooding.
 *   - late-tick warning: a tick that arrives more than twice its period late is logged as `LATE` (the sign of CPU throttling or a stalled event loop, e.g. App Runner without always-allocated CPU).
 *   - heartbeat: one `scheduler heartbeat` line per minute with the number of jobs and the event-loop lag.
 * Environment (names only):
 *   JOBS_ENABLED=false         no timer is started by any service (existing switch, unchanged); this module then installs nothing.
 *   JOBS_RUN_ON_START          true|false. Default true in NODE_ENV=production, false elsewhere (local dev stacks keep today's behaviour).
 *   JOBS_TICK_LOG=false        silences tick lines (late-tick warnings and the heartbeat stay).
 *   JOBS_RUN_ON_START_DELAY_MS first run-on-start delay, default 15000; each further job waits an extra 400 ms.
 */
import { Logger } from '@nestjs/common';

type Handler = (...args: unknown[]) => void;
interface JobStat { name: string; periodMs: number; ticks: number; lastAt: number; sinceLog: number; late: number }

const FAST_MS = 60_000;
const log = new Logger('scheduler');
const jobs = new Map<string, JobStat>();
let installed = false;

/** The application file that created the timer, or null when a library did (node_modules, node: internals). */
function appCaller(): string | null {
  const frames = (new Error().stack ?? '').split('\n').slice(3);
  for (const f of frames) {
    if (/job-scheduler\.(?:js|ts)/.test(f)) continue;
    if (f.includes('node_modules') || f.includes('node:')) return null;
    const m = /[\\/](?:dist|src)[\\/]([^\s:)]+?)\.(?:js|ts)/.exec(f);
    return m ? m[1]!.replace(/\\/g, '/') : null;
  }
  return null;
}

export function schedulerSettings(env: NodeJS.ProcessEnv = process.env) {
  const prod = env.NODE_ENV === 'production';
  return {
    enabled: env.JOBS_ENABLED !== 'false',
    runOnStart: env.JOBS_RUN_ON_START === undefined ? prod : env.JOBS_RUN_ON_START === 'true',
    tickLog: env.JOBS_TICK_LOG !== 'false',
    startDelayMs: Math.max(0, Number(env.JOBS_RUN_ON_START_DELAY_MS ?? 15_000) || 15_000),
  };
}

export function installJobScheduler(env: NodeJS.ProcessEnv = process.env): { installed: boolean; reason?: string } {
  const s = schedulerSettings(env);
  if (!s.enabled) { log.log('JOBS_ENABLED=false: no background job runs in this process'); return { installed: false, reason: 'disabled' }; }
  if (installed) return { installed: false, reason: 'already' };
  installed = true;
  const realSetInterval = globalThis.setInterval as unknown as (...a: unknown[]) => NodeJS.Timeout;
  const realSetTimeout = globalThis.setTimeout as unknown as (...a: unknown[]) => NodeJS.Timeout;
  let stagger = 0;

  globalThis.setInterval = ((handler: unknown, delay?: number, ...args: unknown[]) => {
    const where = typeof handler === 'function' && typeof delay === 'number' && delay >= 250 ? appCaller() : null;
    if (!where) return realSetInterval(handler, delay, ...args);
    let name = where; for (let i = 2; jobs.has(name); i++) name = `${where}#${i}`;
    const stat: JobStat = { name, periodMs: delay!, ticks: 0, lastAt: Date.now(), sinceLog: 0, late: 0 };
    jobs.set(name, stat);
    const tick = (origin: 'interval' | 'start') => {
      const now = Date.now();
      if (origin === 'interval' && now - stat.lastAt > stat.periodMs * 2 + 1000) { stat.late++; log.warn(`LATE tick ${name}: ${Math.round((now - stat.lastAt) / 1000)}s since the last one, period ${Math.round(stat.periodMs / 1000)}s (CPU throttled or event loop stalled?)`); }
      stat.lastAt = now; stat.ticks++; stat.sinceLog++;
      if (s.tickLog) {
        if (stat.periodMs >= FAST_MS || stat.ticks === 1) log.log(`tick ${name} (${origin}, every ${Math.round(stat.periodMs / 1000)}s, #${stat.ticks})`);
      }
      (handler as Handler)(...args);
    };
    const timer = realSetInterval(() => tick('interval'), delay, ...args);
    if (s.runOnStart && stat.periodMs >= FAST_MS) {
      const t = realSetTimeout(() => { try { tick('start'); } catch (e) { log.warn(`run-on-start ${name} failed: ${(e as Error).message}`); } }, s.startDelayMs + 400 * stagger++);
      t.unref?.();
    }
    return timer;
  }) as unknown as typeof setInterval;

  // heartbeat and per-minute summary of the fast pollers; also measures event-loop lag (a throttled container shows it here first)
  let expected = Date.now() + 60_000;
  const hb = realSetInterval(() => {
    const now = Date.now(); const lagMs = Math.max(0, now - expected); expected = now + 60_000;
    const fast = [...jobs.values()].filter((j) => j.periodMs < FAST_MS && j.sinceLog > 0);
    const summary = fast.map((j) => `${j.name}=${j.sinceLog}`).join(' '); for (const j of fast) j.sinceLog = 0;
    const late = [...jobs.values()].reduce((a, j) => a + j.late, 0);
    log.log(`heartbeat: ${jobs.size} timers, loop lag ${lagMs}ms, late ticks so far ${late}${s.tickLog && summary ? `; fast ticks last minute: ${summary}` : ''}`);
    expected = Date.now() + 60_000;
  }, 60_000);
  hb.unref?.();
  log.log(`job scheduler installed: run-on-start ${s.runOnStart ? `on (first after ${s.startDelayMs} ms)` : 'off'}, tick log ${s.tickLog ? 'on' : 'off'}`);
  return { installed: true };
}

export const schedulerSnapshot = () => [...jobs.values()].map((j) => ({ name: j.name, periodMs: j.periodMs, ticks: j.ticks, late: j.late }));
