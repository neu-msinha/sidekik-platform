import { z } from "zod";
import { ServiceNameSchema } from "./envelope.js";

export const DECISION_IDS = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "D11", "D12"] as const;
export const DecisionIdSchema = z.enum(DECISION_IDS);
export type DecisionId = z.infer<typeof DecisionIdSchema>;

export const DecisionProviderSchema = z.enum(["jev", "openrouter-jev", "llm"]);
export type DecisionProvider = z.infer<typeof DecisionProviderSchema>;

export const DecisionRequestSchema = z.object({
  session_id: z.string().min(1),
  decisions: z.array(z.object({ id: DecisionIdSchema, state: z.unknown() })).min(1),
});
export type DecisionRequest = z.infer<typeof DecisionRequestSchema>;

/** One question's answer inside a decision (D6, D1, D5 and D7 ask more than one question). */
export const QuestionAnswerSchema = z.object({
  /** boolean for noul, option for choice, most likely level (1-based) for score. */
  answer: z.union([z.string(), z.number(), z.boolean()]),
  confidence: z.number().min(0).max(1),
  probabilities: z.record(z.string(), z.number()).optional(),
  /** Noul only: probability of true. */
  p_true: z.number().min(0).max(1).optional(),
  /** Score only: probability-weighted level (1-based), may fall between levels. */
  score: z.number().optional(),
});
export type QuestionAnswer = z.infer<typeof QuestionAnswerSchema>;

export const DecisionResultSchema = z.object({
  id: DecisionIdSchema,
  /** Answer to the decision's first question (spec order), e.g. D6 → specificity. */
  answer: z.union([z.string(), z.number(), z.boolean()]),
  probabilities: z.record(z.string(), z.number()).optional(),
  confidence: z.number().min(0).max(1),
  provider: DecisionProviderSchema,
  escalated: z.boolean(),
  latency_ms: z.number().nonnegative(),
  /** Every question's answer, keyed by question name (v0.1.0+: additive). */
  answers: z.record(z.string(), QuestionAnswerSchema).optional(),
});
export type DecisionResult = z.infer<typeof DecisionResultSchema>;

/** Response body of brain `POST /internal/decide`. */
export const DecisionResponseSchema = z.object({ results: z.array(DecisionResultSchema) });
export type DecisionResponse = z.infer<typeof DecisionResponseSchema>;

// ---------------------------------------------------------------------------
// Decision specs (ARCHITECTURE Appendix A). Option lists are alphabetical and
// fixed: never reorder them, Jev and the calibration data depend on the order.
// ---------------------------------------------------------------------------

export type NoulQuestionSpec = {
  type: "noul";
  instructions: string;
  criteria: { true: string; false: string };
};

export type ChoiceQuestionSpec<O extends string = string> = {
  type: "choice";
  instructions: string;
  options: readonly O[];
  criteria: Record<O, string>;
};

export type ScoreQuestionSpec = {
  type: "score";
  instructions: string;
  min: 1;
  max: 4;
  criteria: Record<"1" | "2" | "3" | "4", string>;
};

export type QuestionSpec = NoulQuestionSpec | ChoiceQuestionSpec | ScoreQuestionSpec;
export type QuestionPrimitive = QuestionSpec["type"];

export type DecisionSpec = {
  id: DecisionId;
  used_by: z.infer<typeof ServiceNameSchema>;
  /**
   * Question name → spec. For specs with `per_candidate`, names contain the
   * placeholder `{n}` and are expanded once per candidate (1-based).
   */
  questions: Record<string, QuestionSpec>;
  per_candidate?: { max: number };
  /** Plain-language action rule from Appendix A (thresholds live in the consumer). */
  action_rule: string;
};

function choice<const O extends string>(
  instructions: string,
  criteria: Record<O, string>,
): ChoiceQuestionSpec<O> {
  const options = (Object.keys(criteria) as O[]).slice().sort();
  return { type: "choice", instructions, options, criteria };
}

