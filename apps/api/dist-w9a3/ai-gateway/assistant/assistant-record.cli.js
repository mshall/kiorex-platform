"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecordingModel = void 0;
exports.assertRecordingAllowed = assertRecordingAllowed;
exports.main = main;
const node_fs_1 = require("node:fs");
const assistant_safety_1 = require("./assistant.safety");
const openai_compat_model_1 = require("./model/openai-compat.model");
const assistant_model_port_1 = require("./assistant.model.port");
const assistant_policy_1 = require("./assistant.policy");
const assistant_types_1 = require("./assistant.types");
const assistant_lexicon_1 = require("./assistant.lexicon");
function assertRecordingAllowed(env = process.env) {
    if (env.NODE_ENV === 'production')
        throw new Error('assistant-record refuses to run with NODE_ENV=production');
    if (env.ASSISTANT_RECORD !== '1')
        throw new Error('assistant-record needs ASSISTANT_RECORD=1 (development only)');
}
class RecordingModel {
    inner;
    outFile;
    name;
    mode;
    constructor(inner, outFile, env = process.env) {
        this.inner = inner;
        this.outFile = outFile;
        assertRecordingAllowed(env);
        this.name = `recording:${inner.name}`;
        this.mode = inner.mode;
    }
    lastUsage() { return this.inner.lastUsage?.() ?? { tokensIn: 0, tokensOut: 0, costMinor: 0 }; }
    async step(i) {
        const step = await this.inner.step(i);
        const valid = (0, assistant_model_port_1.validateModelStep)(step);
        if (valid) {
            const line = { text: (0, assistant_safety_1.redactForModel)((0, assistant_safety_1.sanitiseInbound)(i.text).text), state: i.state, toolResults: i.toolResults.length, step: valid };
            (0, node_fs_1.appendFileSync)(this.outFile, `${JSON.stringify(line)}\n`);
        }
        return step;
    }
}
exports.RecordingModel = RecordingModel;
async function main(argv, env = process.env) {
    assertRecordingAllowed(env);
    const [promptsFile, outFile] = argv;
    if (!promptsFile || !outFile) {
        console.error('usage: assistant-record.cli <prompts.txt> <out.jsonl>');
        return 2;
    }
    if (!env.ASSISTANT_BASE_URL || !env.ASSISTANT_MODEL || !env.ASSISTANT_API_KEY) {
        console.error('ASSISTANT_BASE_URL, ASSISTANT_MODEL and ASSISTANT_API_KEY are required (NEEDS_HUMAN: vendor account)');
        return 2;
    }
    const model = new RecordingModel(new openai_compat_model_1.OpenAiCompatAssistantModel({ baseUrl: env.ASSISTANT_BASE_URL, model: env.ASSISTANT_MODEL, apiKey: env.ASSISTANT_API_KEY }), outFile, env);
    for (const prompt of (0, node_fs_1.readFileSync)(promptsFile, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)) {
        const text = (0, assistant_safety_1.sanitiseInbound)(prompt).text;
        const allowed = (0, assistant_policy_1.allowedTools)('GREETING', true);
        await model.step({ text, lang: /[؀-ۿ]/.test(text) ? 'ar' : 'en', dialect: 'eg', state: 'GREETING', verified: true, shown: (0, assistant_types_1.emptyContext)().shown, allowedTools: allowed, toolResults: [], today: (0, assistant_lexicon_1.marketDate)(), turn: 0, prompt: { system: openai_compat_model_1.OpenAiCompatAssistantModel.systemPrompt(), user: text } }).catch((e) => console.error(`step failed: ${e.message}`));
    }
    return 0;
}
if (require.main === module)
    void main(process.argv.slice(2)).then((c) => process.exit(c));
//# sourceMappingURL=assistant-record.cli.js.map