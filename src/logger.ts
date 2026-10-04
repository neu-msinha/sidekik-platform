import { pino, type Logger, type LoggerOptions } from "pino";
import type { Envelope, ServiceName } from "./contracts/envelope.js";

export type { Logger } from "pino";

/** Service logger: JSON lines with `service` on every line. */
export function createLogger(service: ServiceName, options: LoggerOptions = {}): Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? "info",
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...options,
  });
}

/** Child logger carrying `session_id`, `org_id` and `event_id` for one bus event. */
export function eventLogger(logger: Logger, ev: Pick<Envelope<unknown>, "id" | "session_id" | "org_id">): Logger {
  return logger.child({ session_id: ev.session_id, org_id: ev.org_id, event_id: ev.id });
}

/** Child logger carrying `session_id` and `org_id`. */
export function sessionLogger(logger: Logger, session: { session_id: string; org_id: string }): Logger {
  return logger.child({ session_id: session.session_id, org_id: session.org_id });
}
