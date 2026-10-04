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

// ---------------------------------------------------------------------------
// Page side (ARCHITECTURE §4.5): what the browser page does with each command.
// ---------------------------------------------------------------------------

/** Prefix that tells the ElevenLabs agent a user message came from Sidekik, not the person. */
export const SIDEKIK_PREFIX = "[SIDEKIK]";

export type PageAction =
  /** conversation.sendUserMessage(text): the agent acts on it and speaks. */
  | { kind: "user_message"; text: string }
  /** conversation.sendContextualUpdate(text): background context, never spoken. */
  | { kind: "contextual_update"; text: string }
  /** UI only (clip overlay, off-record badge, new EL session): nothing is sent to the agent. */
  | { kind: "ui" };

/** The exact message the page sends for a command, per ARCHITECTURE §4.5. */
export function pageAction(cmd: AgentCommand): PageAction {
  switch (cmd.type) {
    case "ctx":
      return { kind: "contextual_update", text: oneLine(cmd.text) };
    case "ask":
      return userMessage("ASK", cmd.text);
    case "followup":
      return userMessage("FOLLOWUP", cmd.text);
    case "teachback":
      return userMessage("TEACHBACK", cmd.script);
    case "predict":
      return userMessage("PREDICT", cmd.prompt);
    case "intervene":
      return userMessage("INTERVENE", cmd.text);
    case "summary":
      return userMessage("SUMMARY", summaryText(cmd.mastery));
    case "replay":
    case "offrecord":
    case "phase":
      return { kind: "ui" };
  }
}

/** The `sendUserMessage` string for a command, or null when the page doesn't message the agent. */
export function toPageMessage(cmd: AgentCommand): string | null {
  const action = pageAction(cmd);
  return action.kind === "user_message" ? action.text : null;
}

function userMessage(tag: string, body: string): PageAction {
  return { kind: "user_message", text: `${SIDEKIK_PREFIX} ${tag}: ${oneLine(body)}` };
}

/** Agent messages are one line: newlines and runs of whitespace collapse to single spaces. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Spoken summary of a tutor session: counts first, then what to practice next. */
function summaryText(m: z.infer<typeof MasterySummarySchema>): string {
  const c = m.counts;
  const total = c.independent_correct + c.prompted_correct + c.corrected_after_intervention + c.not_attempted;
  const parts = [
    `${c.independent_correct} of ${total} steps done independently, ${c.prompted_correct} with a prompt, ` +
      `${c.corrected_after_intervention} corrected after an intervention, ${c.not_attempted} not attempted.`,
  ];
  if (m.practice_next.length > 0) parts.push(`Practice next: ${m.practice_next.map((p) => p.reason).join("; ")}.`);
  return parts.join(" ");
}
