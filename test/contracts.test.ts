import { describe, expect, it } from "vitest";
import {
  AgentCommandSchema,
  DecisionRequestSchema,
  DecisionResultSchema,
  DomEventSchema,
  GuardrailSchema,
  MasterySummarySchema,
  ScreenEventSchema,
  SessionLifecycleSchema,
  SpeechSignalSchema,
  TranscriptTurnSchema,
  UsageRecordSchema,
  WorkMapPublishedSchema,
  WorkMapSchema,
  makeEvent,
  streamEnvelopeSchema,
  STREAMS,
  EVENT_TYPES,
} from "../src/index.js";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const mastery = {
  session_id: "s1",
  workmap_id: uuid(1),
  learner_id: "l1",
  steps: [{ step_id: uuid(2), key: "S4", title: "Code the invoice", outcome: "corrected_after_intervention" }],
  practice_next: [{ guardrail_id: uuid(3), reason: "Tripped G1" }],
  counts: { independent_correct: 0, prompted_correct: 0, corrected_after_intervention: 1, not_attempted: 6 },
};

const guardrail = {
  id: uuid(3),
  key: "G1",
  kind: "threshold",
  description: "Equipment over €5,000 is always capex",
  rule: { and: [{ ">": [{ var: "net_amount" }, 5000] }, { "==": [{ var: "category" }, "equipment"] }] },
  consequence: { require: { cost_center: "0400" } },
  quote: "Alles über fünftausend ist Anlagevermögen.",
  quote_en: "Anything over five thousand is a fixed asset.",
  evidence: [{ event_id: "01J0", turn_id: "t7", t_ms: 192_000 }],
};

const samples: [string, { parse: (v: unknown) => unknown }, unknown][] = [
  ["SessionLifecycle", SessionLifecycleSchema, { event: "started", kind: "capture", phase: "capture", workflow_id: "wf1", mode: "browser", language: "de" }],
  ["TranscriptTurn", TranscriptTurnSchema, { turn_id: "t1", role: "user", text: "…und dann geht die auf 0400.", lang: "de", source: "live", redacted: true }],
  ["SpeechSignal", SpeechSignalSchema, { kind: "user_speech_end", source: "sdk" }],
  ["DomEvent", DomEventSchema, { kind: "field_change", record: { kind: "invoice", id: "4471" }, field: "cost_center", before: "4711", after: "0400", state: { net_amount: 6350, cost_center: "0400" } }],
  ["ScreenEvent", ScreenEventSchema, { event_id: "01J0", type: "field_changed", entity: { kind: "invoice", id: "4471" }, field: "cost_center", before: "4711", after: "0400", state: { app: "MiniERP", record: { invoice_id: "4471", net_amount: 6350, supplier_known: true } }, confidence: 0.93, source: "dom" }],
  ["AgentCommand ask", AgentCommandSchema, { type: "ask", question_id: uuid(9), text: "Why 0400 here?", qtype: "why" }],
  ["AgentCommand phase", AgentCommandSchema, { type: "phase", phase: "debrief", conversation_token: "tok", agent_id: "agent_1", dynamic_variables: { expert: "Sabine" } }],
  ["AgentCommand summary", AgentCommandSchema, { type: "summary", mastery }],
  ["DecisionRequest", DecisionRequestSchema, { session_id: "s1", decisions: [{ id: "D8", state: { reply: "Ja, genau." } }] }],
  ["DecisionResult", DecisionResultSchema, { id: "D8", answer: "confirmed", probabilities: { confirmed: 0.91 }, confidence: 0.91, provider: "jev", escalated: false, latency_ms: 212 }],
  ["DecisionResult with answers", DecisionResultSchema, { id: "D6", answer: 1, confidence: 0.82, provider: "jev", escalated: false, latency_ms: 240, answers: { specificity: { answer: 1, score: 1.3, confidence: 0.82 }, refers_to_unknown_entity: { answer: true, p_true: 0.9, confidence: 0.9 } } }],
  ["Guardrail", GuardrailSchema, guardrail],
  ["WorkMap", WorkMapSchema, { id: uuid(1), workflow_id: "wf1", expert_id: "e1", version: 1, status: "published", title: "Supplier invoice coding", language: "de", steps: [{ id: uuid(2), key: "S4", ordinal: 4, title: "Code the invoice to a cost center", screen_moment: { t_ms: 192_000, label: "03:12", event_ids: ["01J0"], field: "cost_center" }, decision: "Re-coded opex (4711) to capex (0400)", reason: { quote: "Alles über fünftausend…", turn_id: "t7", source_label: "Sabine, 03:12" }, guardrail_ids: [uuid(3)], is_judgment_call: true, screen_signature: { app: "MiniERP", record_kind: "invoice", field: "cost_center" } }], guardrails: [guardrail], open_items: [{ id: "o1", text: "Which list marks known suppliers?", origin: "live", status: "open" }] }],
  ["WorkMapPublished", WorkMapPublishedSchema, { workmap_id: uuid(1), workflow_id: "wf1", version: 1 }],
  ["MasterySummary", MasterySummarySchema, mastery],
  ["UsageRecord", UsageRecordSchema, { service: "brain", vendor: "typesafe", units: 1200, unit: "tokens_in", cost_usd: 0.0001, counterfactual_usd: 0.0012 }],
];

describe("contract schemas round-trip", () => {
  it.each(samples)("%s", (_name, schema, sample) => {
    const parsed = schema.parse(sample);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(sample);
  });

  it("rejects an unredacted transcript turn", () => {
    expect(() => TranscriptTurnSchema.parse({ turn_id: "t1", role: "user", text: "x", lang: "en", source: "live", redacted: false })).toThrow();
  });

  it("rejects an unknown agent command type", () => {
    expect(() => AgentCommandSchema.parse({ type: "shout", text: "hi" })).toThrow();
  });
});

describe("envelope", () => {
  it("makeEvent fills id, v and ts and validates against the stream schema", () => {
    const ev = makeEvent({
      type: EVENT_TYPES[STREAMS.speech],
      org_id: "o1",
      session_id: "s1",
      t_ms: 1850,
      producer: "gateway",
      data: { kind: "user_speech_end", source: "sdk" },
    });
    expect(ev.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(ev.v).toBe(1);
    expect(() => new Date(ev.ts).toISOString()).not.toThrow();
    expect(streamEnvelopeSchema(STREAMS.speech).parse(ev)).toEqual(ev);
  });

  it("rejects a payload that belongs to another stream", () => {
    const ev = makeEvent({ type: "speech.signal", org_id: "o1", session_id: "s1", t_ms: 0, producer: "gateway", data: { kind: "nope" } });
    expect(() => streamEnvelopeSchema(STREAMS.speech).parse(ev)).toThrow();
  });
});

describe("UsageRecord vendor (docs v0.2)", () => {
  it("no longer accepts gemini", () => {
    expect(() => UsageRecordSchema.parse({ service: "perception", vendor: "gemini", units: 1, unit: "tokens_in", cost_usd: 0 })).toThrow();
  });
});
