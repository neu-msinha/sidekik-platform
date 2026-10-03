import { z } from "zod";
import { PhaseSchema } from "./lifecycle.js";
import { MasterySummarySchema } from "./workmap.js";

export const QTypeSchema = z.enum(["exception", "limit", "other", "stop_and_ask", "why"]);
export type QType = z.infer<typeof QTypeSchema>;

export const AgentCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ctx"), text: z.string(), context_id: z.string().optional() }),
  z.object({ type: z.literal("ask"), question_id: z.string().min(1), text: z.string().min(1), qtype: QTypeSchema }),
  z.object({ type: z.literal("followup"), open_item_id: z.string().min(1), text: z.string().min(1) }),
  z.object({ type: z.literal("teachback"), workmap_id: z.string().min(1), script: z.string().min(1) }),
  z.object({ type: z.literal("predict"), step_id: z.string().min(1), prompt: z.string().min(1) }),
  z.object({
    type: z.literal("intervene"),
    guardrail_id: z.string().min(1),
    step_id: z.string().min(1),
    text: z.string().min(1),
    field: z.string().optional(),
  }),
  z.object({
    type: z.literal("replay"),
    step_id: z.string().min(1),
    clip_url: z.string().min(1),
    quote: z.string(),
    label: z.string(),
  }),
  z.object({ type: z.literal("summary"), mastery: MasterySummarySchema }),
  z.object({ type: z.literal("offrecord"), on: z.boolean() }),
  z.object({
    type: z.literal("phase"),
    phase: PhaseSchema,
    conversation_token: z.string().min(1),
    agent_id: z.string().min(1),
    dynamic_variables: z.record(z.string(), z.string()),
  }),
]);
export type AgentCommand = z.infer<typeof AgentCommandSchema>;
export type AgentCommandType = AgentCommand["type"];
