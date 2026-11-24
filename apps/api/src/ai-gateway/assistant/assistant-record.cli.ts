import { appendFileSync, readFileSync } from 'node:fs';
import { redactForModel, sanitiseInbound } from './assistant.safety';
import { OpenAiCompatAssistantModel } from './model/openai-compat.model';
import { validateModelStep } from './assistant.model.port';
import { allowedTools } from './assistant.policy';
import { emptyContext, type AssistantModel, type ModelInput, type ModelStep } from './assistant.types';
import { marketDate } from './assistant.lexicon';
import type { FixtureLine } from './model/fixture.model';

/**
 * DEV-ONLY fixture recorder (`ASSISTANT_RECORD=1`). It wraps a model and appends every step it returns to a JSONL fixture with the patient text SCRUBBED (redactForModel: phone numbers, e-mail, ids and
 * name claims are replaced, emergency text is withheld; the orchestrator already hands the model this very text, so a replay matches), so a fixture can be committed. It refuses to run when NODE_ENV=production or when ASSISTANT_RECORD is not 1. A human runs it in staging against a real
 * model (NEEDS_HUMAN); CI never does. Usage: `ASSISTANT_RECORD=1 ASSISTANT_BASE_URL=... ASSISTANT_MODEL=... ASSISTANT_API_KEY=... node dist/ai-gateway/assistant/assistant-record.cli.js prompts.txt out.jsonl`
 * (one scrubbed-or-not prompt per line; only the FIRST step of each prompt in a fresh GREETING session is recorded).
 */
export function assertRecordingAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production') throw new Error('assistant-record refuses to run with NODE_ENV=production');
  if (env.ASSISTANT_RECORD !== '1') throw new Error('assistant-record needs ASSISTANT_RECORD=1 (development only)');
}

export class RecordingModel implements AssistantModel {
  readonly name: string; readonly mode: AssistantModel['mode'];
  constructor(private readonly inner: AssistantModel, private readonly outFile: string, env: NodeJS.ProcessEnv = process.env) { assertRecordingAllowed(env); this.name = `recording:${inner.name}`; this.mode = inner.mode; }
  lastUsage() { return this.inner.lastUsage?.() ?? { tokensIn: 0, tokensOut: 0, costMinor: 0 }; }
  async step(i: ModelInput): Promise<ModelStep> {
    const step = await this.inner.step(i);
    const valid = validateModelStep(step);
    if (valid) { const line: FixtureLine = { text: redactForModel(sanitiseInbound(i.text).text), state: i.state, toolResults: i.toolResults.length, step: valid }; appendFileSync(this.outFile, `${JSON.stringify(line)}\n`); }
    return step;
  }
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  assertRecordingAllowed(env);
  const [promptsFile, outFile] = argv;
  if (!promptsFile || !outFile) { console.error('usage: assistant-record.cli <prompts.txt> <out.jsonl>'); return 2; }
  if (!env.ASSISTANT_BASE_URL || !env.ASSISTANT_MODEL || !env.ASSISTANT_API_KEY) { console.error('ASSISTANT_BASE_URL, ASSISTANT_MODEL and ASSISTANT_API_KEY are required (NEEDS_HUMAN: vendor account)'); return 2; }
  const model = new RecordingModel(new OpenAiCompatAssistantModel({ baseUrl: env.ASSISTANT_BASE_URL, model: env.ASSISTANT_MODEL, apiKey: env.ASSISTANT_API_KEY }), outFile, env);
  for (const prompt of readFileSync(promptsFile, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)) {
    const text = sanitiseInbound(prompt).text;
    const allowed = allowedTools('GREETING', true);
    await model.step({ text, lang: /[؀-ۿ]/.test(text) ? 'ar' : 'en', dialect: 'eg', state: 'GREETING', verified: true, shown: emptyContext().shown, allowedTools: allowed, toolResults: [], today: marketDate(), turn: 0, prompt: { system: OpenAiCompatAssistantModel.systemPrompt(), user: text } }).catch((e) => console.error(`step failed: ${(e as Error).message}`));
  }
  return 0;
}
if (require.main === module) void main(process.argv.slice(2)).then((c) => process.exit(c));
