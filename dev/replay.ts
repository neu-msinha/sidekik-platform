/**
 * Replays a bus fixture onto Redis Streams so services can run without their teammates.
 *
 *   pnpm replay fixtures/capture_sabine.jsonl              # real time
 *   pnpm replay fixtures/tutor_lena.jsonl --speed 10       # 10x
 *   pnpm replay fixtures/capture_sabine.jsonl --speed max  # no delays
 *   pnpm replay x.jsonl --session <uuid>                   # reuse a session id (e.g. one that exists in Supabase)
 *
 * Each run gets a fresh session id (a UUID, so services can write rows for it) and fresh event ids,
 * so bus de-duplication never swallows a second replay. Envelopes are validated before publishing.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createBus, newId, STREAMS, type Bus, type Envelope, type StreamKey, type StreamPayload } from "../src/index.js";
import type { FixtureLine } from "./fixtures/build.js";

const KNOWN_STREAMS = new Set<string>(Object.values(STREAMS));

export function readFixture(path: string): FixtureLine[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l, i) => {
      const line = JSON.parse(l) as FixtureLine;
      if (!KNOWN_STREAMS.has(line.stream)) throw new Error(`${path}:${i + 1}: unknown stream ${line.stream}`);
      return line;
    });
}

export type ReplayOptions = {
  /** Playback speed; Infinity publishes without delays. */
  speed?: number;
  /** Fixed session id instead of a fresh UUID per fixture session. */
  sessionId?: string;
  onEvent?: (line: FixtureLine, published: Envelope<unknown>) => void;
  sleep?: (ms: number) => Promise<void>;
};

/** Publishes fixture events in t_ms order. Returns fixture session id → replay session id. */
export async function replayFixture(bus: Bus, lines: FixtureLine[], opts: ReplayOptions = {}): Promise<Map<string, string>> {
  const speed = opts.speed ?? 1;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const sessions = new Map<string, string>();
  const sorted = [...lines].sort((a, b) => a.ev.t_ms - b.ev.t_ms);
  let prevT = sorted[0]?.ev.t_ms ?? 0;

  for (const line of sorted) {
    const waitMs = (line.ev.t_ms - prevT) / speed;
    if (Number.isFinite(waitMs) && waitMs > 0) await sleep(waitMs);
    prevT = line.ev.t_ms;

    let sid = sessions.get(line.ev.session_id);
    if (!sid) {
      sid = opts.sessionId ?? randomUUID();
      sessions.set(line.ev.session_id, sid);
    }
    const ev = { ...line.ev, id: newId(), session_id: sid, ts: new Date().toISOString() };
    await bus.publish(line.stream, ev as Envelope<StreamPayload<StreamKey>>);
    opts.onEvent?.(line, ev);
  }
  return sessions;
}

/** Resolves a fixture path relative to the cwd, then to dev/. */
export function resolveFixture(path: string): string {
  if (existsSync(path)) return path;
  const fromDev = fileURLToPath(new URL(path, import.meta.url));
  if (existsSync(fromDev)) return fromDev;
  throw new Error(`fixture not found: ${path}`);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      speed: { type: "string", default: "1" },
      session: { type: "string" },
      redis: { type: "string", default: process.env.REDIS_URL ?? "redis://localhost:6379" },
      quiet: { type: "boolean", default: false },
    },
  });
  const file = positionals[0];
  if (!file) {
    console.error("usage: pnpm replay <fixture.jsonl> [--speed 1|10|max] [--session <uuid>] [--redis <url>] [--quiet]");
    process.exit(2);
  }
  const speed = values.speed === "max" ? Infinity : Number(values.speed);
  if (!(speed > 0)) throw new Error(`--speed must be > 0 or "max", got ${values.speed}`);

  const path = resolveFixture(file);
  const lines = readFixture(path);
  const bus = createBus(values.redis, "gateway");
  console.log(`replaying ${lines.length} events from ${path} at ${speed === Infinity ? "max speed" : `${speed}x`}`);
  const started = Date.now();
  const sessions = await replayFixture(bus, lines, {
    speed,
    ...(values.session ? { sessionId: values.session } : {}),
    onEvent: (line, ev) => {
      if (values.quiet) return;
      const d = ev.data as { event?: string; kind?: string; type?: string; role?: string; text?: string };
      const what = d.event ?? d.kind ?? d.type ?? "";
      const text = d.text ? ` ${d.role}: ${d.text.slice(0, 70)}` : "";
      console.log(`${(ev.t_ms / 1000).toFixed(1).padStart(6)}s  ${line.stream.padEnd(22)} ${what}${text}`);
    },
  });
  await bus.close();
  for (const [from, to] of sessions) console.log(`session ${from} → ${to}`);
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
