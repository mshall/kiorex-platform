import { sampleLinkBase } from '../../common/hosts';
import { metaTemplateSubmission, type MetaTemplateDefinition } from '../../common/providers/vendors/meta-whatsapp';
import type { WhatsappSettings } from '../messaging-config';

/**
 * Meta WhatsApp template registry. The DEFINITIONS (copy, placeholders, category) are derived from the platform's notification templates (the engagement module
 * hands them over with `load`, this file imports nothing from it); NAMES, categories and per-template switches can be overridden by configuration
 * (MESSAGING_CHANNELS.whatsapp.templates) and by the legacy WHATSAPP_TEMPLATE_MAP env; STATUS and Meta ids live in the WhatsappTemplate table and come from
 * the Meta webhook (message_template_status_update) or the ops sync. Nothing here calls Meta.
 *
 *   Meta name:  kx_<kind lower case>_v1   (lower case letters, digits, underscore; one row per language: Meta approves name + language)
 *   Parameters: {{1}}..{{n}} numbered by first appearance in THAT language's text; the sender maps named placeholders to numbers with `paramOrder`.
 */
export interface NotifySource { templateId: string; en: string; ar: string; reminder?: boolean; marketing?: boolean; promotional?: boolean }
export type WaCategory = 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
export interface WaTemplateDef {
  key: string; templateId: string; language: 'ar' | 'en'; metaName: string; category: WaCategory;
  /** Meta body text with {{1}}..{{n}} */ body: string; paramOrder: string[]; examples: string[];
  quickReplies?: string[]; enabled: boolean;
}
export type WaStatus = 'DRAFT' | 'SUBMITTED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DISABLED' | 'FLAGGED';
export interface WaTemplateStatus { status: WaStatus; metaTemplateId?: string | null; quality?: string | null; reason?: string | null }
export interface WaTemplateStatusStore {
  get(metaName: string, language: string): Promise<WaTemplateStatus | null>;
  /** Applies a review event; returns false when the template is unknown (the event is ignored, never invented). */
  apply(i: { metaName: string; language: string; status?: WaStatus; metaTemplateId?: string; quality?: string; reason?: string; at: Date }): Promise<boolean>;
  upsertDefinition(d: WaTemplateDef, status?: WaStatus): Promise<void>;
}

const EXAMPLES: Record<string, { en: string; ar: string }> = {
  doctor: { en: 'Dr. Sample', ar: 'د. نموذج' }, time: { en: 'Mon 12 Jan 10:00', ar: 'الاثنين 12 يناير 10:00' }, until: { en: '10:30', ar: '10:30' },
  link: { en: `${sampleLinkBase()}/l/sample`, ar: `${sampleLinkBase()}/l/sample` }, amount: { en: 'EGP 150', ar: '150 جنيه' }, patient: { en: 'Sample', ar: 'نموذج' },
  status: { en: 'on the way', ar: 'في الطريق' }, minutes: { en: '15', ar: '15' }, count: { en: '4', ar: '4' }, assignee: { en: 'Sample', ar: 'نموذج' },
  alternatives: { en: `${sampleLinkBase()}/l/sample`, ar: `${sampleLinkBase()}/l/sample` }, org: { en: 'Sample clinic', ar: 'عيادة نموذج' }, kindLabel: { en: 'clinic', ar: 'عيادة' },
};
const placeholders = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
export const metaNameFor = (key: string) => `kx_${key.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}_v1`.slice(0, 512);

/** Template -> Meta definition for one language. Newlines are not allowed in a Meta body parameter, but they are in the body text itself. */
export function buildDef(key: string, t: NotifySource, language: 'ar' | 'en'): WaTemplateDef {
  const text = language === 'en' ? t.en : t.ar;
  const order = placeholders(text);
  const body = text.replace(/\{(\w+)\}/g, (_m, n: string) => `{{${order.indexOf(n) + 1}}}`);
  return {
    key, templateId: t.templateId, language, metaName: metaNameFor(key), body, paramOrder: order,
    examples: order.map((n) => (EXAMPLES[n] ?? { en: 'Sample', ar: 'نموذج' })[language]),
    category: t.marketing || t.promotional ? 'MARKETING' : 'UTILITY', enabled: true,
  };
}

