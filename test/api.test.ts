import { describe, expect, it } from "vitest";
import * as C from "../src/index.js";
import { INVOICES } from "../dev/seed/demo.js";

const el = { conversation_token: "tok", agent_id: "agent_1", dynamic_variables: { expert: "Sabine" } };

// One valid sample per endpoint body (ARCHITECTURE §4.3 + repo DESIGN docs).
const samples: [string, { parse: (v: unknown) => unknown }, unknown][] = [
  ["POST /v1/sessions req", C.CreateSessionRequestSchema, { workflow_id: "wf", kind: "capture", mode: "browser", language: "de" }],
  ["POST /v1/sessions res", C.CreateSessionResponseSchema, { session_id: "s", sk_token: "jwt", el, ingest_url: "wss://ingest.sidekik.live/ws/frames/s" }],
  ["POST /v1/sessions/:id/consent", C.ConsentRequestSchema, { text_version: "v1", scopes: ["audio", "screen", "storage"] }],
  ["POST /v1/sessions/:id/phase", C.TaskDoneRequestSchema, { event: "task_done" }],
  ["POST /v1/sessions/:id/off-record", C.OffRecordRequestSchema, { on: true, source: "ui", back_s: 60 }],
  ["POST /v1/sessions/:id/meeting-bot", C.MeetingBotRequestSchema, { meeting_url: "https://meet.google.com/abc-defg-hij" }],
  ["POST /v1/sessions/:id/presave req", C.PresaveRequestSchema, { state: INVOICES["4510"] }],
  ["presave res", C.PresaveResponseSchema, { allow: false, guardrail_id: "g1", quote: "Alles über fünftausend…", step_id: "s4" }],
  [
    "presave res with every violation",
    C.PresaveResponseSchema,
    {
      allow: false,
      guardrail_id: "g1",
      guardrail_key: "G1",
      quote: "Alles über fünftausend…",
      step_id: "s4",
      field: "cost_center",
      violations: [
        { guardrail_id: "g1", key: "G1", description: "Equipment over €5,000 is capex", blocking: true, step_id: "s4" },
        { guardrail_id: "g3", key: "G3", description: "Unknown supplier: ask the controller", blocking: false },
      ],
    },
  ],
  ["POST /v1/workmaps/:id/publish", C.PublishWorkmapResponseSchema, { job_id: "j1" }],
  ["GET /v1/workmaps/:id/steps/:step/clip", C.ClipUrlResponseSchema, { url: "https://x.supabase.co/storage/v1/object/sign/captures/c.mp4?token=t" }],
  ["POST /v1/agent-host/claim req", C.AgentHostClaimRequestSchema, { t: "one-time" }],
  ["POST /v1/agent-host/claim res", C.AgentHostClaimResponseSchema, { sk_token: "jwt", el }],
  ["WS turn", C.ClientMessageSchema, { type: "turn", t_ms: 4200, turn: { turn_id: "t1", role: "user", text: "Hallo", lang: "de", source: "live" } }],
  ["WS speech", C.ClientMessageSchema, { type: "speech", t_ms: 4300, signal: { kind: "user_speech_end", source: "sdk" } }],
  ["WS dom", C.ClientMessageSchema, { type: "dom", t_ms: 6300, event: { kind: "save_attempt", record: { kind: "invoice", id: "4510" }, state: INVOICES["4510"] } }],
  ["frame header", C.FrameHeaderSchema, { t_ms: 1000, reason: "tick" }],
  ["POST /internal/sessions/:id/phase", C.SetPhaseRequestSchema, { phase: "debrief", dynamic_variables: { prior_open_items: "2" } }],
  ["POST /internal/sessions/:id/off-record (brain)", C.InternalOffRecordRequestSchema, { on: true, source: "brain", t_ms: 1000 }],
  ["POST /internal/redact", C.RedactRequestSchema, { text: "Frag den Peter", lang: "de", keep: ["Kranbau GmbH"] }],
  ["POST /internal/agent-host-token", C.AgentHostTokenResponseSchema, { t: "one-time" }],
  ["POST /internal/decide", C.DecideRequestSchema, { session_id: "s", decisions: [{ id: "D8", state: { reply: "Ja" } }] }],
  ["POST /internal/token req", C.VoiceTokenRequestSchema, { agent: "interviewer", phase: "debrief", session_id: "s", dynamic_variables: {}, language: "de" }],
  ["POST /internal/token res", C.VoiceTokenResponseSchema, { conversation_token: "tok", agent_id: "a" }],
  ["POST /internal/bots", C.CreateBotRequestSchema, { session_id: "s", meeting_url: "https://zoom.us/j/1", bot_name: "Sidekik (recording)" }],
  ["POST /internal/clips", C.ClipsRequestSchema, { session_id: "s", items: [{ step_id: "s4", t_ms: 192000, before_s: 6, after_s: 4 }] }],
  ["POST /internal/tools/recall_context req", C.RecallContextRequestSchema, { session_id: "s", query: "fünftausend", scope: "workflow" }],
  ["POST /internal/tools/recall_context res", C.RecallContextResponseSchema, { snippets: [{ text: "G1 …", t_ms: 192000, source: "guardrail" }] }],
  ["POST /internal/presave req", C.InternalPresaveRequestSchema, { session_id: "s", state: INVOICES["4510"] }],
  ["POST /internal/tools/get_expert_moment res", C.GetExpertMomentResponseSchema, { quote: "…", label: "03:12", clip_url: "https://x/c.mp4" }],
  ["POST /internal/tools/get_expert_moment res, clip not cut yet", C.GetExpertMomentResponseSchema, { quote: "…", label: "03:12" }],
];

