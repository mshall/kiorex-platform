import { arr, num, obj, str, type RealSpec } from './real-adapter';

/** WhatsApp Business Management API conversation analytics (VERIFY AT BUILD): counts and cost by conversation category only, never a number or a conversation id. */
export const whatsappCloudSpec: RealSpec = {
  kind: 'whatsappcloud', api: '{waba}?fields=conversation_analytics', host: 'graph.facebook.com', pulls: ['performance'],
  build: (r, secret, _w, account) => {
    const ts = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 1000);
    return { url: `https://graph.facebook.com/v20.0/${encodeURIComponent(account)}?fields=${encodeURIComponent(`conversation_analytics.start(${ts(r.from)}).end(${ts(r.to) + 86_399}).granularity(DAILY).dimensions(["CONVERSATION_CATEGORY"])`)}`, method: 'GET', headers: { authorization: `Bearer ${secret}` } };
  },
  parse: (json) => {
    const out = [];
    for (const blk of arr(obj(obj(json).conversation_analytics).data ?? [])) for (const dp of arr(obj(blk).data_points ?? [])) {
      const o = obj(dp); const day = new Date(num(o.start) * 1000).toISOString().slice(0, 10); const cat = `category:${str(o.conversation_category).toLowerCase()}`;
      out.push({ day, dimensionKey: cat, metric: 'conversations', value: num(o.conversation) }, { day, dimensionKey: cat, metric: 'cost_micros', value: Math.round(num(o.cost) * 1_000_000) });
    }
    return out;
  },
};
