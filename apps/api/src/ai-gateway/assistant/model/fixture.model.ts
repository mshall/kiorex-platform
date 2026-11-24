import { readFileSync } from 'node:fs';
import { normalizeText } from '../../../safety/safety-public';
import { validateModelStep } from '../assistant.model.port';
import type { AssistantModel, ModelInput, ModelStep } from '../assistant.types';

/**
 * Replays recorded model runs (JSONL, one object per model step: `{ "text": "<redacted patient text>", "state": "PICKING", "toolResults": 0, "step": { ...ModelStep } }`).
 * Matching is on normalised text, state and the number of tool results already in the turn, so the recorded run replays deterministically. A miss throws and the fallback chain takes over.
 * Fixtures hold scrubbed text only: no phone numbers, no names (the recorder and the fixture-scrub test enforce it).
 */
export class FixtureModelMissError extends Error {}
export interface FixtureLine { text: string; state: string; toolResults: number; step: ModelStep }

export class FixtureAssistantModel implements AssistantModel {
  readonly name: string;
  readonly mode = 'fixture' as const;
  private readonly index = new Map<string, ModelStep>();
  constructor(lines: FixtureLine[], name = 'fixture') {
    this.name = name;
    for (const l of lines) { const s = validateModelStep(l.step); if (s) this.index.set(this.key(l.text, l.state, l.toolResults), s); }
  }
  static fromFile(path: string) { return new FixtureAssistantModel(parseJsonl(readFileSync(path, 'utf8')), path); }
  private key(text: string, state: string, n: number) { return `${normalizeText(text)}|${state}|${n}`; }
  async step(i: ModelInput): Promise<ModelStep> {
    const s = this.index.get(this.key(i.text, i.state, i.toolResults.length));
    if (!s) throw new FixtureModelMissError('no recorded step for this input');
    return s;
  }
  lastUsage() { return { tokensIn: 0, tokensOut: 0, costMinor: 0 }; }
}

export function parseJsonl(s: string): FixtureLine[] {
  return s.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l) as FixtureLine);
}
