/**
 * Recorded-style bus fixtures (docs/DESIGN.md ticket 8), generated so they always match the contracts
 * and the demo seed. `pnpm fixtures:gen` writes dev/fixtures/*.jsonl; test/fixtures.test.ts checks them.
 * Replace with real recordings after H14.
 *
 * Each line is {"stream": "sk:…", "ev": Envelope}. Events are what the gateway and perception publish
 * (lifecycle, transcript turns, speech signals, DOM events, screen events), never service outputs
 * like agent commands, so any service can replay them as its input.
 */
import type {
  DomEvent,
  Envelope,
  InvoiceState,
  ScreenEvent,
  ServiceName,
  SessionLifecycle,
  SpeechSignal,
  StreamKey,
  TranscriptTurn,
} from "../../src/index.js";
import { EVENT_TYPES, STREAMS } from "../../src/index.js";
import { DEMO, INVOICES } from "../seed/demo.js";

export type FixtureLine = { stream: StreamKey; ev: Envelope<unknown> };

const TS0 = Date.parse("2026-10-03T10:00:00.000Z");

class Recorder {
  readonly lines: FixtureLine[] = [];
  private n = 0;

  constructor(
    private readonly sessionId: string,
    private readonly tag: string,
  ) {}

  private push<T>(stream: StreamKey, t_ms: number, producer: ServiceName, data: T): void {
    this.n++;
    this.lines.push({
      stream,
      ev: {
        id: `01FX${this.tag}${String(this.n).padStart(26 - 4 - this.tag.length, "0")}`,
        type: EVENT_TYPES[stream],
        v: 1,
        org_id: DEMO.orgId,
        session_id: this.sessionId,
        t_ms,
        ts: new Date(TS0 + t_ms).toISOString(),
        producer,
        data,
      },
    });
  }

  lifecycle(t: number, data: SessionLifecycle) {
    this.push(STREAMS.lifecycle, t, "gateway", data);
  }
  speech(t: number, kind: SpeechSignal["kind"], source: SpeechSignal["source"] = kind === "typing" ? "dom" : "sdk") {
    this.push<SpeechSignal>(STREAMS.speech, t, "gateway", { kind, source });
  }
  turn(t: number, turn_id: string, role: TranscriptTurn["role"], text: string, lang: string) {
    this.push<TranscriptTurn>(STREAMS.turns, t, "gateway", { turn_id, role, text, lang, source: "live", redacted: true });
  }
  dom(t: number, data: DomEvent) {
    this.push(STREAMS.dom, t, "gateway", data);
  }
  screen(t: number, data: ScreenEvent) {
    this.push(STREAMS.screen, t, "perception", data);
  }

  /** User speaks for [start, end] and the transcript turn lands just before speech ends. */
  say(start: number, end: number, turn_id: string, text: string, lang: string) {
    this.speech(start, "user_speech_start");
    this.turn(end - 100, turn_id, "user", text, lang);
    this.speech(end, "user_speech_end");
  }
  /** The agent speaks a line (its transcript turn) between agent_speech_start/end. */
  agent(start: number, end: number, turn_id: string, text: string, lang: string) {
    this.speech(start, "agent_speech_start");
    this.turn(start + 100, turn_id, "agent", text, lang);
    this.speech(end, "agent_speech_end");
  }

  sorted(): FixtureLine[] {
    return [...this.lines].sort((a, b) => a.ev.t_ms - b.ev.t_ms);
  }
}

const screenState = (record: InvoiceState, focused_field?: string): ScreenEvent["state"] => ({
  app: "MiniERP",
  screen: "invoice",
  record,
  ...(focused_field ? { focused_field } : {}),
});

/** Opening a record: DOM event from the page, then perception's screen event. */
function openRecord(r: Recorder, t: number, inv: InvoiceState, eid: string) {
  r.dom(t - 200, { kind: "record_open", record: { kind: "invoice", id: inv.invoice_id! }, state: inv });
  r.screen(t, { event_id: eid, type: "record_opened", entity: { kind: "invoice", id: inv.invoice_id! }, state: screenState(inv), confidence: 0.97, source: "dom" });
}

const INVOICE_FIELDS = new Set(["supplier", "cost_center", "asset_number", "category", "company_code", "currency"]);

/**
 * Typing into a field, then the change landing. Returns the new record state: the field itself when it's
 * part of InvoiceState, otherwise `patch` (e.g. adding an approver raises approvals_count).
 */
