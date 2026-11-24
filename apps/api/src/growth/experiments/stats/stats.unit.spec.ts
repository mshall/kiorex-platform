import { erfc, normCdf, normInv, normSf, chiSquareSf, lnGamma } from './normal';
import { holm, newcombeDiff, twoProportion, wilson } from './fixed-horizon';
import { daysNeeded, sampleSizePerArm } from './power';
import { srm } from './srm';
import { msprtSeries, msprtStep } from './msprt';
import { evaluateGuardrail } from './guardrails';

/** Reference values are hand-computed or classic published constants; tolerances are stated per assertion. */
describe('normal and gamma helpers', () => {
  it('CDF, survival and quantile match the classic table values', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 12);
    expect(normCdf(1.96)).toBeCloseTo(0.9750021048517795, 9);
    expect(normCdf(-3)).toBeCloseTo(0.0013498980316301, 10);
    expect(normSf(3.5)).toBeCloseTo(2.3262907903552504e-4, 12);
    expect(normSf(5)).toBeCloseTo(2.866515718791939e-7, 14);
    expect(erfc(0.5)).toBeCloseTo(0.4795001221869535, 12);
    expect(normInv(0.975)).toBeCloseTo(1.959963984540054, 8);
    expect(normInv(0.8)).toBeCloseTo(0.8416212335729143, 8);
    expect(normInv(0.001)).toBeCloseTo(-3.090232306167813, 7);
    expect(normCdf(normInv(0.3))).toBeCloseTo(0.3, 12);
  });
  it('chi-square survival function and ln gamma', () => {
    expect(chiSquareSf(3.841458820694124, 1)).toBeCloseTo(0.05, 8);
    expect(chiSquareSf(10.827566170662733, 1)).toBeCloseTo(0.001, 8);
    expect(chiSquareSf(5.991464547107979, 2)).toBeCloseTo(0.05, 8);
    expect(chiSquareSf(16.918977604620448, 9)).toBeCloseTo(0.05, 8);
    expect(lnGamma(5)).toBeCloseTo(Math.log(24), 10);
    expect(lnGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 10);
  });
});

describe('fixed horizon', () => {
  it('Wilson interval of 10 of 100 (hand value 0.0552 to 0.1744)', () => {
    const w = wilson(10, 100);
    expect(w.low).toBeCloseTo(0.05522, 4); expect(w.high).toBeCloseTo(0.17437, 4);
  });
  it('two-proportion z-test 120/1000 vs 100/1000: z = 1.4213, p = 0.1552 (hand computed: pooled 0.11, se 0.013996)', () => {
    const r = twoProportion({ n: 1000, x: 120 }, { n: 1000, x: 100 });
    expect(r.z).toBeCloseTo(1.4289, 3);
    expect(r.pValue).toBeCloseTo(0.1530, 3);
    expect(r.diff).toBeCloseTo(0.02, 12); expect(r.relativeLift).toBeCloseTo(0.2, 12);
    expect(r.ci.low).toBeLessThan(0.02); expect(r.ci.high).toBeGreaterThan(0.02); expect(r.ci.low).toBeLessThan(0);
  });
  it('an unmistakable effect: 150/1000 vs 100/1000 has p < 0.001 and a positive interval', () => {
    const r = twoProportion({ n: 1000, x: 150 }, { n: 1000, x: 100 });
    expect(r.pValue).toBeLessThan(0.001); expect(r.ci.low).toBeGreaterThan(0);
  });
  it('identical arms give z = 0, p = 1; zero events in both arms do not divide by zero', () => {
    expect(twoProportion({ n: 500, x: 50 }, { n: 500, x: 50 }).pValue).toBe(1);
    expect(twoProportion({ n: 500, x: 0 }, { n: 500, x: 0 }).pValue).toBe(1);
    expect(newcombeDiff({ n: 500, x: 0 }, { n: 500, x: 0 }).low).toBeLessThan(0);
  });
  it('Holm: [0.01, 0.04, 0.03] -> [0.03, 0.06, 0.06] (hand computed)', () => {
    const a = holm([0.01, 0.04, 0.03]);
    expect(a[0]).toBeCloseTo(0.03, 12); expect(a[1]).toBeCloseTo(0.06, 12); expect(a[2]).toBeCloseTo(0.06, 12);
    expect(holm([0.5, 0.9]).every((p) => p <= 1)).toBe(true);
  });
});

