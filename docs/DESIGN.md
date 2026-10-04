# sidekik-platform: DESIGN

**Owner:** Sahil · **Reviewer:** Mayukh · **Deploys:** nothing. Every other repo imports this one as a package, and it also holds the database migrations.
**Must ship first:** tag `v0.1.0` by H1.5. Every other repo depends on it.

## 1. Purpose

This repo holds the shared code that every service uses:

1. **`@sidekik/contracts`:** zod schemas and TS types for every bus event, agent command, decision and Work Map. These are the payload types in ARCHITECTURE §5 and Appendices A–B.
2. **Shared runtime helpers** that every service imports:
   - `bus.ts` (Redis Streams)
   - `auth.ts` (session JWT, internal token, HMAC)
   - `logger.ts`
   - `env.ts` helpers
   - `ids.ts` (ulid)
3. **Supabase:** migrations, RLS policies, storage buckets, and seed data for the demo.
4. **Dev infra:** `docker-compose.yml`, Presidio config with custom recognizers, recorded bus fixtures, and a smoke test.
5. **`docs/`:** synced copies of ARCHITECTURE.md and SCHEMA.md from the `sidekik-docs` repo. Don't edit them here.

## 2. Layout

```
sidekik-platform/
  package.json            # name "@sidekik/contracts", main dist/index.js, files ["dist"]; no prepare (tags carry dist/)
  src/
    index.ts              # re-exports everything
    contracts/
      envelope.ts         # Envelope<T>, makeEvent()
      lifecycle.ts        # SessionLifecycle, Phase, SessionKind
      transcript.ts       # TranscriptTurn, SpeechSignal
      screen.ts           # ScreenEvent, ScreenState, InvoiceState, DomEvent
      commands.ts         # AgentCommand union + toPageMessage(cmd) -> string
      decisions.ts        # DecisionId, DecisionRequest, DecisionResult, DECISION_SPECS (shared option lists)
      workmap.ts          # WorkMap, Step, Guardrail (JSON-Logic), Evidence, OpenItem, MasterySummary
      usage.ts            # UsageRecord, PRICE_TABLE (USD per unit, dated)
      api.ts              # request/response schemas for every public + internal endpoint
    bus.ts
    auth.ts
    logger.ts
    streams.ts            # STREAMS = { lifecycle: "sk:session.lifecycle", ... } + consumer group names
  supabase/
    config.toml
    migrations/
      0001_core.sql       # gateway tables (owner: Mayukh)
      0002_voice.sql      # transcript_turns, agent_configs (owner: Aadil)
      0003_meetbot.sql    # meeting_bots (owner: Aadil)
      0004_capture.sql    # screen_events, keyframes, clips, questions, answers, decisions_log (owner: Sahil)
      0005_mapping.sql    # work_maps ... kb_chunks, expert_memory (owner: Mayukh)
      0006_teaching.sql   # learner_attempts, interventions, mastery, gap_flags (owner: Mayukh)
      0007_rls.sql        # is_member(), policies on every table
      0008_storage.sql    # buckets + storage policies
    seed.sql              # demo org "Maschinenbau AG", Sabine (expert, de), Lena (learner, en), workflow "Supplier invoice coding", pre-confirmed Work Map (see docs/SCHEMA.md seed section)
  infra/presidio/
    recognizers.yaml      # IBAN, DE VAT (DE\d{9}), CZ VAT (CZ\d{8,10}), invoice-safe allow-list (cost centers, invoice ids)
    README.md             # images: mcr.microsoft.com/presidio-analyzer, -anonymizer, -image-redactor (container port 3000)
  dev/
    docker-compose.yml    # redis:7, presidio analyzer :5002, anonymizer :5001, image-redactor :5003
    fixtures/capture_sabine.jsonl   # recorded bus events for a full capture session
    fixtures/tutor_lena.jsonl
    replay.ts             # pnpm replay fixtures/x.jsonl --speed 1
    smoke.sh              # hits every /healthz + runs a scripted session
  CODEOWNERS
  docs/ARCHITECTURE.md
```

## 3. `bus.ts` API (every service uses this)

