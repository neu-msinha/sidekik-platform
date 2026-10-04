/**
 * Request/response schemas for the HTTP and WebSocket interfaces between services and the page
 * (ARCHITECTURE §4.3, each repo's docs/DESIGN.md). Bus payloads live in the other contract files.
 *
 * Shapes marked "draft" are only sketched in the docs; their owner should confirm or tighten them.
 */
import { z } from "zod";
import { DecisionRequestSchema, DecisionResponseSchema } from "./decisions.js";
import { PhaseSchema, SessionKindSchema, SessionModeSchema } from "./lifecycle.js";
import { DomEventSchema, InvoiceStateSchema } from "./screen.js";
import { SpeechSignalSchema, TranscriptTurnSchema } from "./transcript.js";

const Id = z.string().min(1);
const JobAccepted = z.object({ job_id: Id });

// ---------------------------------------------------------------- shared

/** ElevenLabs conversation start data returned to the page. */
export const ElSessionSchema = z.object({
  conversation_token: Id,
  agent_id: Id,
  dynamic_variables: z.record(z.string(), z.string()),
});
export type ElSession = z.infer<typeof ElSessionSchema>;

/** Pre-save check result (tutor computes it; gateway relays it to the page). */
export const PresaveResponseSchema = z.object({
  allow: z.boolean(),
  guardrail_id: z.string().optional(),
  quote: z.string().optional(),
  step_id: z.string().optional(),
});
export type PresaveResponse = z.infer<typeof PresaveResponseSchema>;

export const OffRecordSourceSchema = z.enum(["ui", "agent", "chat", "brain", "retroactive"]);

// ---------------------------------------------------------------- gateway: public (/v1, Supabase JWT)

export const CreateSessionRequestSchema = z.object({
  workflow_id: Id,
  kind: SessionKindSchema,
  mode: SessionModeSchema,
  language: z.string().min(1),
  workmap_id: z.string().optional(),
});
export const CreateSessionResponseSchema = z.object({
  session_id: Id,
  sk_token: Id,
  el: ElSessionSchema,
  ingest_url: z.string().min(1),
});

export const ConsentRequestSchema = z.object({
  text_version: z.string().min(1),
  scopes: z.array(z.enum(["audio", "screen", "storage"])).min(1),
});
export const TaskDoneRequestSchema = z.object({ event: z.literal("task_done") });
export const OffRecordRequestSchema = z.object({
  on: z.boolean(),
  source: z.enum(["ui", "agent", "chat"]),
  /** Retroactive: also delete the last N seconds (ARCHITECTURE gateway §4). */
  back_s: z.number().int().positive().optional(),
});
export const MeetingBotRequestSchema = z.object({ meeting_url: z.url() });
export const PresaveRequestSchema = z.object({ state: InvoiceStateSchema });
export const PublishWorkmapResponseSchema = JobAccepted;
export const ClipUrlResponseSchema = z.object({ url: z.url() });
export const ReplayRequestSchema = z.object({ speed: z.number().positive().default(1) });
export const AgentHostClaimRequestSchema = z.object({ t: Id });
export const AgentHostClaimResponseSchema = z.object({ sk_token: Id, el: ElSessionSchema });

// ---------------------------------------------------------------- gateway: page WebSocket /ws/client/:sid