function noul(instructions: string, whenTrue: string, whenFalse: string): NoulQuestionSpec {
  return { type: "noul", instructions, criteria: { true: whenTrue, false: whenFalse } };
}

function score(instructions: string, criteria: ScoreQuestionSpec["criteria"]): ScoreQuestionSpec {
  return { type: "score", instructions, min: 1, max: 4, criteria };
}

export const DECISION_SPECS = {
  D1: {
    id: "D1",
    used_by: "brain",
    questions: {
      pause_now: noul(
        "Has the expert finished a thought or sub-step so a short question now would not interrupt typing, reading, or a sentence?",
        "Sentence or sub-step ended; screen idle or awaiting a click like Save",
        "Mid-sentence, trailing 'and then', typing, scrolling, or reading",
      ),
      activity: choice("What is the expert doing now?", {
        cannot_tell: "Not enough signal",
        finished_substep: "Just completed an action, idle or about to confirm",
        navigating: "Switching screens or records",
        reading: "Viewing without input",
        talking: "Explaining without acting",
        typing: "Entering data",
      }),
    },
    action_rule: "ask if pause_now >= 0.85 and activity finished_substep >= 0.80",
  },
  D2: {
    id: "D2",
    used_by: "brain",
    questions: {
      event_class: choice("What kind of work does this screen event show?", {
        cannot_tell: "Not enough signal to classify the event",
        data_copy: "Copying a value that is already visible somewhere else on screen",
        exception_handling: "Handling a case that departs from the normal path: a correction, hold, escalation or override",
        judgment_call: "Choosing a value or path that depends on the expert's knowledge and is not dictated by the screen",
        routine_navigation: "Opening, scrolling or moving between screens or records without a decision",
      }),
    },
    action_rule: "only judgment_call or exception_handling >= 0.80 spawns candidate questions",
  },
  D3: {
    id: "D3",
    used_by: "brain",
    per_candidate: { max: 4 },
    questions: {
      "answered_q{n}": noul(
        "Has candidate question {n} already been answered, either by what the expert said or by what is plainly visible on screen?",
        "The expert already explained it, or the answer is plainly visible on screen",
        "The answer is neither said nor visible; asking would capture something new",
      ),
      "value_q{n}": score("How much knowledge that only the expert has would the answer to candidate question {n} capture?", {
        "1": "The answer is visible on screen",
        "2": "The answer follows from a documented or obvious rule",
        "3": "The answer is mostly the expert's experience, partly inferable",
        "4": "Pure tacit knowledge: only the expert knows this",
      }),
    },
    action_rule: "ask the highest value among candidates with answered < 0.15",
  },
  D4: {
    id: "D4",
    used_by: "brain",
    questions: {
      qtype: choice("What kind of question is this candidate?", {
        exception: "Asks when the normal path does not apply",
        limit: "Asks about a threshold, amount or date boundary",
        other: "Does not fit the other types",
        stop_and_ask: "Asks when the expert would stop and ask someone else before continuing",
        why: "Asks for the reason behind a choice",
      }),
    },
    action_rule: "guardrail quota: after 2 asks without limit/stop_and_ask, the next ask must be one",
  },
  D5: {
    id: "D5",
    used_by: "brain",
    questions: {
      content_class: choice("What does the expert's answer contain?", {
        deflection: "Avoids the question, or says it depends without saying on what",
        guardrail_only: "States a rule or limit without explaining why",
        neither: "Neither a reason nor a rule",
        reason_and_guardrail: "Explains why and also states a rule or limit",
        reason_only: "Explains why without stating a rule or limit",
      }),
      has_numeric_or_date_condition: noul(
        "Does the answer contain a condition on an amount, number, count or date?",
        "Mentions a threshold, amount, count, month or date that changes what to do",
        "No numeric or date condition",
      ),
    },
    action_rule: "store the answer; extract the rule text if has_numeric_or_date_condition",
  },
  D6: {
    id: "D6",
    used_by: "mapper",
    questions: {
      specificity: score("How specific and actionable is this explanation?", {
        "1": "Vague: 'it depends', 'you just know'",
        "2": "General direction without concrete conditions",
        "3": "Concrete, with minor gaps",
        "4": "Fully specific: a new hire could act on it alone",
      }),
      refers_to_unknown_entity: noul(
        "Does the explanation refer to a person, system, list or document that has not been identified?",
        "Mentions something like 'the list', 'him', or 'the other system' without saying which",
        "Every person, system or document mentioned is identified",
      ),
    },
    action_rule: "specificity <= 1 or refers_to_unknown_entity → open item",
  },
  D7: {
    id: "D7",
    used_by: "brain",
    questions: {
      off_record_request: noul(
        "Is the expert asking to stop recording or to say something off the record?",
        "Asks to go off the record, pause recording, or not have something captured",
        "Mentions recording or the record without asking to stop it",
      ),
      back_on_record: noul(
        "Is the expert saying recording can resume?",
        "Says they are back on the record or recording can continue",
        "Does not ask to resume recording",
      ),
    },
    action_rule: "run after the regex prefilter; >= 0.5 → call gateway off-record",
  },
  D8: {
    id: "D8",
    used_by: "mapper",
    questions: {
      teachback_reply: choice("How did the expert respond to the teach-back summary?", {
        confirmed: "Agrees the summary is correct",
        confirmed_minor: "Agrees, with a small wording fix that does not change a step or rule",
        corrected: "Changes a step, reason or rule",
        unclear: "The reply does not say whether the summary is right",
      }),
    },
    action_rule: "confidence < 0.80 → mapper re-asks",
  },
  D9: {
    id: "D9",
    used_by: "tutor",
    questions: {
      prediction_grade: choice("How does the learner's prediction compare with the expert's step?", {
        correct_no_reason: "Right action, but no reason or a wrong reason",
        correct_with_reason: "Right action and the expert's reason",
        no_answer: "No prediction, or 'I don't know'",
        partially: "Partly right: the action or the reason is incomplete",
        wrong: "A different action from the expert's",
      }),
    },
    action_rule: "sets the attempt outcome",
  },
  D10: {
    id: "D10",
    used_by: "tutor",
    questions: {
      divergence: choice("How does the learner's action compare with the expert's step?", {
        acceptable_variant: "Different from the expert, but reaches the same valid result",
        cannot_tell: "Not enough signal",
        diverges: "Leads away from the expert's result",
        same_as_expert: "The same action as the expert",
      }),
    },
    action_rule: "diverges >= 0.80 → soft hint",
  },
  D11: {
    id: "D11",
    used_by: "tutor",
    questions: {
      intervention_style: choice("How should the tutor respond to the learner right now?", {
        hint_soft: "Give a short hint without interrupting",
        intervene_now: "Interrupt now; the learner is about to make the mistake",
        wait_and_watch: "Say nothing yet; the learner may self-correct",
      }),
    },
    action_rule: "a save attempt with a pending violation always intervenes",
  },
  D12: {
    id: "D12",
    used_by: "mapper",
    questions: {
      expert_signals_done: noul(
        "Is the expert signalling that they have covered everything for this workflow?",
        "Says they are done, that's everything, or nothing else comes to mind",
        "Still explaining, or open to more questions",
      ),
    },
    action_rule: "supports the coverage check",
  },
} as const satisfies Record<DecisionId, DecisionSpec>;

/** Expands `{n}` question names for per-candidate specs (D3), 1-based. */
export function expandQuestions(spec: DecisionSpec, candidates = 1): Record<string, QuestionSpec> {
  if (!spec.per_candidate) return spec.questions;
  if (candidates < 1 || candidates > spec.per_candidate.max) {
    throw new RangeError(`${spec.id} supports 1..${spec.per_candidate.max} candidates, got ${candidates}`);
  }
  const out: Record<string, QuestionSpec> = {};
  for (let n = 1; n <= candidates; n++) {
    for (const [name, q] of Object.entries(spec.questions)) {
      out[name.replaceAll("{n}", String(n))] = { ...q, instructions: q.instructions.replaceAll("{n}", String(n)) };
    }
  }
  return out;
}