describe('power', () => {
  it('10% to 12%, alpha 0.05, power 0.8 needs about 3,841 per arm', () => {
    const n = sampleSizePerArm({ baseline: 0.1, mde: 0.02 });
    expect(Math.abs(n - 3841)).toBeLessThanOrEqual(8);
  });
  it('a larger effect needs fewer units; a smaller alpha needs more; days follow the daily rate', () => {
    expect(sampleSizePerArm({ baseline: 0.1, mde: 0.05 })).toBeLessThan(sampleSizePerArm({ baseline: 0.1, mde: 0.02 }));
    expect(sampleSizePerArm({ baseline: 0.1, mde: 0.02, alpha: 0.01 })).toBeGreaterThan(sampleSizePerArm({ baseline: 0.1, mde: 0.02 }));
    expect(daysNeeded(3841, 2, 1000)).toBe(8);
    expect(() => sampleSizePerArm({ baseline: 0.1, mde: 0 })).toThrow();
  });
});

describe('SRM', () => {
  it('a clean 50/50 split of 10,000 (5,030 / 4,970) is not flagged: chi2 0.36, p 0.549', () => {
    const r = srm([5030, 4970], [5000, 5000]);
    expect(r.chi2).toBeCloseTo(0.36, 6); expect(r.pValue).toBeCloseTo(0.5485, 3); expect(r.detected).toBe(false);
  });
  it('5,200 / 4,800 is flagged: chi2 16, p 6.3e-5', () => {
    const r = srm([5200, 4800], [5000, 5000]);
    expect(r.chi2).toBeCloseTo(16, 6); expect(r.pValue).toBeCloseTo(6.334e-5, 7); expect(r.detected).toBe(true);
  });
  it('unequal weights and three arms; empty input is not a mismatch', () => {
    expect(srm([700, 300], [7000, 3000]).detected).toBe(false);
    expect(srm([3400, 3300, 3300], [3334, 3333, 3333]).detected).toBe(false);
    expect(srm([0, 0], [5000, 5000]).detected).toBe(false);
    expect(() => srm([1], [10000])).toThrow();
  });
});

describe('mSPRT', () => {
  it('hand value: V=1, tau2=1, theta=2 -> lambda = sqrt(1/2) e = 1.9221, p = 0.5202', () => {
    const s = msprtStep(1, { theta: 2, variance: 1, tau2: 1 });
    expect(s.lambda).toBeCloseTo(1.92211, 4); expect(s.pAlwaysValid).toBeCloseTo(0.52025, 4);
  });
  it('the p-value never rises (running minimum) and stays 1 when there is no effect', () => {
    const hist = [100, 200, 300, 400].map((n) => ({ t: { n, x: n / 10 }, c: { n, x: n / 10 } }));
    expect(msprtSeries(hist).every((p) => p > 0.5)).toBe(true);
    const eff = [200, 400, 600, 800, 1000].map((n) => ({ t: { n, x: Math.round(n * 0.16) }, c: { n, x: Math.round(n * 0.1) } }));
    const ps = msprtSeries(eff);
    for (let i = 1; i < ps.length; i++) expect(ps[i]!).toBeLessThanOrEqual(ps[i - 1]!);
    expect(ps[ps.length - 1]!).toBeLessThan(0.05);
  });
  it('type I error of the always-valid test on 400 seeded A/A runs with 20 looks stays below 5% (mulberry32, deterministic)', () => {
    let seed = 12345; const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    let rej = 0;
    for (let run = 0; run < 400; run++) {
      let tx = 0, cx = 0, n = 0; const hist: { t: { n: number; x: number }; c: { n: number; x: number } }[] = [];
      for (let look = 0; look < 20; look++) { for (let i = 0; i < 100; i++) { n++; if (rnd() < 0.1) tx++; if (rnd() < 0.1) cx++; } hist.push({ t: { n, x: tx }, c: { n, x: cx } }); }
      if (msprtSeries(hist).at(-1)! < 0.05) rej++;
    }
    expect(rej / 400).toBeLessThanOrEqual(0.05);
  });
});

describe('guardrails (non-inferiority)', () => {
  const hist = (rt: number, rc: number) => [500, 1000, 2000, 4000].map((n) => ({ t: { n, x: Math.round(n * rt) }, c: { n, x: Math.round(n * rc) } }));
  it('a harmful variant (opt-out 8% vs 3%, margin 1 point) breaches within the data', () => {
    const v = evaluateGuardrail({ metric: 'message_opt_out', marginAbs: 0.01, history: hist(0.08, 0.03) }, 0.05, 20);
    expect(v.breach).toBe(true); expect(v.observedDiff).toBeCloseTo(0.05, 3);
  });
  it('a rise inside the margin (3.4% vs 3%, margin 1 point) is not a breach; neither is noise with few events', () => {
    expect(evaluateGuardrail({ metric: 'm', marginAbs: 0.01, history: hist(0.034, 0.03) }, 0.05, 20).breach).toBe(false);
    expect(evaluateGuardrail({ metric: 'm', marginAbs: 0.001, history: [{ t: { n: 50, x: 3 }, c: { n: 50, x: 0 } }] }, 0.05, 20).breach).toBe(false);
    expect(evaluateGuardrail({ metric: 'm', marginAbs: 0.01, history: [] }, 0.05, 20).breach).toBe(false);
  });
});
