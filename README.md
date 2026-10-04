# sidekik-platform

`@sidekik/contracts`: the shared zod schemas, TypeScript types, decision specs and stream names that every Sidekik service imports. The spec is `docs/DESIGN.md`; the contracts mirror `docs/ARCHITECTURE.md` §5 and Appendices A–B.

## Use it from a service

```jsonc
// package.json
"@sidekik/contracts": "github:sidekik-live/sidekik-platform#v0.1.0"
```

```ts
import { STREAMS, ScreenEventSchema, DECISION_SPECS, makeEvent, type ScreenEvent } from "@sidekik/contracts";
```

Release tags carry a prebuilt `dist/`, so installing runs no build step. pnpm 10 blocks build scripts in git dependencies, which is why the build is prebuilt. Always pin a tag, never a branch: branches don't contain `dist/`.

## Release

```sh
pnpm release 0.1.1                  # typecheck + test + build, then tag v0.1.1 on a detached commit with dist/
git push upstream v0.1.1            # publish the tag to sidekik-live
```

`main` never contains `dist/`. Bump the minor for additive changes and the major for breaking ones (docs/DESIGN.md §7), then post the tag in the team chat.

## Develop

```sh
pnpm install
docker compose -f dev/docker-compose.yml up -d   # Redis + Presidio; bus tests need Redis
pnpm typecheck
pnpm test        # bus tests use Redis DB 15 (override with TEST_REDIS_URL)
pnpm build
```

## Database (Supabase)

```sh
supabase start -x studio,imgproxy,edge-runtime,logflare,vector,mailpit,realtime,postgres-meta,supavisor   # local stack, minimal
pnpm db:reset      # apply supabase/migrations 0000–0008 + supabase/seed.sql
pnpm db:test       # pgTAP: schema, RLS (anon / outsider / admin / learner), search_kb, buckets
```

- `supabase/migrations/` implements `docs/SCHEMA.md`. Each owner reviews their own file: 0001 and 0005–0006 Mayukh, 0002–0003 Aadil, 0004 and 0007–0008 Sahil.
- RLS: the browser only reads. There are select policies only, and services write with the service role.
  - Learners see only their own `learner_attempts` and `mastery`.
  - `agent_host_tokens` are never readable from the browser.
