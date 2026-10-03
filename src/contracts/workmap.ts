import { z } from "zod";

/** A JSON-Logic rule over the normalized InvoiceState variables. */
export const JsonLogicSchema = z.record(z.string(), z.unknown());
export type JsonLogic = z.infer<typeof JsonLogicSchema>;

/** The only variables a guardrail rule may reference. */
export const JSONLOGIC_VARIABLES = [
  "net_amount",
  "currency",
  "category",
  "supplier",
  "supplier_known",
  "invoice_month",
  "company_code",
  "cost_center",
  "asset_number",
  "approvals_count",
] as const;

export const EvidenceSchema = z.object({
  event_id: z.string().optional(),
  keyframe_id: z.string().optional(),
  clip_id: z.string().optional(),
  turn_id: z.string().min(1),
  t_ms: z.number().int().nonnegative(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const OpenItemSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  anchor_t_ms: z.number().int().nonnegative().optional(),
  origin: z.enum(["live", "builder", "learner_gap"]),
  status: z.enum(["open", "asked", "resolved"]),
});
export type OpenItem = z.infer<typeof OpenItemSchema>;

export const StepSchema = z.object({
  id: z.uuid(),
  key: z.string().min(1),
  ordinal: z.number().int().nonnegative(),
  title: z.string().min(1),
  screen_moment: z.object({
    t_ms: z.number().int().nonnegative(),
    label: z.string(),
    event_ids: z.array(z.string()),
    entity: z.string().optional(),
    field: z.string().optional(),
  }),
  decision: z.string(),
  reason: z
    .object({
      quote: z.string(),
      quote_en: z.string().optional(),
      turn_id: z.string().min(1),
      source_label: z.string(),
    })
    .nullable(),
  guardrail_ids: z.array(z.uuid()),
  is_judgment_call: z.boolean(),
  screen_signature: z.object({
    app: z.string(),
    record_kind: z.string(),
    field: z.string().optional(),
  }),
});
export type Step = z.infer<typeof StepSchema>;

export const GuardrailSchema = z.object({
  id: z.uuid(),
  key: z.string().min(1),
  kind: z.enum(["threshold", "condition", "stop_and_ask", "second_approval", "hold"]),
  description: z.string(),
  rule: JsonLogicSchema,
  consequence: z.object({
    require: z.record(z.string(), z.string()).optional(),
    block: z.boolean().optional(),
    action: z.enum(["ask_controller", "hold", "second_approval"]).optional(),
  }),
  quote: z.string(),
  quote_en: z.string().optional(),
  evidence: z.array(EvidenceSchema),
});
export type Guardrail = z.infer<typeof GuardrailSchema>;

export const WorkMapSchema = z.object({
  id: z.uuid(),
  workflow_id: z.string().min(1),
  expert_id: z.string().min(1),
  version: z.number().int().positive(),
  status: z.enum(["draft", "in_debrief", "confirmed", "published", "retired"]),
  title: z.string(),
  language: z.string().min(1),
  steps: z.array(StepSchema),
  guardrails: z.array(GuardrailSchema),
  open_items: z.array(OpenItemSchema),
  confirmed_turn_id: z.string().optional(),
});
export type WorkMap = z.infer<typeof WorkMapSchema>;

export const WorkMapPublishedSchema = z.object({
  workmap_id: z.string().min(1),
  workflow_id: z.string().min(1),
  version: z.number().int().positive(),
});
export type WorkMapPublished = z.infer<typeof WorkMapPublishedSchema>;

export const StepOutcomeSchema = z.enum([
  "independent_correct",
  "prompted_correct",
  "corrected_after_intervention",
  "not_attempted",
]);
export type StepOutcome = z.infer<typeof StepOutcomeSchema>;

export const MasterySummarySchema = z.object({
  session_id: z.string().min(1),
  workmap_id: z.string().min(1),
  learner_id: z.string().min(1),
  steps: z.array(
    z.object({
      step_id: z.string().min(1),
      key: z.string(),
      title: z.string(),
      outcome: StepOutcomeSchema,
    }),
  ),
  practice_next: z.array(
    z.object({
      step_id: z.string().optional(),
      guardrail_id: z.string().optional(),
      reason: z.string(),
    }),
  ),
  counts: z.object({
    independent_correct: z.number().int().nonnegative(),
    prompted_correct: z.number().int().nonnegative(),
    corrected_after_intervention: z.number().int().nonnegative(),
    not_attempted: z.number().int().nonnegative(),
  }),
});
export type MasterySummary = z.infer<typeof MasterySummarySchema>;
