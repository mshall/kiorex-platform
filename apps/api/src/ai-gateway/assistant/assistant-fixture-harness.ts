/**
 * GRW-P2-D fixture harness. Replays JSONL conversations through the REAL orchestrator (the caller supplies `io`, which sends an inbound WhatsApp message to the running app and reads back what the
 * mock inbox received) with the mock or fixture model, a seeded database and the real BookingService. One line of a `*.jsonl` file is one conversation:
 *   {"name":"...","locale":"en","turns":[{"in":"I want to book dermatology","expectOut":["Pick a doctor"],"expectTools":["search_providers"]},{"button":"Confirm","expectOut":["Booked"]}]}
 * `expectOut` are regular expressions that must ALL match the joined replies of the turn; `notOut` must match none; `expectTools` are the tool names recorded for the turn (any order, exact set);
 * `forbidTools` must not appear. The same harness drives the red-team corpus (`{"name","in","expect":"screen"|"safe"}`, see test/assistant-redteam.int.spec.ts).
 * `ASSISTANT_RECORD=1` (development only, see assistant-record.cli.ts) records a real model run into scrubbed fixtures: no phone numbers, no names.
 */
export interface FixtureTurn { in?: string; button?: string; expectOut?: string[]; notOut?: string[]; expectTools?: string[]; forbidTools?: string[] }
export interface FixtureConversation { name: string; locale?: 'ar' | 'en'; verified?: boolean; turns: FixtureTurn[] }
export interface HarnessIo {
  /** Sends one inbound message (text or button payload) and returns the bodies of the replies. */
  send(msg: { text?: string; button?: string }): Promise<string[]>;
  /** Names of the tool calls recorded since the previous call of `toolsSinceMark`. */
  toolsSinceMark(): Promise<string[]>;
}
export interface HarnessResult { name: string; passed: boolean; failures: string[]; transcript: { in: string; out: string[]; tools: string[] }[] }

export const parseJsonl = <T>(s: string): T[] => s.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l) as T);
const buttonsIn = (bodies: string[]) => Object.fromEntries(bodies.flatMap((b) => [...b.matchAll(/^\[([^\]]+)\] ((?:CONFIRM|DECLINE):\S+)$/gm)].map((m) => [m[1], m[2]])));
const SCRUB = [/\+?\d[\d\s-]{8,}\d/, /[\w.+-]+@[\w-]+\.[\w.-]+/];

export async function replay(conv: FixtureConversation, io: HarnessIo): Promise<HarnessResult> {
  const failures: string[] = []; const transcript: HarnessResult['transcript'] = [];
  let last: string[] = [];
  await io.toolsSinceMark();
  for (const [i, t] of conv.turns.entries()) {
    const label = `${conv.name}#${i + 1}`;
    let out: string[];
    if (t.button) {
      const id = buttonsIn(last)[t.button];
      if (!id) { failures.push(`${label}: no "${t.button}" button in the previous reply`); transcript.push({ in: `[${t.button}]`, out: [], tools: [] }); continue; }
      out = await io.send({ button: id });
    } else out = await io.send({ text: t.in ?? '' });
    const tools = await io.toolsSinceMark();
    transcript.push({ in: t.button ? `[${t.button}]` : t.in ?? '', out, tools });
    const joined = out.join('\n');
    for (const re of t.expectOut ?? []) if (!new RegExp(re, 's').test(joined)) failures.push(`${label}: reply did not match /${re}/`);
    for (const re of t.notOut ?? []) if (new RegExp(re, 's').test(joined)) failures.push(`${label}: reply matched forbidden /${re}/`);
    if (t.expectTools && [...new Set(tools)].sort().join() !== [...new Set(t.expectTools)].sort().join()) failures.push(`${label}: tools ${JSON.stringify(tools)} != ${JSON.stringify(t.expectTools)}`);
    for (const f of t.forbidTools ?? []) if (tools.includes(f)) failures.push(`${label}: forbidden tool ${f} ran`);
    last = out;
  }
  return { name: conv.name, passed: failures.length === 0, failures, transcript };
}

/** A recorded fixture must not carry personal data: used by the recorder and by a test over every committed fixture file. */
export const fixtureHasPersonalData = (text: string): boolean => SCRUB.some((re) => re.test(text));
