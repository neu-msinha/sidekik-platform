import { describe, expect, it } from "vitest";
import { evaluate, type Observed } from "../dev/smoke-checks.js";
import { GUARDRAILS, STEPS } from "../dev/seed/demo.js";
import type { AgentCommand } from "../src/index.js";

const G1 = GUARDRAILS.find((g) => g.key === "G1")!.id;
const S4 = STEPS.find((s) => s.key === "S4")!.id;
const obs = (cmds: AgentCommand[], extra: Partial<Observed> = {}, producer = "brain"): Observed => ({
  commands: cmds.map((cmd, i) => ({ producer, t_ms: i * 1000, cmd })),
  workmapsPublished: 0,
  ...extra,
});
const ask = (qtype: "why" | "limit" | "stop_and_ask"): AgentCommand => ({ type: "ask", question_id: `q-${qtype}`, text: "?", qtype });
const failing = (o: Observed, stage: "h6" | "h14" | "h18") => evaluate(stage, o).filter((c) => !c.pass).map((c) => c.name);

describe("smoke checks", () => {
  it("h6 passes with 3 asks including a guardrail question", () => {
    expect(failing(obs([ask("limit"), ask("why"), ask("stop_and_ask")]), "h6")).toEqual([]);
  });

  it("h6 fails on too few asks, no guardrail question, or asks from the wrong service", () => {
    expect(failing(obs([ask("why"), ask("why")]), "h6")).toEqual(["brain asked ≥ 3 questions", "≥ 1 guardrail question (limit / stop_and_ask)"]);
    expect(failing(obs([ask("limit"), ask("why"), ask("why")], {}, "mapper"), "h6")).toEqual(["asks come from brain"]);
  });

  it("h14 needs follow-ups, a teach-back and a published Work Map", () => {
    const cmds: AgentCommand[] = [
      ask("limit"),
      ask("why"),
      ask("why"),
      ...[1, 2, 3].map((n) => ({ type: "followup" as const, open_item_id: `o${n}`, text: "?" })),
      { type: "teachback", workmap_id: "w", script: "…" },
    ];
    expect(failing(obs(cmds, { workmapsPublished: 1 }), "h14")).toEqual([]);
    expect(failing(obs(cmds), "h14")).toEqual(["Work Map published"]);
  });

  it("h18 needs the presave catch on G1, an intervention at S4, a replay and a summary", () => {
    const cmds: AgentCommand[] = [
      { type: "predict", step_id: S4, prompt: "Which cost center?" },
      { type: "intervene", guardrail_id: G1, step_id: S4, text: "Hold on before you save…" },
      { type: "replay", step_id: S4, clip_url: "https://x", quote: "…", label: "03:12" },
      {
        type: "summary",
        mastery: { session_id: "s", workmap_id: "w", learner_id: "l", steps: [], practice_next: [], counts: { independent_correct: 0, prompted_correct: 0, corrected_after_intervention: 1, not_attempted: 0 } },
      },
    ];
    const presave = { allow: false, guardrail_id: G1, quote: "Alles über fünftausend…", latency_ms: 40 };
    expect(failing(obs(cmds, { presave }, "tutor"), "h18")).toEqual([]);
    expect(failing(obs(cmds, { presave: { ...presave, allow: true } }, "tutor"), "h18")).toContain("presave catches #4510 on 4711 (G1)");
    expect(failing(obs([], { presave: { error: "HTTP 404" } }, "tutor"), "h18")).toHaveLength(5);
  });
});
