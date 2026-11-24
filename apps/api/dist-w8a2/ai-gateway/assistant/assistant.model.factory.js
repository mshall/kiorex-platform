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
exports.AssistantModelFactory = void 0;
const common_1 = require("@nestjs/common");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const assistant_growth_bridge_1 = require("./assistant.growth-bridge");
const fixture_model_1 = require("./model/fixture.model");
const fallback_chain_1 = require("./model/fallback.chain");
const mock_model_1 = require("./model/mock.model");
const openai_compat_model_1 = require("./model/openai-compat.model");
let AssistantModelFactory = class AssistantModelFactory {
    flags;
    log = new common_1.Logger('assistant-model-factory');
    override = null;
    chains = new Map();
    constructor(flags) {
        this.flags = flags;
    }
    setOverride(m) { this.override = m; this.chains.clear(); }
    async get(policy, market) {
        let mode = policy.model.mode;
        if (this.override)
            return this.chain('override', [this.override]);
        if (mode === 'real') {
            const flagOn = (await this.flags.evaluate(assistant_growth_bridge_1.ASSISTANT_FLAG.REAL_MODEL, { market })).effective;
            const base = process.env.ASSISTANT_BASE_URL;
            const model = process.env.ASSISTANT_MODEL;
            const key = process.env.ASSISTANT_API_KEY;
            if (!flagOn || !base || !model || !key) {
                this.log.warn('real model requested but a gate is missing: using the mock model');
                mode = 'mock';
            }
            else
                return this.chain(`real:${model}`, [new openai_compat_model_1.OpenAiCompatAssistantModel({ baseUrl: base, model, apiKey: key })]);
        }
        if (mode === 'fixture' && process.env.ASSISTANT_FIXTURE_FILE)
            return this.chain(`fixture:${process.env.ASSISTANT_FIXTURE_FILE}`, [fixture_model_1.FixtureAssistantModel.fromFile(process.env.ASSISTANT_FIXTURE_FILE)]);
        return this.chain('mock', [new mock_model_1.MockAssistantModel()]);
    }
    chain(key, models) {
        let c = this.chains.get(key);
        if (!c) {
            c = new fallback_chain_1.FallbackChain(models);
            this.chains.set(key, c);
        }
        return c;
    }
};
exports.AssistantModelFactory = AssistantModelFactory;
exports.AssistantModelFactory = AssistantModelFactory = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [control_plane_public_1.FlagsService])
], AssistantModelFactory);
//# sourceMappingURL=assistant.model.factory.js.map