/**
 * Demo data (docs/SCHEMA.md "seed.sql"): org, expert Sabine, learner Lena, the
 * "Supplier invoice coding" workflow and a pre-confirmed, published Work Map v1
 * (steps S1–S7, guardrails G1–G5 from ARCHITECTURE Appendix B).
 *
 * This file is the single source: `pnpm seed:gen` renders supabase/seed.sql from it,
 * and test/seed.test.ts validates it against the contracts and the demo invoices.
 * IDs are fixed so services, fixtures and tests can refer to them.
 */
import type { Guardrail, InvoiceState, Step, WorkMap } from "../../src/index.js";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

export const DEMO = {
  orgId: id(0x1),
  orgName: "Maschinenbau AG",
  expertId: id(0x11),
  learnerId: id(0x21),
  workflowId: id(0x31),
  workmapId: id(0x41),
} as const;

export const EXPERT = { id: DEMO.expertId, display_name: "Sabine", language: "de", onet_code: "43-3031.00" };
export const LEARNER = { id: DEMO.learnerId, display_name: "Lena", language: "en" };
export const WORKFLOW = {
  id: DEMO.workflowId,
  name: "Supplier invoice coding",
  description: "Code incoming supplier invoices in the MiniERP: supplier check, cost center, asset number, approvals.",
  onet_code: "43-3031.00",
};

const stepId = (n: number) => id(0x100 + n);
const guardrailId = (n: number) => id(0x200 + n);
const at = (sec: number) => ({ t_ms: sec * 1000, label: `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}` });
const sabine = (sec: number) => `Sabine, ${at(sec).label}`;

type Seeded<T> = T & { evidence_sec: number };

export const GUARDRAILS: Seeded<Guardrail>[] = [
  {
    id: guardrailId(1),
    key: "G1",
    kind: "threshold",
    description: "Equipment over €5,000 net is always capex: cost center 0400.",
    rule: { and: [{ ">": [{ var: "net_amount" }, 5000] }, { "==": [{ var: "category" }, "equipment"] }, { "!=": [{ var: "cost_center" }, "0400"] }] },
    consequence: { require: { cost_center: "0400" } },
    quote: "Alles über fünftausend netto bei Ausrüstung ist Anlagevermögen, also 0400.",
    quote_en: "Anything over five thousand net for equipment is a fixed asset, so 0400.",
    evidence: [{ event_id: "seed-se-4471-cost-center", turn_id: "seed-t07", t_ms: 192_000 }],
    evidence_sec: 192,
  },
  {
    id: guardrailId(2),
    key: "G2",
    kind: "condition",
    description: "No asset number, no capex booking.",
    rule: { and: [{ "==": [{ var: "cost_center" }, "0400"] }, { "!": { var: "asset_number" } }] },
    consequence: { block: true },
    quote: "Ohne Anlagennummer kann ich nicht auf 0400 buchen.",
    quote_en: "Without an asset number I can't book to 0400.",
    evidence: [{ event_id: "seed-se-4471-asset", turn_id: "seed-t09", t_ms: 214_000 }],
    evidence_sec: 214,
  },
  {
    id: guardrailId(3),
    key: "G3",
    kind: "stop_and_ask",
    description: "Unknown supplier: stop and ask the controller.",
    rule: { "==": [{ var: "supplier_known" }, false] },
    consequence: { action: "ask_controller" },
    quote: "Wenn ich den Lieferanten nicht kenne, frage ich erst den Controller.",
    quote_en: "If I don't know the supplier, I ask the controller first.",
    evidence: [{ event_id: "seed-se-4471-supplier", turn_id: "seed-t02", t_ms: 21_000 }],
    evidence_sec: 21,
  },
  {
    id: guardrailId(4),
    key: "G4",
    kind: "hold",
    description: "Kranbau GmbH double-bills in December: put the invoice on hold.",
    rule: { and: [{ in: [{ var: "supplier" }, ["Kranbau GmbH"]] }, { "==": [{ var: "invoice_month" }, 12] }] },
    consequence: { action: "hold" },
    quote: "Kranbau rechnet im Dezember gern doppelt ab, deshalb setze ich die auf Halt.",
    quote_en: "Kranbau likes to double-bill in December, so I put those on hold.",
    evidence: [{ event_id: "seed-se-4480-status", turn_id: "seed-t12", t_ms: 318_000 }],
    evidence_sec: 318,
  },
  {
    id: guardrailId(5),
    key: "G5",
    kind: "second_approval",
    description: "The Czech subsidiary (CZ01) needs a second approval.",
    rule: { and: [{ in: ["CZ", { var: "company_code" }] }, { "<": [{ var: "approvals_count" }, 2] }] },
    consequence: { action: "second_approval" },
    quote: "Bei CZ01 brauchen wir immer zwei Freigaben.",
    quote_en: "For CZ01 we always need two approvals.",
    evidence: [{ event_id: "seed-se-4492-approver", turn_id: "seed-t15", t_ms: 431_000 }],
    evidence_sec: 431,
  },
];

