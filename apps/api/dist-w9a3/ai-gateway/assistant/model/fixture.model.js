"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FixtureAssistantModel = exports.FixtureModelMissError = void 0;
exports.parseJsonl = parseJsonl;
const node_fs_1 = require("node:fs");
const safety_public_1 = require("../../../safety/safety-public");
const assistant_model_port_1 = require("../assistant.model.port");
class FixtureModelMissError extends Error {
}
exports.FixtureModelMissError = FixtureModelMissError;
class FixtureAssistantModel {
    name;
    mode = 'fixture';
    index = new Map();
    constructor(lines, name = 'fixture') {
        this.name = name;
        for (const l of lines) {
            const s = (0, assistant_model_port_1.validateModelStep)(l.step);
            if (s)
                this.index.set(this.key(l.text, l.state, l.toolResults), s);
        }
    }
    static fromFile(path) { return new FixtureAssistantModel(parseJsonl((0, node_fs_1.readFileSync)(path, 'utf8')), path); }
    key(text, state, n) { return `${(0, safety_public_1.normalizeText)(text)}|${state}|${n}`; }
    async step(i) {
        const s = this.index.get(this.key(i.text, i.state, i.toolResults.length));
        if (!s)
            throw new FixtureModelMissError('no recorded step for this input');
        return s;
    }
    lastUsage() { return { tokensIn: 0, tokensOut: 0, costMinor: 0 }; }
}
exports.FixtureAssistantModel = FixtureAssistantModel;
function parseJsonl(s) {
    return s.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}
//# sourceMappingURL=fixture.model.js.map