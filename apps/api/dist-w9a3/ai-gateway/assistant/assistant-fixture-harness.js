"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fixtureHasPersonalData = exports.parseJsonl = void 0;
exports.replay = replay;
const parseJsonl = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
exports.parseJsonl = parseJsonl;
const buttonsIn = (bodies) => Object.fromEntries(bodies.flatMap((b) => [...b.matchAll(/^\[([^\]]+)\] ((?:CONFIRM|DECLINE):\S+)$/gm)].map((m) => [m[1], m[2]])));
const SCRUB = [/\+?\d[\d\s-]{8,}\d/, /[\w.+-]+@[\w-]+\.[\w.-]+/];
async function replay(conv, io) {
    const failures = [];
    const transcript = [];
    let last = [];
    await io.toolsSinceMark();
    for (const [i, t] of conv.turns.entries()) {
        const label = `${conv.name}#${i + 1}`;
        let out;
        if (t.button) {
            const id = buttonsIn(last)[t.button];
            if (!id) {
                failures.push(`${label}: no "${t.button}" button in the previous reply`);
                transcript.push({ in: `[${t.button}]`, out: [], tools: [] });
                continue;
            }
            out = await io.send({ button: id });
        }
        else
            out = await io.send({ text: t.in ?? '' });
        const tools = await io.toolsSinceMark();
        transcript.push({ in: t.button ? `[${t.button}]` : t.in ?? '', out, tools });
        const joined = out.join('\n');
        for (const re of t.expectOut ?? [])
            if (!new RegExp(re, 's').test(joined))
                failures.push(`${label}: reply did not match /${re}/`);
        for (const re of t.notOut ?? [])
            if (new RegExp(re, 's').test(joined))
                failures.push(`${label}: reply matched forbidden /${re}/`);
        if (t.expectTools && [...new Set(tools)].sort().join() !== [...new Set(t.expectTools)].sort().join())
            failures.push(`${label}: tools ${JSON.stringify(tools)} != ${JSON.stringify(t.expectTools)}`);
        for (const f of t.forbidTools ?? [])
            if (tools.includes(f))
                failures.push(`${label}: forbidden tool ${f} ran`);
        last = out;
    }
    return { name: conv.name, passed: failures.length === 0, failures, transcript };
}
const fixtureHasPersonalData = (text) => SCRUB.some((re) => re.test(text));
exports.fixtureHasPersonalData = fixtureHasPersonalData;
//# sourceMappingURL=assistant-fixture-harness.js.map