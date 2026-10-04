import { readFileSync } from "node:fs";
import jsonLogic from "json-logic-js";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, renderFixture, type FixtureLine } from "../dev/fixtures/build.js";
import { readFixture, replayFixture, resolveFixture } from "../dev/replay.js";
import { DEMO, GUARDRAILS } from "../dev/seed/demo.js";
import { createBus, STREAMS, streamEnvelopeSchema, type DomEvent, type InvoiceState, type SessionLifecycle, type StreamKey } from "../src/index.js";

const tripped = (state: InvoiceState) => GUARDRAILS.filter((g) => jsonLogic.apply(g.rule as jsonLogic.RulesLogic, state)).map((g) => g.key);
const data = <T>(lines: FixtureLine[], stream: StreamKey) => lines.filter((l) => l.stream === stream).map((l) => ({ t: l.ev.t_ms, d: l.ev.data as T }));

describe.each(Object.entries(FIXTURES))("%s", (name, build) => {
  const lines = readFixture(resolveFixture(`fixtures/${name}`));

  it("is up to date with dev/fixtures/build.ts (run `pnpm fixtures:gen`)", () => {
    expect(readFileSync(resolveFixture(`fixtures/${name}`), "utf8")).toBe(renderFixture(build()));
  });

  it("every event validates against its stream's contract", () => {
    for (const l of lines) expect(() => streamEnvelopeSchema(l.stream).parse(l.ev), `${l.stream} @${l.ev.t_ms}`).not.toThrow();
  });

  it("is one session of the demo org, in time order, from started to ended", () => {
    expect(new Set(lines.map((l) => l.ev.session_id)).size).toBe(1);
    expect(lines.every((l) => l.ev.org_id === DEMO.orgId)).toBe(true);
    expect(lines.every((l, i) => i === 0 || l.ev.t_ms >= lines[i - 1]!.ev.t_ms)).toBe(true);
    expect(new Set(lines.map((l) => l.ev.id)).size).toBe(lines.length);
    const life = data<SessionLifecycle>(lines, STREAMS.lifecycle).map((x) => x.d.event);
    expect(life[0]).toBe("started");
    expect(life.at(-1)).toBe("ended");
  });

  it("only carries producer inputs, never agent commands or usage", () => {
    expect(lines.some((l) => l.stream === STREAMS.commands || l.stream === STREAMS.usage)).toBe(false);
  });

  it("speech starts and ends pair up", () => {
    let user = 0;
    for (const l of lines.filter((x) => x.stream === STREAMS.speech)) {
      const k = (l.ev.data as { kind: string }).kind;
      if (k === "user_speech_start") user++;
      if (k === "user_speech_end") user--;
      expect(user === 0 || user === 1, `@${l.ev.t_ms}`).toBe(true);
    }
    expect(user).toBe(0);
  });
});

describe("capture_sabine story", () => {
  const lines = readFixture(resolveFixture("fixtures/capture_sabine.jsonl"));
  it("goes capture → building → debrief → confirmed, on the seeded workflow", () => {
    const life = data<SessionLifecycle>(lines, STREAMS.lifecycle).map((x) => x.d);
    expect(life.map((d) => d.phase)).toEqual(["capture", "building", "debrief", "confirmed", "done"]);
    expect(life.every((d) => d.workflow_id === DEMO.workflowId && d.kind === "capture" && d.language === "de")).toBe(true);
  });
  it("the debrief has ≥ 3 follow-ups and a teach-back the expert confirms", () => {
    const debriefStart = data<SessionLifecycle>(lines, STREAMS.lifecycle).find((x) => x.d.phase === "debrief")!.t;
    const agent = data<{ role: string; text: string }>(lines, STREAMS.turns).filter((x) => x.t > debriefStart && x.d.role === "agent");
    expect(agent.length).toBeGreaterThanOrEqual(4);
    expect(data<{ role: string; text: string }>(lines, STREAMS.turns).at(-1)!.d.text).toBe("Ja, genau so.");
  });
});

describe("tutor_lena story (the catch before save)", () => {
  const lines = readFixture(resolveFixture("fixtures/tutor_lena.jsonl"));
  const saves = data<DomEvent>(lines, STREAMS.dom).filter((x) => x.d.kind === "save_attempt");
  it("runs on the published demo Work Map", () => {
    expect(data<SessionLifecycle>(lines, STREAMS.lifecycle)[0]!.d).toMatchObject({ kind: "tutor", phase: "tutoring", workmap_id: DEMO.workmapId });
  });
  it("#4510 on 4711 trips G1 + G3; after recoding to 0400 without an asset number, G2 + G3", () => {
    expect(saves.map((s) => [s.d.record?.id, tripped(s.d.state!)])).toEqual([
      ["4510", ["G1", "G3"]],
      ["4510", ["G2", "G3"]],
    ]);
  });
  it("#4511 is Kranbau in December: G4", () => {
    const opened = data<DomEvent>(lines, STREAMS.dom).find((x) => x.d.kind === "record_open" && x.d.record?.id === "4511")!;
    expect(tripped(opened.d.state!)).toEqual(["G4"]);
  });
});

describe("replayFixture over Redis", () => {
  const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/13";
  let admin: Redis;
  beforeAll(async () => {
    admin = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
    await admin.connect().catch(() => {
      throw new Error(`Redis not reachable at ${REDIS_URL}. Run: docker compose -f dev/docker-compose.yml up -d redis`);
    });
    await admin.flushdb();
  });
  afterAll(async () => admin?.quit());

  it("publishes every event in order with a fresh UUID session and fresh ids", async () => {
    const lines = readFixture(resolveFixture("fixtures/tutor_lena.jsonl"));
    const bus = createBus(REDIS_URL, "gateway");
    const sessions = await replayFixture(bus, lines, { speed: Infinity });
    const sid = sessions.get("fixture-tutor-lena")!;
    expect(sid).toMatch(/^[0-9a-f-]{36}$/);

    let total = 0;
    for (const stream of new Set(lines.map((l) => l.stream))) {
      const entries = await admin.xrange(stream, "-", "+");
      const evs = entries.map(([, f]) => JSON.parse(f[1]!) as { session_id: string; t_ms: number; id: string });
      expect(evs.every((e) => e.session_id === sid)).toBe(true);
      expect(evs.map((e) => e.t_ms)).toEqual(lines.filter((l) => l.stream === stream).map((l) => l.ev.t_ms));
      expect(evs.some((e) => lines.some((l) => l.ev.id === e.id))).toBe(false);
      total += evs.length;
    }
    expect(total).toBe(lines.length);
    await bus.close();
  });

  it("honours speed: waits between events, scaled", async () => {
    const lines = readFixture(resolveFixture("fixtures/tutor_lena.jsonl")).slice(0, 5);
    const waits: number[] = [];
    const bus = createBus(REDIS_URL, "gateway");
    await replayFixture(bus, lines, { speed: 10, sleep: async (ms) => void waits.push(ms) });
    await bus.close();
    const gaps = lines.slice(1).map((l, i) => (l.ev.t_ms - lines[i]!.ev.t_ms) / 10).filter((g) => g > 0);
    expect(waits).toEqual(gaps);
  });
});
