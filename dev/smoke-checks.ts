/** Pure checks for dev/smoke.ts: what each integration checkpoint expects on the bus (ARCHITECTURE §9, §11). */
import type { AgentCommand } from "../src/index.js";
import { GUARDRAILS, STEPS } from "./seed/demo.js";

export type Stage = "h6" | "h14" | "h18";
export type Check = { name: string; pass: boolean; detail: string };
export type Observed = {
  commands: { producer: string; t_ms: number; cmd: AgentCommand }[];
  workmapsPublished: number;
  presave?: { allow: boolean; guardrail_id?: string; quote?: string; latency_ms: number } | { error: string };
};
export type Thresholds = { minAsks: number };

export const SERVICES = {
  gateway: 8080,
  perception: 8081,
  brain: 8082,
  mapper: 8083,
  tutor: 8084,
  voice: 8085,
  meetbot: 8086,
} as const;
export type Service = keyof typeof SERVICES;

/** Services each checkpoint needs up (meetbot is optional everywhere: cut first if behind). */
export const REQUIRED: Record<Stage, Service[]> = {
  h6: ["gateway", "perception", "brain"],
  h14: ["gateway", "perception", "brain", "mapper", "voice"],
  h18: ["gateway", "perception", "brain", "mapper", "voice", "tutor"],
};

export const FIXTURE: Record<Stage, string> = {
  h6: "fixtures/capture_sabine.jsonl",
  h14: "fixtures/capture_sabine.jsonl",
  h18: "fixtures/tutor_lena.jsonl",
};

const G1 = GUARDRAILS.find((g) => g.key === "G1")!;
const S4 = STEPS.find((s) => s.key === "S4")!;

function count<T extends AgentCommand["type"]>(o: Observed, type: T): Extract<AgentCommand, { type: T }>[] {
  return o.commands.filter((c) => c.cmd.type === type).map((c) => c.cmd as Extract<AgentCommand, { type: T }>);
}

export function evaluate(stage: Stage, o: Observed, t: Thresholds = { minAsks: 3 }): Check[] {
  const checks: Check[] = [];
  const add = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });

  if (stage === "h6" || stage === "h14") {
    const asks = count(o, "ask");
    add(`brain asked ≥ ${t.minAsks} questions`, asks.length >= t.minAsks, `${asks.length} asks`);
    add("≥ 1 guardrail question (limit / stop_and_ask)", asks.some((a) => a.qtype === "limit" || a.qtype === "stop_and_ask"), asks.map((a) => a.qtype).join(", ") || "none");
    const wrong = o.commands.filter((c) => c.cmd.type === "ask" && c.producer !== "brain");
    add("asks come from brain", wrong.length === 0, wrong.length ? `${wrong.length} from other producers` : "ok");
  }
  if (stage === "h14") {
    const followups = count(o, "followup");
    add("debrief: ≥ 3 follow-ups", followups.length >= 3, `${followups.length} follow-ups`);
    add("debrief: a teach-back", count(o, "teachback").length >= 1, `${count(o, "teachback").length} teach-backs`);
    add("Work Map published", o.workmapsPublished >= 1, `${o.workmapsPublished} published`);
  }
  if (stage === "h18") {
    const p = o.presave;
    if (!p || "error" in p) {
      add("presave catches #4510 on 4711 (G1)", false, p ? p.error : "not called");
    } else {
      add("presave catches #4510 on 4711 (G1)", !p.allow && p.guardrail_id === G1.id, `allow=${p.allow} guardrail=${p.guardrail_id ?? "-"}`);
      add("presave quotes Sabine", !!p.quote && p.quote.length > 0, p.quote ?? "no quote");
      add("presave under 300 ms (gateway budget)", p.latency_ms < 300, `${p.latency_ms} ms`);
    }
    add("tutor predicted", count(o, "predict").length >= 1, `${count(o, "predict").length} predicts`);
    const iv = count(o, "intervene");
    add("tutor intervened on G1 at S4", iv.some((i) => i.guardrail_id === G1.id && i.step_id === S4.id), `${iv.length} interventions`);
    add("clip replayed", count(o, "replay").length >= 1, `${count(o, "replay").length} replays`);
    add("mastery summary", count(o, "summary").length >= 1, `${count(o, "summary").length} summaries`);
  }
  return checks;
}
