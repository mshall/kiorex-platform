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
exports.AiSummaryService = exports.OpenAiCompatSummaryModel = exports.SUMMARY_SYSTEM_PROMPT = exports.SUMMARY_SCHEMA = exports.MockSummaryModel = void 0;
exports.validateSummary = validateSummary;
const common_1 = require("@nestjs/common");
const outbound_http_1 = require("../../common/outbound-http");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const safety_public_1 = require("../../safety/safety-public");
const health_terms_1 = require("../automation/health-terms");
const automation_flags_1 = require("../automation/automation-flags");
const assert_aggregate_only_1 = require("./assert-aggregate-only");
class MockSummaryModel {
    name = 'mock';
    mode = 'mock';
    async summarise(i) {
        return { en: `Summary (mock): ${i.rationale.en}`.slice(0, 400), ar: `ملخص (تجريبي): ${i.rationale.ar}`.slice(0, 400) };
    }
}
exports.MockSummaryModel = MockSummaryModel;
exports.SUMMARY_SCHEMA = { type: 'object', additionalProperties: false, required: ['en', 'ar'], properties: { en: { type: 'string', maxLength: 400 }, ar: { type: 'string', maxLength: 400 } } };
exports.SUMMARY_SYSTEM_PROMPT = [
    'You rewrite one marketing-analytics recommendation for an operations team, in English and in Egyptian Arabic.',
    'Input is a JSON object of AGGREGATE numbers only. Use only those numbers. Never invent a figure, a person, a provider or a health topic. Never suggest sending, spending, targeting or building a list of people.',
    'Answer ONLY with JSON {"en": string, "ar": string}, each at most 400 characters, plain text, no URLs.',
].join('\n');
class OpenAiCompatSummaryModel {
    c;
    name;
    mode = 'real';
    constructor(c) {
        this.c = c;
        this.name = `openai-compat:${c.model}`;
    }
    async summarise(i) {
        const f = this.c.fetchImpl ?? outbound_http_1.outboundFetch;
        const res = await f(`${this.c.baseUrl.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.c.apiKey}` }, signal: AbortSignal.timeout(this.c.timeoutMs ?? 8000),
            body: JSON.stringify({ model: this.c.model, temperature: 0, max_tokens: 400, response_format: { type: 'json_schema', json_schema: { name: 'summary', strict: true, schema: exports.SUMMARY_SCHEMA } }, messages: [{ role: 'system', content: exports.SUMMARY_SYSTEM_PROMPT }, { role: 'user', content: JSON.stringify({ kind: i.kind, aggregates: i.payload, draft: i.rationale }) }] }),
        });
        if (!res.ok)
            throw new Error(`model HTTP ${res.status}`);
        const j = (await res.json());
        return JSON.parse(j.choices?.[0]?.message?.content ?? '{}');
    }
}
exports.OpenAiCompatSummaryModel = OpenAiCompatSummaryModel;
function validateSummary(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o))
        return null;
    const r = o;
    if (Object.keys(r).some((k) => k !== 'en' && k !== 'ar'))
        return null;
    for (const k of ['en', 'ar']) {
        const v = r[k];
        if (typeof v !== 'string' || v.length < 5 || v.length > 400 || /https?:\/\/|www\./i.test(v) || (0, health_terms_1.healthWordIn)(v) || (0, safety_public_1.detectPhi)(v).length || (0, assert_aggregate_only_1.checkAggregateOnly)({ [k]: v }).length)
            return null;
    }
    return { en: r.en, ar: r.ar };
}
let AiSummaryService = class AiSummaryService {
    flags;
    log = new common_1.Logger('recommendation-summary');
    override = null;
    constructor(flags) {
        this.flags = flags;
    }
    setOverride(m) { this.override = m; }
    async resolveMode(requested, market) {
        if (requested === 'rules')
            return { mode: 'rules', model: null };
        if (this.override)
            return { mode: this.override.mode, model: this.override };
        if (requested === 'real') {
            const ai = await this.flags.evaluate(automation_flags_1.AI_RECOMMENDATIONS_FLAG, { market }).catch(() => ({ effective: false, reason: 'ERROR' }));
            const real = await this.flags.evaluate('growth.assistant_real_model', { market }).catch(() => ({ effective: false, reason: 'ERROR' }));
            const base = process.env.RECOMMENDATION_MODEL_BASE_URL;
            const model = process.env.RECOMMENDATION_MODEL;
            const key = process.env.RECOMMENDATION_MODEL_API_KEY;
            if (!(ai.effective && ai.reason === 'ON') || !(real.effective && real.reason === 'ON') || !base || !model || !key) {
                this.log.warn('real summary model requested but a gate is missing: using the mock summary');
                return { mode: 'mock', model: new MockSummaryModel() };
            }
            return { mode: 'real', model: new OpenAiCompatSummaryModel({ baseUrl: base, model, apiKey: key }) };
        }
        return { mode: 'mock', model: new MockSummaryModel() };
    }
    async summarise(i, requested, market) {
        const { mode, model } = await this.resolveMode(requested, market);
        if (!model)
            return null;
        (0, assert_aggregate_only_1.assertAggregateOnly)({ kind: i.kind, payload: i.payload });
        try {
            const out = validateSummary(await model.summarise(i));
            if (!out) {
                this.log.warn(`summary from ${model.name} discarded by validation`);
                return null;
            }
            return { ...out, mode, label: 'AI-assisted', model: model.name };
        }
        catch (e) {
            this.log.warn(`summary model failed: ${e.message}`);
            return null;
        }
    }
};
exports.AiSummaryService = AiSummaryService;
exports.AiSummaryService = AiSummaryService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [control_plane_public_1.FlagsService])
], AiSummaryService);
//# sourceMappingURL=ai-summary.service.js.map