/** Messages the page sends on /ws/client/:sid. `t_ms` is session time. */
export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("turn"), t_ms: z.number().int().nonnegative(), turn: TranscriptTurnSchema.omit({ redacted: true }) }),
  z.object({ type: z.literal("speech"), t_ms: z.number().int().nonnegative(), signal: SpeechSignalSchema }),
  z.object({ type: z.literal("dom"), t_ms: z.number().int().nonnegative(), event: DomEventSchema }),
  /** Agent status / tool-call telemetry: logged only (draft). */
  z.object({ type: z.literal("agent_event"), t_ms: z.number().int().nonnegative(), name: z.string(), payload: z.unknown().optional() }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/** JSON header of each binary frame on /ws/frames/:sid (perception) and /internal/frames/:sid (meetbot). */
export const FrameHeaderSchema = z.object({
  t_ms: z.number().int().nonnegative(),
  reason: z.enum(["tick", "blur", "save", "nav"]),
});
export type FrameHeader = z.infer<typeof FrameHeaderSchema>;

// ---------------------------------------------------------------- gateway: internal (X-Internal-Token)

/** POST /internal/sessions/:id/phase (mapper → gateway). */
export const SetPhaseRequestSchema = z.object({
  phase: PhaseSchema.extract(["debrief", "confirmed"]),
  dynamic_variables: z.record(z.string(), z.string()).optional(),
});
/** POST /internal/sessions/:id/off-record (brain → gateway, after D7). */
export const InternalOffRecordRequestSchema = z.object({
  on: z.boolean(),
  source: OffRecordSourceSchema,
  t_ms: z.number().int().nonnegative().optional(),
});
/** POST /internal/redact (voice → gateway, webhook turns). */
export const RedactRequestSchema = z.object({ text: z.string(), lang: z.string().optional(), keep: z.array(z.string()).optional() });
export const RedactResponseSchema = z.object({ text: z.string() });
/** POST /internal/agent-host-token (meetbot → gateway). */
export const AgentHostTokenRequestSchema = z.object({ sid: Id });
export const AgentHostTokenResponseSchema = z.object({ t: Id });

// ---------------------------------------------------------------- brain

/** POST /internal/decide (mapper, tutor → brain). */
export const DecideRequestSchema = DecisionRequestSchema;
export const DecideResponseSchema = DecisionResponseSchema;

// ---------------------------------------------------------------- voice

/** POST /internal/token (gateway → voice). */
export const VoiceTokenRequestSchema = z.object({
  agent: z.enum(["interviewer", "tutor"]),
  phase: PhaseSchema,
  session_id: Id,
  dynamic_variables: z.record(z.string(), z.string()),
  language: z.string().min(1),
});
export const VoiceTokenResponseSchema = z.object({ conversation_token: Id, agent_id: Id });

// ---------------------------------------------------------------- meetbot

/** POST /internal/bots (gateway → meetbot). DELETE /internal/bots/:sid has no body. */
export const CreateBotRequestSchema = z.object({
  session_id: Id,
  meeting_url: z.url(),
  bot_name: z.string().default("Sidekik (recording)"),
});
export const CreateBotResponseSchema = z.object({ bot_id: Id });

// ---------------------------------------------------------------- perception

/** POST /internal/clips (mapper → perception) → 202 {job_id}. */
export const ClipsRequestSchema = z.object({
  session_id: Id,
  items: z
    .array(
      z.object({
        step_id: Id,
        t_ms: z.number().int().nonnegative(),
        before_s: z.number().nonnegative().default(6),
        after_s: z.number().nonnegative().default(4),
      }),
    )
    .min(1),
});
export const ClipsResponseSchema = JobAccepted;
/** GET /internal/keyframe-url?keyframe_id= → signed URL (5 min). */
export const KeyframeUrlResponseSchema = z.object({ url: z.url() });

// ---------------------------------------------------------------- mapper

/** POST /internal/workmaps/:id/publish → {job_id}. */
export const InternalPublishResponseSchema = JobAccepted;
/** POST /internal/tools/recall_context (gateway → mapper, ElevenLabs tool). */
export const RecallContextRequestSchema = z.object({
  session_id: Id,
  query: z.string().min(1),
  scope: z.enum(["session", "workflow"]),
});
export const RecallContextResponseSchema = z.object({
  snippets: z.array(z.object({ text: z.string(), t_ms: z.number().int().nonnegative().optional(), source: z.string() })),
});

// ---------------------------------------------------------------- tutor

/** POST /internal/presave (gateway → tutor): under 50 ms of compute, no model calls. */
export const InternalPresaveRequestSchema = z.object({ session_id: Id, state: InvoiceStateSchema });
export const InternalPresaveResponseSchema = PresaveResponseSchema;

/** POST /internal/tools/check_guardrails (draft). */
export const CheckGuardrailsRequestSchema = z.object({ session_id: Id, state: InvoiceStateSchema.optional() });
export const CheckGuardrailsResponseSchema = z.object({
  violations: z.array(z.object({ guardrail_id: Id, key: z.string(), description: z.string(), quote: z.string() })),
});
/** POST /internal/tools/get_step (draft): the current or requested step, in the expert's words. */
export const GetStepRequestSchema = z.object({ session_id: Id, step_id: z.string().optional() });
export const GetStepResponseSchema = z.object({
  step_id: Id,
  key: z.string(),
  title: z.string(),
  decision: z.string(),
  quote: z.string().optional(),
  quote_en: z.string().optional(),
});
/** POST /internal/tools/get_expert_moment. */
export const GetExpertMomentRequestSchema = z.object({ step_id: Id });
export const GetExpertMomentResponseSchema = z.object({
  quote: z.string(),
  quote_en: z.string().optional(),
  label: z.string(),
  clip_url: z.url(),
});
