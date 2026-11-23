import { Injectable, Logger } from '@nestjs/common';
import { cfg } from '../common/config';
import { aiProblems as _ap } from '../common/providers/problems';
import { outboundFetch } from '../common/outbound-http';
import { FlagsService } from '../control-plane/control-plane-public';
import { PatientService } from '../patient/patient-public';
import { PrismaService } from '../prisma/prisma.service';
import { detectEmergency, EMERGENCY_GUIDANCE, isSpecialtyCode, mapSymptomToSpecialties, redactPhi, SPECIALTY_CODES, SPECIALTY_LABELS, SpecialtyCode } from '../safety/safety-public';

export const PROMPT_VERSION = 'nav-v1';

export interface AiProvider { name: string; classify(redactedText: string): Promise<SpecialtyCode[]> }

export const aiProblems = _ap;

/** Deterministic provider (default locally, AI_PROVIDER=fake). */
export class FakeAiProvider implements AiProvider {
  name = 'fake';
  async classify(t: string) { return mapSymptomToSpecialties(t).slice(0, 3); }
}

/** OpenAI EU endpoint (ADR-016). Needs OPENAI_EU_BASE_URL + key (NEEDS_HUMAN: DPA, key). Output constrained to the specialty enum. */
export class OpenAiEuProvider implements AiProvider {
  name = 'openai-eu';
  constructor(private readonly fetchImpl: typeof outboundFetch = outboundFetch, private readonly env: Record<string, string | undefined> = process.env) {}
  async classify(t: string): Promise<SpecialtyCode[]> {
    const c = { openaiBase: this.env.OPENAI_EU_BASE_URL ?? cfg().openaiBase, openaiKey: this.env.OPENAI_EU_API_KEY ?? cfg().openaiKey };
    const res = await this.fetchImpl(`${c.openaiBase.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${c.openaiKey}` }, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ model: this.env.OPENAI_EU_MODEL || 'gpt-4o-mini', temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: `Map the patient's text to at most 3 medical specialty codes from: ${SPECIALTY_CODES.join(', ')}. Reply JSON {"specialties":[...]}. Never diagnose.` }, { role: 'user', content: t }] }),
    });
    if (!res.ok) throw new Error(`provider HTTP ${res.status}`);
    const j: any = await res.json();
    const arr: string[] = JSON.parse(j.choices?.[0]?.message?.content ?? '{}').specialties ?? [];
    return arr.filter(isSpecialtyCode).slice(0, 3) as SpecialtyCode[];
  }
}

@Injectable()
export class AiGatewayService {
  private readonly log = new Logger('ai-gateway');
  private provider: AiProvider | null = null;
  constructor(private readonly prisma: PrismaService, private readonly flags: FlagsService, private readonly patients: PatientService) {}

  setProvider(p: AiProvider) { this.provider = p; }
  private prov(): AiProvider { return this.provider ?? (cfg().aiProvider === 'openai-eu' ? new OpenAiEuProvider() : new FakeAiProvider()); }

  /**
   * Symptom → specialty navigation. Order is fixed: emergency check (safety control, never flagged) →
   * flag/gate → consent → quota → redaction → provider → audit. When kiorex.ai_navigation is not effective
   * (launch-locked until clinical evaluation gate) the keyword→specialty map answers instead.
   */
  async navigate(sub: string, text: string) {
    const em = detectEmergency(text);
    if (em.emergency) return { emergency: { ...EMERGENCY_GUIDANCE, categories: em.categories }, specialties: [], source: 'RULES' as const, ai: false };
    const decision = await this.flags.evaluate('kiorex.ai_navigation', { market: 'EG' });
    let fallbackReason: string | undefined = decision.effective ? undefined : `FLAG_${decision.reason}`;
    if (!fallbackReason && !(await this.patients.hasConsent(sub, 'AI_PROCESSING'))) fallbackReason = 'NO_AI_CONSENT';
    if (!fallbackReason) {
      const since = new Date(Date.now() - 24 * 3600_000);
      const used = await this.prisma.aiUsage.count({ where: { sub, source: 'AI', createdAt: { gte: since } } });
      if (used >= cfg().aiDailyQuota) fallbackReason = 'QUOTA_EXCEEDED';
    }
    if (!fallbackReason) {
      const red = redactPhi(text);
      const prov = this.prov();
      try {
        const codes = await prov.classify(red.text);
        await this.prisma.aiUsage.create({ data: { sub, purpose: 'symptom_navigation', provider: prov.name, promptVersion: PROMPT_VERSION, redactions: red.count, source: 'AI' } });
        return this.out(codes, 'AI');
      } catch (e) {
        this.log.warn(`provider failed, falling back to rules: ${(e as Error).message}`);
        fallbackReason = 'PROVIDER_ERROR';
      }
    }
    const codes = mapSymptomToSpecialties(text).slice(0, 3);
    await this.prisma.aiUsage.create({ data: { sub, purpose: 'symptom_navigation', provider: 'rules', promptVersion: PROMPT_VERSION, redactions: 0, source: 'RULES' } });
    return { ...this.out(codes, 'RULES'), fallbackReason };
  }

  /** Labelled outputs (KX-11 AI03): the AI badge appears only on model-backed results. */
  private out(codes: SpecialtyCode[], source: 'AI' | 'RULES') {
    return {
      source, ai: source === 'AI', specialties: codes.map((c) => ({ code: c, ...SPECIALTY_LABELS[c] })),
      ...(source === 'AI' ? { label: { badge: 'AI', copyEn: 'NEEDS_HUMAN_APPROVAL: AI suggestion — review before use. Not medical advice.', copyAr: 'NEEDS_HUMAN_APPROVAL: اقتراح بالذكاء الاصطناعي — راجعه قبل الاستخدام. ليس نصيحة طبية.' } } : {}),
    };
  }
}
