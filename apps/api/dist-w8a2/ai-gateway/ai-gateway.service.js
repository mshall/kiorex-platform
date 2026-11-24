"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiGatewayService = exports.OpenAiEuProvider = exports.FakeAiProvider = exports.aiProblems = exports.PROMPT_VERSION = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("../common/config");
const problems_1 = require("../common/providers/problems");
const outbound_http_1 = require("../common/outbound-http");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const patient_public_1 = require("../patient/patient-public");
const prisma_service_1 = require("../prisma/prisma.service");
const safety_public_1 = require("../safety/safety-public");
exports.PROMPT_VERSION = 'nav-v1';
exports.aiProblems = problems_1.aiProblems;
class FakeAiProvider {
    name = 'fake';
    async classify(t) { return (0, safety_public_1.mapSymptomToSpecialties)(t).slice(0, 3); }
}
exports.FakeAiProvider = FakeAiProvider;
class OpenAiEuProvider {
    fetchImpl;
    env;
    name = 'openai-eu';
    constructor(fetchImpl = outbound_http_1.outboundFetch, env = process.env) {
        this.fetchImpl = fetchImpl;
        this.env = env;
    }
    async classify(t) {
        const c = { openaiBase: this.env.OPENAI_EU_BASE_URL ?? (0, config_1.cfg)().openaiBase, openaiKey: this.env.OPENAI_EU_API_KEY ?? (0, config_1.cfg)().openaiKey };
        const res = await this.fetchImpl(`${c.openaiBase.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${c.openaiKey}` }, signal: AbortSignal.timeout(10_000),
            body: JSON.stringify({ model: this.env.OPENAI_EU_MODEL || 'gpt-4o-mini', temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: `Map the patient's text to at most 3 medical specialty codes from: ${safety_public_1.SPECIALTY_CODES.join(', ')}. Reply JSON {"specialties":[...]}. Never diagnose.` }, { role: 'user', content: t }] }),
        });
        if (!res.ok)
            throw new Error(`provider HTTP ${res.status}`);
        const j = await res.json();
        const arr = JSON.parse(j.choices?.[0]?.message?.content ?? '{}').specialties ?? [];
        return arr.filter(safety_public_1.isSpecialtyCode).slice(0, 3);
    }
}
exports.OpenAiEuProvider = OpenAiEuProvider;
let AiGatewayService = class AiGatewayService {
    prisma;
    flags;
    patients;
    log = new common_1.Logger('ai-gateway');
    provider = null;
    constructor(prisma, flags, patients) {
        this.prisma = prisma;
        this.flags = flags;
        this.patients = patients;
    }
    setProvider(p) { this.provider = p; }
    prov() { return this.provider ?? ((0, config_1.cfg)().aiProvider === 'openai-eu' ? new OpenAiEuProvider() : new FakeAiProvider()); }
    async navigate(sub, text) {
        const em = (0, safety_public_1.detectEmergency)(text);
        if (em.emergency)
            return { emergency: { ...safety_public_1.EMERGENCY_GUIDANCE, categories: em.categories }, specialties: [], source: 'RULES', ai: false };
        const decision = await this.flags.evaluate('kiorex.ai_navigation', { market: 'EG' });
        let fallbackReason = decision.effective ? undefined : `FLAG_${decision.reason}`;
        if (!fallbackReason && !(await this.patients.hasConsent(sub, 'AI_PROCESSING')))
            fallbackReason = 'NO_AI_CONSENT';
        if (!fallbackReason) {
            const since = new Date(Date.now() - 24 * 3600_000);
            const used = await this.prisma.aiUsage.count({ where: { sub, source: 'AI', createdAt: { gte: since } } });
            if (used >= (0, config_1.cfg)().aiDailyQuota)
                fallbackReason = 'QUOTA_EXCEEDED';
        }
        if (!fallbackReason) {
            const red = (0, safety_public_1.redactPhi)(text);
            const prov = this.prov();
            try {
                const codes = await prov.classify(red.text);
                await this.prisma.aiUsage.create({ data: { sub, purpose: 'symptom_navigation', provider: prov.name, promptVersion: exports.PROMPT_VERSION, redactions: red.count, source: 'AI' } });
                return this.out(codes, 'AI');
            }
            catch (e) {
                this.log.warn(`provider failed, falling back to rules: ${e.message}`);
                fallbackReason = 'PROVIDER_ERROR';
            }
        }
        const codes = (0, safety_public_1.mapSymptomToSpecialties)(text).slice(0, 3);
        await this.prisma.aiUsage.create({ data: { sub, purpose: 'symptom_navigation', provider: 'rules', promptVersion: exports.PROMPT_VERSION, redactions: 0, source: 'RULES' } });
        return { ...this.out(codes, 'RULES'), fallbackReason };
    }
    out(codes, source) {
        return {
            source, ai: source === 'AI', specialties: codes.map((c) => ({ code: c, ...safety_public_1.SPECIALTY_LABELS[c] })),
            ...(source === 'AI' ? { label: { badge: 'AI', copyEn: 'NEEDS_HUMAN_APPROVAL: AI suggestion — review before use. Not medical advice.', copyAr: 'NEEDS_HUMAN_APPROVAL: اقتراح بالذكاء الاصطناعي — راجعه قبل الاستخدام. ليس نصيحة طبية.' } } : {}),
        };
    }
};
exports.AiGatewayService = AiGatewayService;
exports.AiGatewayService = AiGatewayService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, control_plane_public_1.FlagsService, patient_public_1.PatientService])
], AiGatewayService);
//# sourceMappingURL=ai-gateway.service.js.map