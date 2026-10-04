/**
 * Integration smoke test for the H6 / H14 / H18 checkpoints (ARCHITECTURE §11):
 * checks every service's /healthz, replays the checkpoint's fixture as a fresh session,
 * then checks what the services published for that session against the checkpoint.
 *
 *   dev/smoke.sh                 # health only
 *   dev/smoke.sh h6              # Checkpoint 1: brain asks grounded questions at pauses
 *   dev/smoke.sh h14             # Checkpoint 2: debrief follow-ups, teach-back, Work Map published
 *   dev/smoke.sh h18             # Checkpoint 3: presave catches #4510, tutor intervenes, replay, summary
 *
 * Options: --speed 10  --wait 15  --services brain,mapper (override required set)  --min-asks 3
 * Env: REDIS_URL, <SERVICE>_URL (e.g. BRAIN_URL; default http://localhost:<port>), SK_INTERNAL_TOKEN (h18).
 */
import { parseArgs } from "node:util";
import { Redis } from "ioredis";
import { createBus, STREAMS, type AgentCommand } from "../src/index.js";
import { REQUIRED, SERVICES, FIXTURE, evaluate, type Observed, type Service, type Stage } from "./smoke-checks.js";
import { readFixture, replayFixture, resolveFixture } from "./replay.js";
import { INVOICES } from "./seed/demo.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    speed: { type: "string", default: "10" },
    wait: { type: "string", default: "15" },
    services: { type: "string" },
    "min-asks": { type: "string", default: "3" },
    redis: { type: "string", default: process.env.REDIS_URL ?? "redis://localhost:6379" },
  },
});
const stage = (positionals[0] ?? "health") as Stage | "health";
if (!["health", "h6", "h14", "h18"].includes(stage)) {
  console.error("usage: dev/smoke.sh [health|h6|h14|h18] [--speed 10] [--wait 15] [--services a,b] [--min-asks 3]");
  process.exit(2);
}

const urlOf = (s: Service) => (process.env[`${s.toUpperCase()}_URL`] ?? `http://localhost:${SERVICES[s]}`).replace(/\/+$/, "");
const mark = (ok: boolean) => (ok ? "PASS" : "FAIL");
let failed = false;

// ---- 1. health --------------------------------------------------------------
const required = new Set<Service>(
  values.services ? (values.services.split(",").map((s) => s.trim()) as Service[]) : stage === "health" ? [] : REQUIRED[stage],
);
console.log(`\n== health${required.size ? ` (required: ${[...required].join(", ")})` : ""}`);
for (const s of Object.keys(SERVICES) as Service[]) {
  let status = "down";
  let detail = "";
  try {
    const res = await fetch(`${urlOf(s)}/healthz`, { signal: AbortSignal.timeout(2000) });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; version?: string; deps?: Record<string, string> };
    status = res.ok && body.ok !== false ? "ok" : `unhealthy (${res.status})`;
    detail = [body.version && `v${body.version}`, body.deps && Object.entries(body.deps).map(([k, v]) => `${k}:${v}`).join(" ")].filter(Boolean).join("  ");
  } catch {
    // stays "down"
  }
  const isRequired = required.has(s);
  if (isRequired && status !== "ok") failed = true;
  const tag = status === "ok" ? "ok  " : isRequired ? "FAIL" : "--  ";
  console.log(`  ${tag} ${s.padEnd(11)} ${urlOf(s).padEnd(24)} ${status === "ok" ? detail : status}`);
}
if (stage === "health" || failed) {
  if (failed) console.log("\nrequired services are down: fix them before the scripted session");
  process.exit(failed ? 1 : 0);
}

// ---- 2. scripted session ---------------------------------------------------
const speed = values.speed === "max" ? Infinity : Number(values.speed);
const fixture = resolveFixture(FIXTURE[stage]);
const lines = readFixture(fixture);
const redis = new Redis(values.redis);
const lastId = async (stream: string) => (await redis.xrevrange(stream, "+", "-", "COUNT", 1))[0]?.[0] ?? "0-0";
const since = { commands: await lastId(STREAMS.commands), published: await lastId(STREAMS.workmapPublished) };

console.log(`\n== scripted session: ${FIXTURE[stage]} (${lines.length} events, ${values.speed}x)`);
const bus = createBus(values.redis, "gateway");
const sessions = await replayFixture(bus, lines, { speed });
await bus.close();
const sid = [...sessions.values()][0]!;
console.log(`  session ${sid}; waiting ${values.wait}s for services to finish`);
await new Promise((r) => setTimeout(r, Number(values.wait) * 1000));

const after = async (stream: string, from: string) =>
  (await redis.xrange(stream, `(${from}`, "+")).map(([, f]) => JSON.parse(f[f.indexOf("ev") + 1] ?? "null") as { session_id: string; producer: string; t_ms: number; data: unknown });
const observed: Observed = {
  commands: (await after(STREAMS.commands, since.commands))
    .filter((e) => e?.session_id === sid)
    .map((e) => ({ producer: e.producer, t_ms: e.t_ms, cmd: e.data as AgentCommand })),
  workmapsPublished: (await after(STREAMS.workmapPublished, since.published)).filter((e) => e?.session_id === sid).length,
};
redis.disconnect();

if (stage === "h18") {
  const started = performance.now();
  try {
    const res = await fetch(`${urlOf("tutor")}/internal/presave`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-token": process.env.SK_INTERNAL_TOKEN ?? "" },
      body: JSON.stringify({ session_id: sid, state: INVOICES["4510"] }),
      signal: AbortSignal.timeout(2000),
    });
    const body = (await res.json()) as { allow: boolean; guardrail_id?: string; quote?: string };
    observed.presave = res.ok ? { ...body, latency_ms: Math.round(performance.now() - started) } : { error: `HTTP ${res.status}` };
  } catch (err) {
    observed.presave = { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---- 3. checks ---------------------------------------------------------------
console.log(`\n== ${stage} checks`);
for (const c of observed.commands) {
  const text = "text" in c.cmd ? c.cmd.text : "prompt" in c.cmd ? c.cmd.prompt : "";
  console.log(`  ${(c.t_ms / 1000).toFixed(1).padStart(6)}s  ${c.producer.padEnd(10)} ${c.cmd.type.padEnd(10)} ${String(text).slice(0, 70)}`);
}
for (const check of evaluate(stage, observed, { minAsks: Number(values["min-asks"]) })) {
  if (!check.pass) failed = true;
  console.log(`  ${mark(check.pass)}  ${check.name}  (${check.detail})`);
}
console.log(failed ? "\nSMOKE FAILED" : "\nSMOKE PASSED");
process.exit(failed ? 1 : 0);
