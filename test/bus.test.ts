import { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBus, DLQ_STREAM, EVENT_TYPES, makeEvent, STREAMS, type Bus, type Envelope, type SpeechSignal } from "../src/index.js";

// Integration tests: need Redis from dev/docker-compose.yml. DB 15 keeps them away from dev data.
const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/15";
const stream = STREAMS.speech;

const speechEvent = (t_ms: number, kind: SpeechSignal["kind"] = "user_speech_end") =>
  makeEvent<SpeechSignal>({
    type: EVENT_TYPES[stream],
    org_id: "org1",
    session_id: "sess1",
    t_ms,
    producer: "gateway",
    data: { kind, source: "sdk" },
  });

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

let admin: Redis;
let bus: Bus;

beforeAll(async () => {
  admin = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await admin.connect();
    await admin.ping();
  } catch {
    throw new Error(`Redis not reachable at ${REDIS_URL}. Run: docker compose -f dev/docker-compose.yml up -d redis`);
  }
});

beforeEach(async () => {
  await admin.flushdb();
  bus = createBus(REDIS_URL, "brain");
});

afterEach(async () => {
  await bus.close();
});

afterAll(async () => {
  await admin.quit();
});

describe("bus", () => {
  it("delivers published events in order and acks them", async () => {
    const got: number[] = [];
    bus.consume(stream, async (ev) => void got.push(ev.t_ms), { blockMs: 100 });
    await waitFor(async () => (await admin.exists(stream)) === 1); // group created with MKSTREAM

    for (const t of [1, 2, 3]) await bus.publish(stream, speechEvent(t));
    await waitFor(() => got.length === 3);

    expect(got).toEqual([1, 2, 3]);
    await waitFor(async () => ((await admin.xpending(stream, "brain")) as [number])[0] === 0);
  });

  it("rejects publishing a payload that doesn't match the stream schema", async () => {
    const bad = { ...speechEvent(1), data: { kind: "shouting", source: "sdk" } } as unknown as Envelope<SpeechSignal>;
    await expect(bus.publish(stream, bad)).rejects.toThrow();
    expect(await admin.exists(stream)).toBe(0);
  });

  it("retries a failing handler and succeeds", async () => {
    let calls = 0;
    bus.consume(
      stream,
      async () => {
        calls++;
        if (calls < 3) throw new Error("flaky");
      },
      { blockMs: 100, retryDelayMs: 5 },
    );
    await waitFor(async () => (await admin.exists(stream)) === 1);
    await bus.publish(stream, speechEvent(1));

    await waitFor(() => calls === 3);
    await waitFor(async () => ((await admin.xpending(stream, "brain")) as [number])[0] === 0);
    expect(await admin.xlen(DLQ_STREAM)).toBe(0);
  });

  it("dead-letters after 3 failed attempts and keeps consuming", async () => {
    const seen: number[] = [];
    bus.consume(
      stream,
      async (ev) => {
        seen.push(ev.t_ms);
        if (ev.t_ms === 1) throw new Error("boom");
      },
      { blockMs: 100, retryDelayMs: 5 },
    );
    await waitFor(async () => (await admin.exists(stream)) === 1);
    await bus.publish(stream, speechEvent(1));
    await bus.publish(stream, speechEvent(2));

    await waitFor(() => seen.includes(2));
    expect(seen).toEqual([1, 1, 1, 2]);
    const dlq = await admin.xrange(DLQ_STREAM, "-", "+");
    expect(dlq).toHaveLength(1);
    const fields = dlq[0]![1];
    expect(fields).toContain("boom");
    expect(fields).toContain(stream);
  });

  it("acks invalid entries without calling the handler", async () => {
    let calls = 0;
    bus.consume(stream, async () => void calls++, { blockMs: 100 });
    await waitFor(async () => (await admin.exists(stream)) === 1);
    await admin.xadd(stream, "*", "ev", "{not json");
    await bus.publish(stream, speechEvent(5));

    await waitFor(() => calls === 1);
    await waitFor(async () => ((await admin.xpending(stream, "brain")) as [number])[0] === 0);
  });

  it("skips an event id it has already handled", async () => {
    const got: string[] = [];
    bus.consume(stream, async (ev) => void got.push(ev.id), { blockMs: 100 });
    await waitFor(async () => (await admin.exists(stream)) === 1);
    const ev = speechEvent(1);
    await bus.publish(stream, ev);
    await bus.publish(stream, ev); // same envelope id, new stream entry
    await bus.publish(stream, speechEvent(2));

    await waitFor(() => got.length === 2);
    await new Promise((r) => setTimeout(r, 150));
    expect(got).toHaveLength(2);
    expect(got[0]).toBe(ev.id);
  });

  it("separate groups each get every event", async () => {
    const a: number[] = [];
    const b: number[] = [];
    bus.consume(stream, async (ev) => void a.push(ev.t_ms), { blockMs: 100 });
    const other = createBus(REDIS_URL, "tutor");
    other.consume(stream, async (ev) => void b.push(ev.t_ms), { blockMs: 100 });
    await waitFor(async () => ((await admin.xinfo("GROUPS", stream).catch(() => [])) as unknown[]).length === 2);

    await bus.publish(stream, speechEvent(7));
    await waitFor(() => a.length === 1 && b.length === 1);
    await other.close();
  });

  it("replays its own pending entries after a restart", async () => {
    // Simulate a crash: an entry was delivered to "brain" but never acked.
    await admin.xgroup("CREATE", stream, "brain", "$", "MKSTREAM");
    await admin.xadd(stream, "*", "ev", JSON.stringify(speechEvent(42)));
    await admin.xreadgroup("GROUP", "brain", "brain", "COUNT", 10, "STREAMS", stream, ">");
    expect(((await admin.xpending(stream, "brain")) as [number])[0]).toBe(1);

    const got: number[] = [];
    bus.consume(stream, async (ev) => void got.push(ev.t_ms), { blockMs: 100 });
    await waitFor(() => got.length === 1);
    expect(got).toEqual([42]);
  });

  it("close() stops consumers", async () => {
    let calls = 0;
    const local = createBus(REDIS_URL, "mapper");
    local.consume(stream, async () => void calls++, { blockMs: 100 });
    await waitFor(async () => (await admin.exists(stream)) === 1);
    await local.close();
    await bus.publish(stream, speechEvent(1));
    await new Promise((r) => setTimeout(r, 250));
    expect(calls).toBe(0);
    expect(() => local.consume(stream, async () => {})).toThrow(/closed/);
  });

  it("recreates its consumer group after Redis loses it (flush) and keeps delivering", async () => {
    const got: number[] = [];
    bus.consume(stream, async (ev) => void got.push(ev.t_ms), { blockMs: 100 });
    await waitFor(async () => (await admin.exists(stream)) === 1);
    await admin.flushdb(); // stream and group gone; XREADGROUP now fails with NOGROUP
    await bus.publish(stream, speechEvent(7));
    await waitFor(() => got.length === 1, 5_000);
    expect(got).toEqual([7]);
  });

  it("fails a publish instead of waiting forever while Redis is unreachable", async () => {
    const down = createBus("redis://127.0.0.1:1/15", "brain", { publishRetries: 1 });
    const started = Date.now();
    await expect(down.publish(stream, speechEvent(1))).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(5_000);
    await down.close();
  });
});
