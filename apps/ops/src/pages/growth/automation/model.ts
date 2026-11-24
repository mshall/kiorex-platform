import type { GraphEdge, GraphNode, JourneyGraph } from "@/api/automation";

/**
 * The form model of the builder (GRW-P3-E). The editor is a constrained form, not a canvas and not a script: one trigger, an ordered list of steps (wait, condition, send), and an optional split by
 * experiment at the end. The model converts to the closed graph the API validates and back; a graph the form cannot draw (loops, a split in the middle) opens read-only. PURE.
 */
export type Step =
  | { kind: "WAIT"; value: number; unit: "minutes" | "hours" | "days" }
  | { kind: "CONDITION"; stage: string[]; language: string[]; platform: string[]; hasDependants: "" | "yes" | "no"; lastBookingMin: string; lastBookingMax: string }
  | { kind: "SEND"; template: string; channels: string[] };
export interface Split { experiment: string; arms: Array<{ variant: string; template: string; channels: string[] }> }
export interface Model { trigger: string; steps: Step[]; split: Split | null }

export const UNIT_MINUTES = { minutes: 1, hours: 60, days: 1440 } as const;
export const emptyModel = (): Model => ({ trigger: "STAGE_DORMANT", steps: [{ kind: "SEND", template: "REENGAGE_DORMANT", channels: [] }], split: null });
export const newStep = (kind: Step["kind"]): Step => kind === "WAIT" ? { kind, value: 1, unit: "days" } : kind === "CONDITION" ? { kind, stage: [], language: [], platform: [], hasDependants: "", lastBookingMin: "", lastBookingMax: "" } : { kind, template: "REENGAGE_DORMANT", channels: [] };

const segmentOf = (s: Extract<Step, { kind: "CONDITION" }>): Record<string, unknown> => {
  const o: Record<string, unknown> = {};
  if (s.stage.length) o.stage = s.stage; if (s.language.length) o.language = s.language; if (s.platform.length) o.platform = s.platform;
  if (s.hasDependants) o.hasDependants = s.hasDependants === "yes";
  const r: Record<string, number> = {}; if (s.lastBookingMin !== "") r.min = Number(s.lastBookingMin); if (s.lastBookingMax !== "") r.max = Number(s.lastBookingMax); if (Object.keys(r).length) o.lastBookingDaysAgo = r;
  return o;
};

export function toGraph(m: Model): JourneyGraph {
  const nodes: GraphNode[] = [{ id: "start", type: "TRIGGER", event: m.trigger }]; const edges: GraphEdge[] = []; let prev = "start"; let n = 0;
  const link = (id: string, label?: string) => { edges.push({ from: prev, to: id, ...(label ? { label } : {}) }); };
  for (const s of m.steps) {
    const id = `n${++n}`;
    if (s.kind === "WAIT") nodes.push({ id, type: "WAIT", minutes: Math.round(s.value * UNIT_MINUTES[s.unit]) });
    else if (s.kind === "CONDITION") nodes.push({ id, type: "CONDITION", segment: segmentOf(s) });
    else nodes.push({ id, type: "SEND", template: s.template, ...(s.channels.length ? { channels: s.channels } : {}) });
    link(id); prev = id;
  }
  if (m.split) {
    const id = `n${++n}`; nodes.push({ id, type: "BRANCH_EXPERIMENT", experiment: m.split.experiment }); link(id); prev = id;
    const end = "end"; nodes.push({ id: end, type: "END" });
    for (const a of m.split.arms) { const sid = `s${++n}`; nodes.push({ id: sid, type: "SEND", template: a.template, ...(a.channels.length ? { channels: a.channels } : {}) }); edges.push({ from: id, to: sid, label: a.variant }, { from: sid, to: end }); }
  } else { nodes.push({ id: "end", type: "END" }); edges.push({ from: prev, to: "end" }); }
  return { schema: 1, nodes, edges };
}

/** The form model of a graph, or null when the form cannot draw it (then the builder shows it read-only). */
export function fromGraph(g: JourneyGraph): Model | null {
  const byId = new Map(g.nodes.map((x) => [x.id, x])); const out = (id: string) => g.edges.filter((e) => e.from === id);
  const trig = g.nodes.find((x) => x.type === "TRIGGER"); if (!trig) return null;
  const steps: Step[] = []; let split: Split | null = null; let cur = trig; const seen = new Set<string>();
  for (let guard = 0; guard < 40; guard++) {
    if (seen.has(cur.id)) return null; seen.add(cur.id);
    const next = out(cur.id);
    if (cur.type === "END") break;
    if (cur.type === "BRANCH_EXPERIMENT") {
      const arms = next.map((e) => { const s = byId.get(e.to); if (!s || s.type !== "SEND" || !e.label) return null; const after = out(s.id); if (after.length !== 1 || byId.get(after[0]!.to)?.type !== "END") return null; return { variant: e.label, template: s.template!, channels: s.channels ?? [] }; });
      if (arms.some((a) => !a)) return null; split = { experiment: cur.experiment!, arms: arms as Split["arms"] }; break;
    }
    if (cur.type !== "TRIGGER") {
      if (cur.type === "WAIT") { const m = cur.minutes!; const unit = m % 1440 === 0 ? "days" : m % 60 === 0 ? "hours" : "minutes"; steps.push({ kind: "WAIT", value: m / UNIT_MINUTES[unit], unit }); }
      else if (cur.type === "CONDITION") { const sg = (cur.segment ?? {}) as Record<string, unknown>; const known = ["stage", "language", "platform", "hasDependants", "lastBookingDaysAgo"]; if (Object.keys(sg).some((k) => !known.includes(k))) return null; const r = (sg.lastBookingDaysAgo ?? {}) as { min?: number; max?: number };
        steps.push({ kind: "CONDITION", stage: (sg.stage as string[]) ?? [], language: (sg.language as string[]) ?? [], platform: (sg.platform as string[]) ?? [], hasDependants: sg.hasDependants === undefined ? "" : sg.hasDependants ? "yes" : "no", lastBookingMin: r.min === undefined ? "" : String(r.min), lastBookingMax: r.max === undefined ? "" : String(r.max) }); }
      else if (cur.type === "SEND") steps.push({ kind: "SEND", template: cur.template!, channels: cur.channels ?? [] });
      else return null;
    }
    if (next.length !== 1) return null; const nx = byId.get(next[0]!.to); if (!nx) return null; cur = nx;
  }
  return { trigger: trig.event!, steps, split };
}
