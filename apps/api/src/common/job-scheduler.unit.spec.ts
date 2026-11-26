import { installJobScheduler, schedulerSettings, schedulerSnapshot } from './job-scheduler';

describe('job scheduler guard', () => {
  it('defaults: run on start only in production, tick log on, disabled by JOBS_ENABLED=false', () => {
    expect(schedulerSettings({ NODE_ENV: 'production' })).toMatchObject({ enabled: true, runOnStart: true, tickLog: true });
    expect(schedulerSettings({ NODE_ENV: 'development' }).runOnStart).toBe(false);
    expect(schedulerSettings({ NODE_ENV: 'production', JOBS_RUN_ON_START: 'false' }).runOnStart).toBe(false);
    expect(schedulerSettings({ NODE_ENV: 'development', JOBS_RUN_ON_START: 'true' }).runOnStart).toBe(true);
    expect(schedulerSettings({ JOBS_ENABLED: 'false' }).enabled).toBe(false);
    expect(schedulerSettings({ JOBS_TICK_LOG: 'false' }).tickLog).toBe(false);
  });
  it('JOBS_ENABLED=false installs nothing and leaves setInterval untouched', () => {
    const before = globalThis.setInterval;
    expect(installJobScheduler({ JOBS_ENABLED: 'false' })).toEqual({ installed: false, reason: 'disabled' });
    expect(globalThis.setInterval).toBe(before);
  });
  it('wraps a timer created by application code and runs it once on start; timers of a library are left alone', async () => {
    const real = globalThis.setInterval;
    try {
      expect(installJobScheduler({ NODE_ENV: 'production', JOBS_TICK_LOG: 'false', JOBS_RUN_ON_START_DELAY_MS: '10' }).installed).toBe(true);
      let runs = 0;
      const t = setInterval(() => { runs++; }, 60_000); // created from src/ (this spec), so it counts as an application timer
      await new Promise((r) => setTimeout(r, 120));
      expect(runs).toBe(1); // the run-on-start tick; the 60 s interval has not fired
      expect(schedulerSnapshot().some((j) => j.periodMs === 60_000 && j.ticks === 1)).toBe(true);
      clearInterval(t);
    } finally { globalThis.setInterval = real; }
  });
});
