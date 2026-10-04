import { describe, expect, it } from "vitest";
import { pageAction, toPageMessage, type AgentCommand, type MasterySummary } from "../src/index.js";

const mastery: MasterySummary = {
  session_id: "s1",
  workmap_id: "w1",
  learner_id: "l1",
  steps: [],
  practice_next: [
    { guardrail_id: "g1", reason: "Equipment over €5,000 goes to 0400" },
    { step_id: "s5", reason: "Add the asset number before saving" },
  ],
  counts: { independent_correct: 4, prompted_correct: 1, corrected_after_intervention: 1, not_attempted: 1 },
};

// ARCHITECTURE §4.5: the exact strings the page sends with sendUserMessage.
const cases: [AgentCommand, string | null][] = [
  [{ type: "ask", question_id: "q1", text: "Ab welchem Betrag kommt so eine Rechnung auf 0400?", qtype: "limit" }, "[SIDEKIK] ASK: Ab welchem Betrag kommt so eine Rechnung auf 0400?"],
  [{ type: "followup", open_item_id: "o1", text: "Welche Liste meinst du?" }, "[SIDEKIK] FOLLOWUP: Welche Liste meinst du?"],
  [{ type: "teachback", workmap_id: "w1", script: "Erst prüfst du den Lieferanten,\ndann die Kostenstelle." }, "[SIDEKIK] TEACHBACK: Erst prüfst du den Lieferanten, dann die Kostenstelle."],
  [{ type: "predict", step_id: "s4", prompt: "Which cost center would you use here?" }, "[SIDEKIK] PREDICT: Which cost center would you use here?"],
  [
    { type: "intervene", guardrail_id: "g1", step_id: "s4", text: "G1: equipment over €5,000 is capex. Sabine: \"Alles über fünftausend ist Anlagevermögen.\"", field: "cost_center" },
    "[SIDEKIK] INTERVENE: G1: equipment over €5,000 is capex. Sabine: \"Alles über fünftausend ist Anlagevermögen.\"",
  ],
  [
    { type: "summary", mastery },
    "[SIDEKIK] SUMMARY: 4 of 7 steps done independently, 1 with a prompt, 1 corrected after an intervention, 1 not attempted. Practice next: Equipment over €5,000 goes to 0400; Add the asset number before saving.",
  ],
  [{ type: "ctx", text: "Screen: invoice 4471 open" }, null],
  [{ type: "replay", step_id: "s4", clip_url: "https://x/clip.mp4", quote: "…", label: "03:12" }, null],
  [{ type: "offrecord", on: true }, null],
  [{ type: "phase", phase: "debrief", conversation_token: "t", agent_id: "a", dynamic_variables: {} }, null],
];

describe("toPageMessage", () => {
  it.each(cases)("%j", (cmd, expected) => {
    expect(toPageMessage(cmd)).toBe(expected);
  });
});

describe("pageAction", () => {
  it("ctx is a contextual update, never spoken", () => {
    expect(pageAction({ type: "ctx", text: "Screen:\n invoice 4471" })).toEqual({ kind: "contextual_update", text: "Screen: invoice 4471" });
  });

  it("replay, offrecord and phase are UI-only", () => {
    for (const cmd of cases.map(([c]) => c).filter((c) => ["replay", "offrecord", "phase"].includes(c.type))) {
      expect(pageAction(cmd)).toEqual({ kind: "ui" });
    }
  });

  it("covers every command type", () => {
    const types = new Set(cases.map(([c]) => c.type));
    expect([...types].sort()).toEqual(["ask", "ctx", "followup", "intervene", "offrecord", "phase", "predict", "replay", "summary", "teachback"]);
  });
});
