import { Redis } from "ioredis";
import type { Logger } from "pino";
import type { Envelope, ServiceName } from "./contracts/envelope.js";
import {
  DLQ_STREAM,
  STREAM_MAXLEN,
  defaultGroup,
  streamEnvelopeSchema,
  type StreamKey,
  type StreamPayload,
} from "./streams.js";

/** Field name under which the JSON envelope is stored in each stream entry. */
const FIELD = "ev";
/** How long a handled event id is remembered for de-duplication. */
const SEEN_TTL_SEC = 24 * 60 * 60;

export type ConsumeOptions = {
  /** Consumer group; defaults to the service name. */
  group?: string;
  /** Max entries per XREADGROUP. */
  batch?: number;
  /** XREADGROUP BLOCK in ms. */
  blockMs?: number;
  /** Attempts per event before it goes to the dead-letter stream. */
  maxAttempts?: number;
  /** Delay between attempts in ms (multiplied by the attempt number). */
  retryDelayMs?: number;
};

export type EventHandler<K extends StreamKey> = (ev: Envelope<StreamPayload<K>>) => Promise<void>;

export interface Bus {
  /** Validates and appends an event (XADD MAXLEN ~ 10000). Returns the stream entry id. */
  publish<K extends StreamKey>(stream: K, ev: Envelope<StreamPayload<K>>): Promise<string>;
  /**
   * Reads the stream through a consumer group, one event at a time, in order.
   * Invalid events are logged and acked. Failed handlers are retried, then the
   * event is copied to `sk:dlq` and acked. Handled event ids are remembered so a
   * redelivered event is skipped. Returns a function that stops this consumer.
   */
  consume<K extends StreamKey>(stream: K, handler: EventHandler<K>, opts?: ConsumeOptions): () => void;
  close(): Promise<void>;
}

export type CreateBusOptions = {
  logger?: Logger;
  /** Consumer name inside the group. Stable by default so a restart drains its own pending entries. */
  consumerName?: string;
  /**
   * Reconnect attempts a publish waits for before it fails (default 3). Without a limit a publish
   * waits forever while Redis is down, which blows every caller's latency budget.
   */
  publishRetries?: number;
};