const step = (
  n: number,
  sec: number,
  field: string,
  title: string,
  decision: string,
  quote: string,
  quote_en: string,
  turn: string,
  guardrails: number[],
  judgment: boolean,
  entity = "invoice 4471",
): Seeded<Step> => ({
  id: stepId(n),
  key: `S${n}`,
  ordinal: n,
  title,
  screen_moment: { ...at(sec), event_ids: [`seed-se-s${n}`], entity, field },
  decision,
  reason: { quote, quote_en, turn_id: turn, source_label: sabine(sec) },
  guardrail_ids: guardrails.map(guardrailId),
  is_judgment_call: judgment,
  screen_signature: { app: "MiniERP", record_kind: "invoice", field },
  evidence_sec: sec,
});

export const STEPS: Seeded<Step>[] = [
  step(1, 18, "supplier", "Open the invoice and check the supplier", "Checked that Präzisionswerk Ulm is a known supplier",
    "Erst schaue ich, ob wir den Lieferanten kennen.", "First I check whether we know the supplier.", "seed-t01", [3], false),
  step(2, 40, "invoice_date", "Check the invoice date", "Checked the invoice month for known December double-billing",
    "Beim Datum schaue ich, ob es Dezember ist, wegen Kranbau.", "With the date I check whether it's December, because of Kranbau.", "seed-t03", [4], true),
  step(3, 64, "company_code", "Check the company code", "Checked whether the invoice belongs to the Czech subsidiary",
    "DE01 ist bei uns, CZ01 ist die tschechische Tochter.", "DE01 is us, CZ01 is the Czech subsidiary.", "seed-t04", [5], false),
  step(4, 192, "cost_center", "Code the invoice to a cost center", "Re-coded opex (4711) to capex (0400)",
    "…und dann geht die auf 0400, weil das eine Maschine ist.", "…and then it goes to 0400, because it's a machine.", "seed-t07", [1], true),
  step(5, 214, "asset_number", "Add the asset number", "Added an asset number for the capex booking",
    "Für 0400 trage ich die Anlagennummer ein.", "For 0400 I enter the asset number.", "seed-t09", [2], false),
  step(6, 236, "approvals", "Collect the approvals", "Requested the approvals the invoice needs",
    "Dann geht die Freigabe raus.", "Then the approval request goes out.", "seed-t10", [5], false),
  step(7, 250, "save", "Save the invoice", "Saved the invoice after every check passed",
    "Erst wenn alles passt, speichere ich.", "Only when everything checks out do I save.", "seed-t11", [], false),
];

export const WORKMAP: WorkMap = {
  id: DEMO.workmapId,
  workflow_id: DEMO.workflowId,
  expert_id: DEMO.expertId,
  version: 1,
  status: "published",
  title: "Supplier invoice coding",
  language: "de",
  steps: STEPS.map(({ evidence_sec: _, ...s }) => s),
  guardrails: GUARDRAILS.map(({ evidence_sec: _, ...g }) => g),
  open_items: [],
  confirmed_turn_id: "seed-t20",
};

/** The six MiniERP invoices (docs/SCHEMA.md seed section), as normalized InvoiceState. */
export const INVOICES: Record<string, InvoiceState> = {
  "4471": { invoice_id: "4471", supplier: "Präzisionswerk Ulm", supplier_known: true, net_amount: 6350, currency: "EUR", category: "equipment", company_code: "DE01", cost_center: "4711", approvals_count: 1 },
  "4480": { invoice_id: "4480", supplier: "Kranbau GmbH", supplier_known: true, net_amount: 1980, currency: "EUR", category: "services", company_code: "DE01", invoice_month: 12, approvals_count: 1 },
  "4492": { invoice_id: "4492", supplier: "Strojírna Brno s.r.o.", supplier_known: true, net_amount: 3400, currency: "EUR", category: "parts", company_code: "CZ01", approvals_count: 1 },
  "4501": { invoice_id: "4501", supplier: "Bürobedarf Weber", supplier_known: true, net_amount: 240, currency: "EUR", category: "office", company_code: "DE01", cost_center: "4711", approvals_count: 1 },
  "4510": { invoice_id: "4510", supplier: "Antriebstechnik Nord", supplier_known: false, net_amount: 7200, currency: "EUR", category: "equipment", company_code: "DE01", cost_center: "4711", approvals_count: 1 },
  "4511": { invoice_id: "4511", supplier: "Kranbau GmbH", supplier_known: true, net_amount: 2150, currency: "EUR", category: "services", company_code: "DE01", invoice_month: 12, approvals_count: 1 },
};