function changeField(
  r: Recorder,
  t: number,
  inv: InvoiceState,
  field: string,
  before: string,
  after: string,
  eid: string,
  patch: Partial<InvoiceState> = {},
): InvoiceState {
  const next: InvoiceState = { ...inv, ...(INVOICE_FIELDS.has(field) ? { [field]: after } : {}), ...patch };
  r.dom(t - 1500, { kind: "field_focus", record: { kind: "invoice", id: inv.invoice_id! }, field });
  r.speech(t - 1400, "typing");
  r.screen(t - 1200, { event_id: `${eid}t`, type: "typing_in_progress", field, state: screenState(inv, field), confidence: 0.9, source: "dom" });
  r.dom(t - 100, { kind: "field_change", record: { kind: "invoice", id: inv.invoice_id! }, field, before, after, state: next });
  r.screen(t, { event_id: eid, type: "field_changed", entity: { kind: "invoice", id: inv.invoice_id! }, field, before, after, state: screenState(next), confidence: 0.97, source: "dom" });
  return next;
}

function saveAttempt(r: Recorder, t: number, inv: InvoiceState, eid: string) {
  r.dom(t - 100, { kind: "save_attempt", record: { kind: "invoice", id: inv.invoice_id! }, state: inv });
  r.screen(t, { event_id: eid, type: "button_clicked", entity: { kind: "invoice", id: inv.invoice_id! }, field: "save", state: screenState(inv), confidence: 0.97, source: "dom" });
}

function idle(r: Recorder, t: number, inv: InvoiceState, eid: string) {
  r.screen(t, { event_id: eid, type: "idle", state: screenState(inv), confidence: 0.99, source: "vision" });
}

/**
 * Sabine codes the four capture invoices (#4471, #4480, #4492, #4501) while explaining in German,
 * answers three questions, then the debrief: three follow-ups, a teach-back and her confirmation.
 */
export function captureSabine(): FixtureLine[] {
  const de = "de";
  const r = new Recorder("fixture-capture-sabine", "CAP");
  const base = { kind: "capture", workflow_id: DEMO.workflowId, mode: "browser", language: de } as const;
  r.lifecycle(0, { ...base, event: "started", phase: "capture" });

  // #4471: CNC fixture on opex 4711 → recoded to capex 0400, asset number added (G1, G2).
  let T = 1000;
  let inv = INVOICES["4471"]!;
  openRecord(r, T, inv, "se4471a");
  r.say(T + 500, T + 4100, "t4471a", "Das ist eine CNC-Vorrichtung von Präzisionswerk Ulm, kennen wir.", de);
  inv = changeField(r, T + 6400, inv, "cost_center", "4711", "0400", "se4471c");
  r.say(T + 6600, T + 8250, "t4471b", "…und dann geht die auf 0400.", de);
  r.agent(T + 11_000, T + 13_500, "t4471q", "Ab welchem Betrag kommt so eine Rechnung auf 0400?", de);
  r.say(T + 14_000, T + 19_100, "t4471c", "Alles über fünftausend netto bei Ausrüstung ist Anlagevermögen, also 0400.", de);
  inv = changeField(r, T + 23_000, inv, "asset_number", "", "A-2026-117", "se4471d");
  r.say(T + 23_500, T + 26_100, "t4471d", "Ohne Anlagennummer kann ich nicht auf 0400 buchen.", de);
  saveAttempt(r, T + 29_000, inv, "se4471e");
  idle(r, T + 33_000, inv, "se4471f");

  // #4480: Kranbau in December → hold (G4). She keeps typing a note: no question while she types.
  T = 76_000;
  inv = INVOICES["4480"]!;
  openRecord(r, T, inv, "se4480a");
  r.say(T + 500, T + 4100, "t4480a", "Kranbau, eine Dezember-Rechnung.", de);
  changeField(r, T + 6400, inv, "status", "open", "hold", "se4480c");
  r.say(T + 6600, T + 8250, "t4480b", "Die setze ich erst mal auf Halt.", de);
  for (let t = T + 8600; t <= T + 12_500; t += 700) r.speech(t, "typing");
  r.agent(T + 15_000, T + 17_500, "t4480q", "Wann setzt du eine Rechnung auf Halt?", de);
  r.say(T + 18_000, T + 23_100, "t4480c", "Kranbau rechnet im Dezember gern doppelt ab, deshalb prüfe ich die erst.", de);
  idle(r, T + 27_000, inv, "se4480d");

  // #4492: Czech subsidiary → second approver (G5).
  T = 151_000;
  inv = INVOICES["4492"]!;
  openRecord(r, T, inv, "se4492a");
  r.say(T + 500, T + 4100, "t4492a", "Das ist die tschechische Tochter, CZ01.", de);
  changeField(r, T + 6400, inv, "approver", "", "M. Novák", "se4492c", { approvals_count: 2 });
  r.say(T + 6600, T + 8250, "t4492b", "Da trage ich noch den Novák als zweiten Freigeber ein.", de);
  r.agent(T + 11_000, T + 13_500, "t4492q", "Wann holst du eine zweite Freigabe ein?", de);
  r.say(T + 14_000, T + 19_100, "t4492c", "Bei CZ01 brauchen wir immer zwei Freigaben.", de);
  idle(r, T + 23_000, inv, "se4492d");

  // #4501: routine office supplies. Nothing worth asking.
  T = 226_000;
  inv = INVOICES["4501"]!;
  openRecord(r, T, inv, "se4501a");
  r.say(T + 500, T + 4100, "t4501a", "Bürobedarf, das ist Routine.", de);
  inv = changeField(r, T + 6400, inv, "description", "", "Druckerpapier", "se4501c");
  r.say(T + 6600, T + 8250, "t4501b", "Beschreibung rein, fertig.", de);
  saveAttempt(r, T + 11_000, inv, "se4501d");
  idle(r, T + 15_000, inv, "se4501e");

  // Task done → mapper builds the draft → debrief.
  r.lifecycle(300_000, { ...base, event: "task_done", phase: "building" });
  r.lifecycle(330_000, { ...base, event: "phase_changed", phase: "debrief", workmap_id: DEMO.workmapId });
  r.agent(340_000, 344_000, "td1q", "Du hast gesagt, bei Kranbau im Dezember setzt du auf Halt. Gilt das auch für Gutschriften?", de);
  r.say(345_000, 349_100, "td1a", "Nein, Gutschriften buche ich ganz normal.", de);
  r.agent(355_000, 358_000, "td2q", "Woher weißt du, ob ein Lieferant bekannt ist?", de);
  r.say(359_000, 364_100, "td2a", "Das steht in der Lieferantenliste im MiniERP, Reiter Stammdaten.", de);
  r.agent(370_000, 373_000, "td3q", "Was machst du, wenn die Anlagennummer noch fehlt?", de);
  r.say(374_000, 379_100, "td3a", "Dann frage ich die Anlagenbuchhaltung und lasse die Rechnung liegen.", de);
  r.agent(
    385_000,
    410_000,
    "td4q",
    "Ich fasse zusammen: Lieferant prüfen, Dezember bei Kranbau auf Halt, CZ01 braucht zwei Freigaben, Ausrüstung über fünftausend netto auf 0400 mit Anlagennummer, dann speichern. Stimmt das so?",
    de,
  );
  r.say(411_000, 414_100, "td4a", "Ja, genau so.", de);
  r.lifecycle(420_000, { ...base, event: "phase_changed", phase: "confirmed", workmap_id: DEMO.workmapId });
  r.lifecycle(425_000, { ...base, event: "ended", phase: "done", workmap_id: DEMO.workmapId });
  return r.sorted();
}