export function createBus(redisUrl: string, service: ServiceName, options: CreateBusOptions = {}): Bus {
  const log = options.logger;
  const consumerName = options.consumerName ?? service;
  const pub = new Redis(redisUrl, { maxRetriesPerRequest: options.publishRetries ?? 3 });
  const consumers = new Set<{ stop: () => void; done: Promise<void> }>();
  let closed = false;

  async function publish<K extends StreamKey>(stream: K, ev: Envelope<StreamPayload<K>>): Promise<string> {
    const parsed = streamEnvelopeSchema(stream).parse(ev);
    const id = await pub.xadd(stream, "MAXLEN", "~", STREAM_MAXLEN, "*", FIELD, JSON.stringify(parsed));
    if (!id) throw new Error(`XADD to ${stream} returned no id`);
    return id;
  }

  function consume<K extends StreamKey>(stream: K, handler: EventHandler<K>, opts: ConsumeOptions = {}): () => void {
    if (closed) throw new Error("bus is closed");
    const group = opts.group ?? defaultGroup(service);
    const batch = opts.batch ?? 10;
    const blockMs = opts.blockMs ?? 1000;
    const maxAttempts = opts.maxAttempts ?? 3;
    const retryDelayMs = opts.retryDelayMs ?? 100;
    const schema = streamEnvelopeSchema(stream);
    // XREADGROUP BLOCK holds its connection, so every consumer gets its own.
    const conn = new Redis(redisUrl, { maxRetriesPerRequest: null });
    let running = true;

    const seenKey = (eventId: string) => `sk:seen:${group}:${stream}:${eventId}`;

    async function handleEntry(entryId: string, fields: string[] | null): Promise<void> {
      const raw = fieldValue(fields, FIELD);
      let ev: Envelope<StreamPayload<K>>;
      try {
        ev = schema.parse(JSON.parse(raw ?? "null")) as Envelope<StreamPayload<K>>;
      } catch (err) {
        log?.warn({ stream, group, entry_id: entryId, err }, "bus: invalid event, acking without handling");
        await conn.xack(stream, group, entryId);
        return;
      }

      const ctx = { stream, group, entry_id: entryId, event_id: ev.id, session_id: ev.session_id, org_id: ev.org_id };
      if (await pub.exists(seenKey(ev.id))) {
        log?.debug(ctx, "bus: duplicate event, skipping");
        await conn.xack(stream, group, entryId);
        return;
      }

      let lastErr: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const started = Date.now();
        try {
          await handler(ev);
          await pub.set(seenKey(ev.id), "1", "EX", SEEN_TTL_SEC);
          await conn.xack(stream, group, entryId);
          log?.debug({ ...ctx, latency_ms: Date.now() - started }, "bus: handled");
          return;
        } catch (err) {
          lastErr = err;
          log?.warn({ ...ctx, attempt, err, latency_ms: Date.now() - started }, "bus: handler failed");
          if (attempt < maxAttempts && running) await sleep(retryDelayMs * attempt);
        }
      }

      await pub.xadd(
        DLQ_STREAM,
        "MAXLEN",
        "~",
        STREAM_MAXLEN,
        "*",
        "stream",
        stream,
        "group",
        group,
        "entry_id",
        entryId,
        "error",
        errorMessage(lastErr),
        FIELD,
        raw ?? "",
      );
      await conn.xack(stream, group, entryId);
      log?.error({ ...ctx, err: lastErr }, "bus: event dead-lettered");
    }

    async function loop(): Promise<void> {
      await ensureGroup(conn, stream, group);
      // "0" replays this consumer's pending entries (e.g. after a crash), ">" reads new ones.
      let cursor = "0";
      while (running) {
        let reply: [string, [string, string[] | null][]][] | null;
        try {
          reply = (await conn.xreadgroup(
            "GROUP",
            group,
            consumerName,
            "COUNT",
            batch,
            "BLOCK",
            blockMs,
            "STREAMS",
            stream,
            cursor,
          )) as [string, [string, string[] | null][]][] | null;
        } catch (err) {
          if (!running) return;
          if (errorMessage(err).includes("NOGROUP")) {
            // The stream or group is gone (Redis flushed or restarted without persistence): recreate
            // the group from the start of the new stream, so nothing published since is skipped.
            log?.warn({ stream, group }, "bus: consumer group missing, recreating it");
            try {
              await ensureGroup(conn, stream, group, "0");
              cursor = "0";
              continue;
            } catch (groupErr) {
              log?.error({ stream, group, err: groupErr }, "bus: recreating the consumer group failed");
            }
          } else {
            log?.error({ stream, group, err }, "bus: XREADGROUP failed, retrying");
          }
          await sleep(500);
          continue;
        }
        const entries = reply?.[0]?.[1] ?? [];
        if (cursor === "0" && entries.length === 0) {
          cursor = ">";
          continue;
        }
        for (const [entryId, fields] of entries) {
          if (!running) return;
          // A pending entry whose payload was trimmed comes back with null fields.
          if (fields === null) {
            await conn.xack(stream, group, entryId);
            continue;
          }
          try {
            await handleEntry(entryId, fields);
          } catch (err) {
            // Redis failed mid-handling; the entry stays pending and is replayed on restart.
            log?.error({ stream, group, entry_id: entryId, err }, "bus: failed to settle entry");
          }
        }
      }
    }

    const done = loop()
      .catch((err) => log?.error({ stream, group, err }, "bus: consumer stopped on error"))
      .finally(() => conn.disconnect());

    const entry = {
      stop: () => {
        running = false;
      },
      done,
    };
    consumers.add(entry);
    return () => {
      entry.stop();
      consumers.delete(entry);
    };
  }

  async function close(): Promise<void> {
    closed = true;
    const pending = [...consumers];
    for (const c of pending) c.stop();
    await Promise.all(pending.map((c) => c.done));
    consumers.clear();
    await pub.quit();
  }

  return { publish, consume, close };
}

async function ensureGroup(conn: Redis, stream: string, group: string, from: "$" | "0" = "$"): Promise<void> {
  try {
    await conn.xgroup("CREATE", stream, group, from, "MKSTREAM");
  } catch (err) {
    if (!errorMessage(err).includes("BUSYGROUP")) throw err;
  }
}

function fieldValue(fields: string[] | null, name: string): string | undefined {
  if (!fields) return undefined;
  for (let i = 0; i + 1 < fields.length; i += 2) {
    if (fields[i] === name) return fields[i + 1];
  }
  return undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
