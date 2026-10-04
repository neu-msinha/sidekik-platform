import type { z } from "zod";
import { AgentCommandSchema } from "./contracts/commands.js";
import { envelopeSchema, type ServiceName } from "./contracts/envelope.js";
import { SessionLifecycleSchema } from "./contracts/lifecycle.js";
import { DomEventSchema, ScreenEventSchema } from "./contracts/screen.js";
import { SpeechSignalSchema, TranscriptTurnSchema } from "./contracts/transcript.js";
import { UsageRecordSchema } from "./contracts/usage.js";
import { WorkMapPublishedSchema } from "./contracts/workmap.js";

/** Redis Stream keys (ARCHITECTURE §4.2). */
export const STREAMS = {
  lifecycle: "sk:session.lifecycle",
  turns: "sk:transcript.turns",
  speech: "sk:speech.signals",
  dom: "sk:dom.events",
  screen: "sk:screen.events",
  commands: "sk:agent.commands",
  workmapPublished: "sk:workmap.published",
  usage: "sk:usage",
} as const;
export type StreamName = keyof typeof STREAMS;
export type StreamKey = (typeof STREAMS)[StreamName];

/** Dead-letter stream for events that failed every retry. */
export const DLQ_STREAM = "sk:dlq";
/** Approximate cap passed to XADD MAXLEN ~. */
export const STREAM_MAXLEN = 10_000;

/** `Envelope.type` used for events on each stream. */
export const EVENT_TYPES = {
  "sk:session.lifecycle": "session.lifecycle",
  "sk:transcript.turns": "transcript.turn",
  "sk:speech.signals": "speech.signal",
  "sk:dom.events": "dom.event",
  "sk:screen.events": "screen.event",
  "sk:agent.commands": "agent.command",
  "sk:workmap.published": "workmap.published",
  "sk:usage": "usage",
} as const satisfies Record<StreamKey, string>;

/** Payload (`Envelope.data`) schema for each stream. */
export const STREAM_SCHEMAS = {
  "sk:session.lifecycle": SessionLifecycleSchema,
  "sk:transcript.turns": TranscriptTurnSchema,
  "sk:speech.signals": SpeechSignalSchema,
  "sk:dom.events": DomEventSchema,
  "sk:screen.events": ScreenEventSchema,
  "sk:agent.commands": AgentCommandSchema,
  "sk:workmap.published": WorkMapPublishedSchema,
  "sk:usage": UsageRecordSchema,
} as const satisfies Record<StreamKey, z.ZodType>;

export type StreamPayload<K extends StreamKey> = z.infer<(typeof STREAM_SCHEMAS)[K]>;

/** Full envelope schema for events on a stream. */
export function streamEnvelopeSchema<K extends StreamKey>(stream: K) {
  return envelopeSchema(STREAM_SCHEMAS[stream]);
}

/** Default consumer group: one per service. */
export function defaultGroup(service: ServiceName): string {
  return service;
}
