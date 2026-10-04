import { describe, expect, it } from "vitest";
import { DECISION_IDS, DECISION_SPECS, expandQuestions, type QuestionSpec } from "../src/index.js";

// Copied verbatim from ARCHITECTURE Appendix A. If this test fails, the option
// order changed: that breaks Jev calibration and every consumer. Don't "fix" the test.
const APPENDIX_A: Record<string, Record<string, "noul" | "score" | readonly string[]>> = {
  D1: { pause_now: "noul", activity: ["cannot_tell", "finished_substep", "navigating", "reading", "talking", "typing"] },
  D2: { event_class: ["cannot_tell", "data_copy", "exception_handling", "judgment_call", "routine_navigation"] },
  D3: { "answered_q{n}": "noul", "value_q{n}": "score" },
  D4: { qtype: ["exception", "limit", "other", "stop_and_ask", "why"] },
  D5: { content_class: ["deflection", "guardrail_only", "neither", "reason_and_guardrail", "reason_only"], has_numeric_or_date_condition: "noul" },
  D6: { specificity: "score", refers_to_unknown_entity: "noul" },
  D7: { off_record_request: "noul", back_on_record: "noul" },
  D8: { teachback_reply: ["confirmed", "confirmed_minor", "corrected", "unclear"] },
  D9: { prediction_grade: ["correct_no_reason", "correct_with_reason", "no_answer", "partially", "wrong"] },
  D10: { divergence: ["acceptable_variant", "cannot_tell", "diverges", "same_as_expert"] },
  D11: { intervention_style: ["hint_soft", "intervene_now", "wait_and_watch"] },
  D12: { expert_signals_done: "noul" },
};

describe("DECISION_SPECS", () => {
  it("covers exactly D1–D12", () => {
    expect(Object.keys(DECISION_SPECS)).toEqual([...DECISION_IDS]);
  });

  it.each(DECISION_IDS)("%s matches Appendix A question names, primitives and option order", (id) => {
    const spec = DECISION_SPECS[id];
    expect(spec.id).toBe(id);
    const expected = APPENDIX_A[id]!;
    expect(Object.keys(spec.questions)).toEqual(Object.keys(expected));
    for (const [name, q] of Object.entries(spec.questions) as [string, QuestionSpec][]) {
      const want = expected[name]!;
      if (typeof want === "string") {
        expect(q.type).toBe(want);
      } else {
        expect(q.type).toBe("choice");
        if (q.type === "choice") {
          expect(q.options).toEqual(want);
          expect(Object.keys(q.criteria).sort()).toEqual([...want]);
        }
      }
    }
  });

  it("every choice question offers cannot_tell, other, or an equivalent no-signal option", () => {
    const escape = new Set(["cannot_tell", "other", "neither", "unclear", "no_answer", "wait_and_watch"]);
    for (const spec of Object.values(DECISION_SPECS)) {
      for (const q of Object.values(spec.questions) as QuestionSpec[]) {
        if (q.type === "choice") expect(q.options.some((o) => escape.has(o))).toBe(true);
      }
    }
  });

  it("D1 criteria text matches the Appendix A example request", () => {
    expect(DECISION_SPECS.D1.questions.pause_now.criteria.true).toBe(
      "Sentence or sub-step ended; screen idle or awaiting a click like Save",
    );
    expect(DECISION_SPECS.D1.questions.activity.criteria.finished_substep).toBe(
      "Just completed an action, idle or about to confirm",
    );
  });
});

describe("expandQuestions", () => {
  it("expands D3 per candidate", () => {
    const qs = expandQuestions(DECISION_SPECS.D3, 3);
    expect(Object.keys(qs)).toEqual(["answered_q1", "value_q1", "answered_q2", "value_q2", "answered_q3", "value_q3"]);
    expect(qs.value_q2!.instructions).toContain("candidate question 2");
    expect(qs.value_q2!.instructions).not.toContain("{n}");
  });

  it("refuses more than 4 candidates", () => {
    expect(() => expandQuestions(DECISION_SPECS.D3, 5)).toThrow(RangeError);
  });

  it("returns non-candidate specs unchanged", () => {
    expect(expandQuestions(DECISION_SPECS.D1)).toBe(DECISION_SPECS.D1.questions);
  });
});
