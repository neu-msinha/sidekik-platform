import { readFileSync } from "node:fs";
import jsonLogic from "json-logic-js";
import { describe, expect, it } from "vitest";
import { GUARDRAILS, INVOICES, STEPS, WORKMAP } from "../dev/seed/demo.js";
import { renderSeed } from "../dev/seed/render.js";
import { JSONLOGIC_VARIABLES, WorkMapSchema, type InvoiceState } from "../src/index.js";

/** Keys of the guardrails a state trips. */
const tripped = (state: InvoiceState) => GUARDRAILS.filter((g) => jsonLogic.apply(g.rule as jsonLogic.RulesLogic, state)).map((g) => g.key);

describe("demo seed", () => {
  it("the Work Map is a valid contract WorkMap with S1–S7 and G1–G5", () => {
    expect(() => WorkMapSchema.parse(WORKMAP)).not.toThrow();
    expect(WORKMAP.steps.map((s) => s.key)).toEqual(["S1", "S2", "S3", "S4", "S5", "S6", "S7"]);
    expect(WORKMAP.guardrails.map((g) => g.key)).toEqual(["G1", "G2", "G3", "G4", "G5"]);
  });

  it("every step and guardrail has evidence: a screen moment and the expert's words", () => {
    for (const s of STEPS) {
      expect(s.reason?.quote, s.key).toBeTruthy();
      expect(s.screen_moment.event_ids.length, s.key).toBeGreaterThan(0);
    }
    for (const g of GUARDRAILS) {
      expect(g.quote, g.key).toBeTruthy();
      expect(g.evidence.length, g.key).toBeGreaterThan(0);
    }
  });

  it("step guardrail ids point at real guardrails", () => {
    const ids = new Set(GUARDRAILS.map((g) => g.id));
    for (const s of STEPS) for (const gid of s.guardrail_ids) expect(ids.has(gid), s.key).toBe(true);
  });

  it("guardrail rules only use the allowed JSON-Logic variables", () => {
    const allowed = new Set<string>(JSONLOGIC_VARIABLES);
    for (const g of GUARDRAILS) {
      const vars = JSON.stringify(g.rule).match(/"var":"([^"]+)"/g) ?? [];
      for (const v of vars) expect(allowed.has(v.slice(7, -1)), `${g.key}: ${v}`).toBe(true);
    }
  });

  // docs/SCHEMA.md seed: what each MiniERP invoice should trip.
  it.each([
    ["#4471 as opened (4711)", INVOICES["4471"]!, ["G1"]],
    ["#4471 recoded to 0400 without asset number", { ...INVOICES["4471"]!, cost_center: "0400" }, ["G2"]],
    ["#4471 recoded to 0400 with asset number", { ...INVOICES["4471"]!, cost_center: "0400", asset_number: "A-2026-117" }, []],
    ["#4480 Kranbau in December", INVOICES["4480"]!, ["G4"]],
    ["#4492 CZ01 with one approval", INVOICES["4492"]!, ["G5"]],
    ["#4492 CZ01 with two approvals", { ...INVOICES["4492"]!, approvals_count: 2 }, []],
    ["#4501 routine office supplies", INVOICES["4501"]!, []],
    ["#4510 learner leaves it on 4711 (the €7,200 catch)", INVOICES["4510"]!, ["G1", "G3"]],
    ["#4510 learner recodes to 0400, no asset number", { ...INVOICES["4510"]!, cost_center: "0400" }, ["G2", "G3"]],
    ["#4511 Kranbau in December", INVOICES["4511"]!, ["G4"]],
  ] as [string, InvoiceState, string[]][])("%s → %j", (_name, state, expected) => {
    expect(tripped(state)).toEqual(expected);
  });

  it("supabase/seed.sql is up to date (run `pnpm seed:gen`)", () => {
    const onDisk = readFileSync(new URL("../supabase/seed.sql", import.meta.url), "utf8");
    expect(onDisk).toBe(renderSeed());
  });
});
