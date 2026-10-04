import { z } from "zod";
import { newId } from "../ids.js";

export const ServiceNameSchema = z.enum([
  "gateway",
  "perception",
  "brain",
  "mapper",
  "tutor",
  "voice",
  "meetbot",
]);
export type ServiceName = z.infer<typeof ServiceNameSchema>;

/** Wraps a payload schema in the bus envelope every event carries. */
export function envelopeSchema<T extends z.ZodType>(data: T) {
  return z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    v: z.literal(1),
    org_id: z.string().min(1),
    session_id: z.string().min(1),
    t_ms: z.number().int().nonnegative(),
    ts: z.string().min(1),
    producer: ServiceNameSchema,
    data,
  });
}

export type Envelope<T> = {
  id: string;
  type: string;
  v: 1;
  org_id: string;
  session_id: string;
  /** ms since session start */
  t_ms: number;
  /** ISO wall clock */
  ts: string;
  producer: ServiceName;
  data: T;
};

export type MakeEventInput<T> = {
  type: string;
  org_id: string;
  session_id: string;
  t_ms: number;
  producer: ServiceName;
  data: T;
  id?: string;
  ts?: string;
};

export function makeEvent<T>(input: MakeEventInput<T>): Envelope<T> {
  return {
    id: input.id ?? newId(),
    type: input.type,
    v: 1,
    org_id: input.org_id,
    session_id: input.session_id,
    t_ms: input.t_ms,
    ts: input.ts ?? new Date().toISOString(),
    producer: input.producer,
    data: input.data,
  };
}