/**
 * Lena's tutor session on the published Work Map: #4510 (unknown supplier, €7,200 equipment)
 * where she reaches for 4711 and is caught before save (G1, then G2 + G3), and #4511 (Kranbau, December → G4).
 */
export function tutorLena(): FixtureLine[] {
  const en = "en";
  const r = new Recorder("fixture-tutor-lena", "TUT");
  const base = { kind: "tutor", workflow_id: DEMO.workflowId, workmap_id: DEMO.workmapId, mode: "browser", language: en } as const;
  r.lifecycle(0, { ...base, event: "started", phase: "tutoring" });

  let inv = INVOICES["4510"]!;
  openRecord(r, 1200, inv, "le4510a");
  r.agent(3000, 6000, "tl1q", "Before you code this one: which cost center would you use, and why?", en);
  r.say(7000, 11_100, "tl1a", "I'd leave it on 4711, like the office stuff.", en);
  saveAttempt(r, 15_000, inv, "le4510b"); // still on 4711 → G1 (and G3: unknown supplier)
  r.agent(16_000, 23_000, "tl2q", "Stop: Sabine's rule is that equipment over five thousand net is capex, cost center 0400.", en);
  r.say(24_000, 28_100, "tl2a", "Oh, so 0400 then.", en);
  inv = changeField(r, 31_000, inv, "cost_center", "4711", "0400", "le4510c");
  saveAttempt(r, 34_000, inv, "le4510d"); // 0400 without asset number → G2, still G3
  r.agent(35_000, 42_000, "tl3q", "Two things first: an asset number for 0400, and this supplier is new, so ask the controller.", en);
  r.say(43_000, 47_100, "tl3a", "Okay, I'll ask the controller and get the asset number.", en);
  idle(r, 50_000, inv, "le4510e");

  inv = INVOICES["4511"]!;
  openRecord(r, 60_200, inv, "le4511a");
  r.agent(62_000, 65_000, "tl4q", "What would you do with this one?", en);
  r.say(66_000, 70_100, "tl4a", "Kranbau in December: put it on hold, right?", en);
  changeField(r, 74_000, inv, "status", "open", "hold", "le4511c");
  idle(r, 78_000, inv, "le4511d");

  r.lifecycle(90_000, { ...base, event: "ended", phase: "done" });
  return r.sorted();
}

export const FIXTURES = {
  "capture_sabine.jsonl": captureSabine,
  "tutor_lena.jsonl": tutorLena,
} as const;

export function renderFixture(lines: FixtureLine[]): string {
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}
