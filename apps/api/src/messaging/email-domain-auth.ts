/**
 * E-mail domain authentication checks (SPF, DKIM, DMARC) against DNS, with an injected resolver so tests and the ops console never need a network.
 * These are the records Gmail / Yahoo / Microsoft require from a bulk sender and that decide whether Kiorex mail lands in the inbox. Nothing here sends mail.
 *   SPF   TXT on the sending domain (and the custom MAIL FROM domain): includes amazonses.com (or the vendor's include) and ends in -all or ~all.
 *   DKIM  3 CNAMEs `<token>._domainkey.<domain>` -> `<token>.dkim.amazonses.com` (SES Easy DKIM); the tokens come from `GET /v2/email/identities/<domain>`.
 *   DMARC TXT on `_dmarc.<domain>`: `v=DMARC1; p=none|quarantine|reject; rua=mailto:...`. Start at p=none with a rua mailbox, move to quarantine then reject after 2 to 4 weeks of clean reports.
 */
export interface DnsResolver { txt(name: string): Promise<string[]>; cname(name: string): Promise<string[]> }
export interface DomainCheck { name: string; ok: boolean; detail: string }

export function parseDmarc(records: string[]): { present: boolean; policy?: string; rua?: string; pct?: number } {
  const r = records.map((x) => x.trim()).find((x) => /^v=DMARC1\b/i.test(x));
  if (!r) return { present: false };
  const tag = (k: string) => new RegExp(`(?:^|;)\\s*${k}\\s*=\\s*([^;]+)`, 'i').exec(r)?.[1]?.trim();
  return { present: true, policy: tag('p')?.toLowerCase(), rua: tag('rua'), pct: tag('pct') ? Number(tag('pct')) : undefined };
}
export function parseSpf(records: string[]): { present: boolean; includes: string[]; all?: string; lookups: number } {
  const r = records.map((x) => x.trim()).find((x) => /^v=spf1\b/i.test(x));
  if (!r) return { present: false, includes: [], lookups: 0 };
  const terms = r.split(/\s+/).slice(1);
  const includes = terms.filter((t) => /^include:/i.test(t)).map((t) => t.slice(8).toLowerCase());
  const lookups = terms.filter((t) => /^(include:|a(:|\/|$)|mx(:|\/|$)|ptr|exists:|redirect=)/i.test(t)).length;
  return { present: true, includes, all: terms.find((t) => /^[-~+?]all$/.test(t)), lookups };
}

export async function checkEmailDomain(domain: string, dns: DnsResolver, o: { dkimTokens?: string[]; spfInclude?: string; mailFromDomain?: string } = {}): Promise<DomainCheck[]> {
  const out: DomainCheck[] = [];
  const safe = async <T>(f: () => Promise<T>, d: T): Promise<T> => { try { return await f(); } catch { return d; } };
  const include = (o.spfInclude ?? 'amazonses.com').toLowerCase();
  const spfName = o.mailFromDomain ?? domain;
  const spf = parseSpf((await safe(() => dns.txt(spfName), [] as string[])).map((x) => x));
  out.push({ name: `SPF (${spfName})`, ok: spf.present && spf.includes.includes(include) && (spf.all === '-all' || spf.all === '~all') && spf.lookups <= 10, detail: !spf.present ? `no v=spf1 TXT record on ${spfName}` : !spf.includes.includes(include) ? `missing include:${include}` : !spf.all || !['-all', '~all'].includes(spf.all) ? 'must end in ~all or -all (never +all or ?all)' : spf.lookups > 10 ? `${spf.lookups} DNS lookups (limit 10)` : `ok (${spf.all})` });
  const dm = parseDmarc(await safe(() => dns.txt(`_dmarc.${domain}`), [] as string[]));
  out.push({ name: `DMARC (_dmarc.${domain})`, ok: dm.present && !!dm.policy && ['none', 'quarantine', 'reject'].includes(dm.policy) && !!dm.rua, detail: !dm.present ? 'no v=DMARC1 TXT record' : !dm.policy ? 'missing p= policy' : !dm.rua ? `policy p=${dm.policy} but no rua= report address (add one before tightening)` : `ok (p=${dm.policy}${dm.policy === 'none' ? ', monitoring only: tighten after clean reports' : ''})` });
  for (const t of o.dkimTokens ?? []) {
    const name = `${t}._domainkey.${domain}`; const c = await safe(() => dns.cname(name), [] as string[]);
    out.push({ name: `DKIM (${t.slice(0, 6)}...)`, ok: c.some((x) => x.replace(/\.$/, '').toLowerCase() === `${t}.dkim.amazonses.com`), detail: c.length ? (c.some((x) => x.replace(/\.$/, '').toLowerCase() === `${t}.dkim.amazonses.com`) ? 'ok' : `CNAME points to ${c[0]}, expected ${t}.dkim.amazonses.com`) : `no CNAME at ${name}` });
  }
  if (!o.dkimTokens?.length) out.push({ name: 'DKIM', ok: false, detail: 'DKIM tokens unknown: run the SES connection check first (it reads them from the identity) or pass them' });
  return out;
}

/** Node resolver (real DNS). Only used by the ops route; tests inject a fake. */
export async function nodeDns(): Promise<DnsResolver> {
  const dns = await import('node:dns/promises');
  return { txt: async (n) => (await dns.resolveTxt(n)).map((p) => p.join('')), cname: async (n) => dns.resolveCname(n) };
}