- `supabase/seed.sql` is **generated**: edit `dev/seed/demo.ts`, then run `pnpm seed:gen`. `test/seed.test.ts` checks:
  - the demo Work Map (S1–S7, G1–G5) validates against `WorkMapSchema`;
  - every guardrail trips on the right demo invoice (e.g. #4510, the €7,200 catch, trips G1 and G3);
  - `seed.sql` is up to date.
- Demo ids are fixed: org `…0001`, expert Sabine `…0011`, learner Lena `…0021`, workflow `…0031`, Work Map `…0041`.
- Admins: sign in by magic link, then run `select public.grant_demo_role('you@example.com');` in the SQL editor.

## Bus fixtures and replay

```sh
pnpm replay fixtures/capture_sabine.jsonl              # real time; --speed 10 or --speed max
pnpm replay fixtures/tutor_lena.jsonl --session <uuid> # reuse a session that exists in Supabase
```

- **`capture_sabine.jsonl`** (121 events): Sabine codes #4471, #4480, #4492 and #4501, explaining in German. She answers 3 questions, then the session goes task done → debrief (3 follow-ups + teach-back) → confirmed.
- **`tutor_lena.jsonl`** (46 events): Lena on the published Work Map. #4510 on 4711 trips G1 + G3 at save; recoded to 0400 without an asset number, it trips G2 + G3. #4511 (Kranbau in December) trips G4.
- **What's in them:** only what the gateway and perception publish (lifecycle, turns, speech, DOM and screen events), never agent commands. Any service can replay them as input.
- **Ids:** each run gets a fresh UUID session id and fresh event ids.
- **Generated:** edit `dev/fixtures/build.ts`, then run `pnpm fixtures:gen`. `test/fixtures.test.ts` validates every event against its contract and checks the demo story. Replace them with real recordings after H14.
## PII redaction (Presidio)

```sh
docker compose -f dev/docker-compose.yml up -d --build presidio-analyzer presidio-anonymizer   # analyzer :5002, anonymizer :5001
pnpm test:presidio      # 10 German/English AP sentences against the live containers
```

```ts
import { redact } from "@sidekik/contracts";
const { text } = await redact(turn.text, session.language, {
  analyzerUrl: env.PRESIDIO_ANALYZER_URL,
  anonymizerUrl: env.PRESIDIO_ANONYMIZER_URL,
  keep: [record.supplier],   // the supplier on screen: spaCy tags unknown companies as PERSON
});
```

- **`infra/presidio/`:** the analyzer image (pinned base plus the `de_core_news_md` model) and its config.
  - NER maps **PERSON only**, so organizations, places and dates ("Kranbau GmbH", "Ulm", "im Dezember") stay. They're the facts the guardrails use.
  - Recognizers: IBAN, email, phone, credit card, IP, `DE_VAT_ID` and `CZ_VAT_ID`, in English and German.
- **`PRESIDIO_ALLOW_LIST`** (regex, every pattern anchored) keeps invoice, cost-center and supplier numbers, company codes (DE01/CZ01), asset and document numbers, and German imperatives the model mistakes for names ("Frag den …").
- **`redact()` fails closed.** On any Presidio error it throws; it never returns unredacted text.
- The image redactor still uses the stock image (perception).

## What's in it

| Module | Contents |
|---|---|
| `contracts/envelope.ts` | `Envelope<T>`, `envelopeSchema()`, `makeEvent()`, `ServiceName` |
| `contracts/lifecycle.ts` | `SessionLifecycle`, `Phase`, `SessionKind`, `SessionMode` |
| `contracts/transcript.ts` | `TranscriptTurn`, `SpeechSignal` |
| `contracts/screen.ts` | `ScreenEvent`, `ScreenState`, `InvoiceState`, `DomEvent` |
| `contracts/commands.ts` | `AgentCommand` union, `QType` |
| `contracts/decisions.ts` | `DecisionRequest`/`Result`/`Response`, `DECISION_SPECS` (D1–D12), `expandQuestions()` |
| `contracts/workmap.ts` | `WorkMap`, `Step`, `Guardrail`, `Evidence`, `OpenItem`, `MasterySummary`, `WorkMapPublished` |
| `contracts/usage.ts` | `UsageRecord` |
| `streams.ts` | `STREAMS`, `STREAM_SCHEMAS`, `EVENT_TYPES`, `streamEnvelopeSchema()`, `DLQ_STREAM` |
| `bus.ts` | `createBus(redisUrl, service)` → `publish` / `consume` / `close` over Redis Streams |
| `auth.ts` | `signSessionToken`, `verifySessionToken`, `internalAuth` (Fastify preHandler), `verifyHmac` |
| `logger.ts` | `createLogger(service)`, `eventLogger(log, ev)`, `sessionLogger(log, s)` (pino) |
| `env.ts` | `loadEnv(schema)`, `BaseServiceEnvSchema` |

### Bus semantics

```ts
const bus = createBus(env.REDIS_URL, "brain", { logger });
bus.consume(STREAMS.screen, async (ev) => { /* ev is Envelope<ScreenEvent> */ });
await bus.publish(STREAMS.commands, makeEvent({ type: EVENT_TYPES[STREAMS.commands], ... }));
```

- One consumer group per service (group = service name), one consumer per group, so events stay in order.
- `publish` validates against the stream's schema before `XADD MAXLEN ~ 10000`.
- Invalid entries are logged and acked, never retried.
- A failing handler is retried 3× with backoff, then copied to `sk:dlq` and acked.
- Handled `event.id`s are remembered for 24 h, so a redelivered event is skipped.
- On start, a consumer first replays its own unacked entries, then reads new ones.

`DECISION_SPECS` option lists are alphabetical and fixed. `test/decisions.test.ts` pins them to Appendix A, so a reorder fails CI.