/** The ops "Test send" template (a harmless utility notice to an allow-listed internal number). */
export const MSG_TEST: NotifySource = { templateId: 'MSG_TEST', en: 'Kiorex test message {time} UTC. No action needed.', ar: 'رسالة اختبار من كيوريكس {time} UTC. لا يلزم أي إجراء.' };

export class WaTemplateRegistry {
  private defs: WaTemplateDef[] = [];
  private settings: WhatsappSettings = {};
  constructor(private readonly env: Record<string, string | undefined> = process.env) { this.load({}); }

  /** Replace the source templates (the engagement module calls this once at start). */
  load(src: Record<string, NotifySource>): void {
    this.defs = Object.entries({ ...src, MSG_TEST }).flatMap(([key, t]) => (['ar', 'en'] as const).map((l) => buildDef(key, t, l)));
  }
  /** Apply configuration overrides (config kind MESSAGING_CHANNELS.whatsapp). Cheap; call on every config refresh. */
  configure(settings: WhatsappSettings | undefined): void { this.settings = settings ?? {}; }
  private legacyMap(): Record<string, string> { try { const m = JSON.parse(this.env.WHATSAPP_TEMPLATE_MAP ?? '{}'); return m && typeof m === 'object' ? m : {}; } catch { return {}; } }

  private effective(d: WaTemplateDef): WaTemplateDef {
    const o = this.settings.templates?.[d.key]?.[d.language];
    const legacy = this.legacyMap()[d.templateId];
    return { ...d, ...(legacy && /^[a-z][a-z0-9_]*$/.test(legacy) ? { metaName: legacy } : {}), ...(o?.name ? { metaName: o.name } : {}), ...(o?.category ? { category: o.category } : {}), enabled: o?.enabled !== false };
  }
  /** By Kiorex template id (`TODO_NEEDS_HUMAN_booking_confirmed`) or notification kind (`BOOKING_CONFIRMED`) and language. */
  resolve(idOrKey: string, language: string): WaTemplateDef | null {
    const l = language === 'en' ? 'en' : 'ar';
    const d = this.defs.find((x) => x.language === l && (x.templateId === idOrKey || x.key === idOrKey));
    return d ? this.effective(d) : null;
  }
  list(): WaTemplateDef[] { return this.defs.map((d) => this.effective(d)); }
  get size(): number { return this.defs.length; }

  /** The "submit for approval" export: one Graph payload per template and language (`POST /{waba-id}/message_templates`) plus a table for humans. */
  exportForSubmission(): Array<{ key: string; language: string; metaName: string; category: WaCategory; paramOrder: string[]; submission: ReturnType<typeof metaTemplateSubmission> }> {
    return this.list().filter((d) => d.enabled).map((d) => {
      const def: MetaTemplateDefinition = { name: d.metaName, language: d.language, category: d.category, body: d.body, examples: d.examples, ...(d.quickReplies ? { quickReplies: d.quickReplies } : {}) };
      return { key: d.key, language: d.language, metaName: d.metaName, category: d.category, paramOrder: d.paramOrder, submission: metaTemplateSubmission(def) };
    });
  }
  /** Param values in Meta order, or the first missing placeholder name. */
  static params(def: WaTemplateDef, vars: Record<string, string> | undefined): { values: string[] } | { missing: string } {
    const values: string[] = [];
    for (const n of def.paramOrder) { const v = vars?.[n]; if (v === undefined || v === null || String(v) === '') return { missing: n }; values.push(String(v)); }
    return { values };
  }
}

/** CSV for the ops console / Meta manager upload checklist (name, language, category, status, body). */
export function templatesCsv(rows: Array<{ key: string; language: string; metaName: string; category: string; status?: string; body: string }>): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return ['key,language,metaName,category,status,body', ...rows.map((r) => [r.key, r.language, r.metaName, r.category, r.status ?? 'DRAFT', q(r.body)].join(','))].join('\n');
}
