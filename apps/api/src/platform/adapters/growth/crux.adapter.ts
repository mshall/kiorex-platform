import { num, obj, type RealSpec } from './real-adapter';

const P75 = (m: unknown) => num(obj(obj(m).percentiles).p75);
/** Chrome UX Report API `records:queryRecord` (VERIFY AT BUILD): origin level p75 values of the three Core Web Vitals, stamped with the last day of the range. */
export const cruxSpec: RealSpec = {
  kind: 'crux', api: 'records:queryRecord', host: 'chromeuxreport.googleapis.com', pulls: ['coreVitals'],
  build: (_r, secret, _w, account) => ({ url: `https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${encodeURIComponent(secret)}`, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ origin: account, formFactor: 'PHONE' }) }),
  parse: (json, _w, r) => {
    const m = obj(obj(obj(json).record).metrics);
    return [['lcp_p75', m.largest_contentful_paint], ['inp_p75', m.interaction_to_next_paint], ['cls_p75', m.cumulative_layout_shift]].map(([metric, v]) => ({ day: r.to, dimensionKey: 'template:all', metric: metric as string, value: P75(v) }));
  },
};
