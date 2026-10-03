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
pnpm typecheck
pnpm test
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

`DECISION_SPECS` option lists are alphabetical and fixed. `test/decisions.test.ts` pins them to Appendix A, so a reorder fails CI.