```ts
export function createBus(redisUrl: string, service: ServiceName): Bus;
interface Bus {
  publish<T>(stream: StreamKey, ev: Envelope<T>): Promise<string>;           // XADD MAXLEN ~ 10000
  consume<T>(stream: StreamKey, handler: (ev: Envelope<T>) => Promise<void>,
             opts?: { group?: string; batch?: number; blockMs?: number }): () => void; // XREADGROUP + XACK, retries 3x then dead-letter "sk:dlq"
  close(): Promise<void>;
}
```

- **Consumer groups:** the default group name is the service name, created with `XGROUP CREATE ... $ MKSTREAM`.
- **Ordering:** one consumer per group, so events stay in order within a session.
- **Validation:** each handler payload is checked against its zod schema. Invalid events are logged and acked, never retried.

## 4. `auth.ts`

```ts
signSessionToken({sid, org, role, kind}, secret, ttlSec = 7200): string   // HS256
verifySessionToken(token, secret): SessionClaims                           // throws
internalAuth(token): FastifyPreHandler                                     // checks X-Internal-Token
verifyHmac(rawBody, header, secret, algo = "sha256"): boolean
```

## 5. Decision specs live here

`DECISION_SPECS` is a single typed object holding, for D1–D12:
- question names
- primitives
- **option order (alphabetical, fixed)**
- criteria text

Brain uses it to call Jev. Mapper and tutor use it to know what answers can come back. Implement it exactly from **ARCHITECTURE Appendix A**: same question names, same option order, same criteria text.

## 6. Migrations: rules

- Every table has `id uuid default gen_random_uuid() primary key`, `org_id uuid not null references orgs`, `created_at timestamptz default now()`, and RLS enabled.
- `0007_rls.sql`:
  - Defines `is_member(org uuid)` (security definer; checks `org_members` against `auth.uid()`).
  - Adds an `org_read` select policy on every table.
  - `learner_attempts` and `mastery` get an extra policy: rows are visible only to the learner themself or to admin/manager roles.
- Writes come only from services, which use the service role. The browser only reads, except `consent_records` inserts, which go through the gateway.
- Index `(session_id, t_ms)` on `screen_events`, `transcript_turns` and `decisions_log`. Add the GIN indexes on `kb_chunks.tsv` and `kb_chunks.content` (trigram), plus the `search_kb()` function, exactly as in `docs/SCHEMA.md`.
- **Columns, constraints and indexes are fully specified in `docs/SCHEMA.md`.** Implement them as written. Each owner reviews their own migration file (CODEOWNERS).

## 7. Versioning

- Use semver tags `vX.Y.Z`.
- **Additive changes** (new optional field, new command type) are a minor bump.
- **Breaking changes** (renamed or removed field) are a major bump. Announce them in the team chat and update all consumers in the same hour.
- Consumers pin a tag in `package.json`, never `main`.

## 8. Claude Code tickets

1. Scaffold the package (tsconfig strict, tsup or tsc build, vitest) and `src/index.ts`.
2. Write the contracts: zod schemas plus `z.infer` types for every payload in ARCHITECTURE §5 and Appendices A–B, with a round-trip unit test for each.
3. `bus.ts` with integration tests against docker-compose Redis: publish/consume, ack, retry, dead-letter queue.
4. `auth.ts` with tests.
5. `commands.ts` → `toPageMessage(cmd)`, which produces the exact `[SIDEKIK] …` strings the page sends.
6. Migrations 0001–0008 and `seed.sql`, verified with `supabase db reset` locally.
7. `infra/presidio/recognizers.yaml`, tested on 10 sample German/English AP sentences.
8. `dev/replay.ts` plus the two fixture files (hand-write them now; replace them with real recordings after H14).
9. `smoke.sh`.
10. Tag `v0.1.0` with `pnpm release 0.1.0`. It builds `dist/` onto a detached commit and tags that commit; `main` never holds `dist/`.

## 9. Definition of done

- All services install `@sidekik/contracts@v0.1.0` and compile.
- `supabase db reset` produces the demo org.
- `docker compose up` starts Redis and Presidio.
- `pnpm replay fixtures/capture_sabine.jsonl` streams events that other services can consume.