describe("api schemas", () => {
  it.each(samples)("%s", (_name, schema, sample) => {
    expect(JSON.parse(JSON.stringify(schema.parse(sample)))).toEqual(sample);
  });

  it("applies documented defaults", () => {
    expect(C.ClipsRequestSchema.parse({ session_id: "s", items: [{ step_id: "s4", t_ms: 1 }] }).items[0]).toMatchObject({ before_s: 6, after_s: 4 });
    expect(C.CreateBotRequestSchema.parse({ session_id: "s", meeting_url: "https://meet.google.com/x" }).bot_name).toBe("Sidekik (recording)");
  });

  it("rejects what the docs forbid", () => {
    expect(() => C.SetPhaseRequestSchema.parse({ phase: "capture" })).toThrow();
    expect(() => C.OffRecordRequestSchema.parse({ on: true, source: "brain" })).toThrow(); // brain uses the internal route
    expect(() => C.ConsentRequestSchema.parse({ text_version: "v1", scopes: ["camera"] })).toThrow();
    expect(() => C.FrameHeaderSchema.parse({ t_ms: 1, reason: "scroll" })).toThrow();
  });
});

describe("PRICE_TABLE", () => {
  it("prices Jev and Claude per token", () => {
    expect(C.priceUsd("typesafe", "jev-1.13.0", "tokens_in", 1_000_000)).toBeCloseTo(0.042, 10);
    expect(C.priceUsd("typesafe", "jev-1.13.0", "tokens_out", 1_000_000)).toBe(0);
    expect(C.priceUsd("anthropic", "claude-haiku-4-5", "tokens_out", 1000)).toBeCloseTo(0.005, 10);
    expect(C.priceUsd("anthropic", "claude-sonnet-5-5", "tokens_in", 1000)).toBeCloseTo(0.002, 10);
  });

  it("prices Recall per bot hour", () => {
    expect(C.priceUsd("recall", "bot", "hours", 1.5)).toBeCloseTo(0.75, 10);
    expect(C.priceUsd("recall", "bot_web_4_core", "hours", 0.5)).toBeCloseTo(0.3, 10);
  });

  it("prices ElevenLabs agents per conversation minute", () => {
    expect(C.priceUsd("elevenlabs", "agent", "minutes", 2.5)).toBeCloseTo(0.2, 10);
  });

  it("returns undefined for prices not in the table", () => {
    expect(C.priceUsd("elevenlabs", "any", "minutes", 10)).toBeUndefined();
    expect(C.priceUsd("anthropic", "claude-unknown", "tokens_in", 10)).toBeUndefined();
  });
});
