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

The package builds on install (`prepare`), so consumers get `dist/` without a publish step.

## Develop

```sh
pnpm install
docker compose -f dev/docker-compose.yml up -d   # Redis + Presidio; bus tests need Redis
pnpm typecheck
pnpm test        # bus tests use Redis DB 15 (override with TEST_REDIS_URL)
pnpm build
```

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
