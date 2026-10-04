import { describe, expect, it } from "vitest";
import { analyzeRequest, keepPatterns, PRESIDIO_ALLOW_LIST, presidioLanguage, redact } from "../src/index.js";

/** Presidio's regex allow-list semantics: alternatives joined with "|", `search`, case-insensitive. */
const allowed = (word: string) => new RegExp(PRESIDIO_ALLOW_LIST.join("|"), "i").test(word);

describe("allow-list", () => {
  it("every pattern is anchored ^…$ (search() would otherwise allow partial matches)", () => {
    for (const p of PRESIDIO_ALLOW_LIST) expect(p.startsWith("^") && p.endsWith("$"), p).toBe(true);
  });

  it.each(["4711", "0400", "#4471", "100234", "DE01", "CZ01", "A-2026-117", "INV-2026-04471", "PO-4500012345", "Frag"])("keeps %s", (w) => {
    expect(allowed(w)).toBe(true);
  });

  it.each(["Peter", "Fragmann", "Sabine Weber", "DE123456789", "CZ12345678", "0731 123456", "DE89 3704 0044 0532 0130 00", "4111 1111 1111 1111"])(
    "never allows %s",
    (w) => {
      expect(allowed(w)).toBe(false);
    },
  );
});

describe("keepPatterns", () => {
  const re = (names: string[]) => new RegExp(keepPatterns(names).join("|"), "i");

  it("allows the business name whole and its significant words, anchored", () => {
    const r = re(["Präzisionswerk Ulm", "Strojírna Brno s.r.o.", "Kranbau GmbH"]);
    for (const w of ["Präzisionswerk Ulm", "Präzisionswerk", "Strojírna Brno s.r.o.", "Strojírna Brno", "Strojírna", "Brno", "Kranbau GmbH", "Kranbau"]) expect(r.test(w), w).toBe(true);
    for (const w of ["Ulm", "GmbH", "s.r.o.", "Peter", "Präzisionswerke", "Kranbauer"]) expect(r.test(w), w).toBe(false);
    for (const p of keepPatterns(["A.B (C) [d]* GmbH"])) expect(p.startsWith("^") && p.endsWith("$"), p).toBe(true);
  });

  it("escapes regex syntax in names", () => {
    expect(re(["A.B (C)"]).test("AxB (C)")).toBe(false);
    expect(re(["A.B (C)"]).test("A.B (C)")).toBe(true);
  });

  it("is added to the analyze request", () => {
    expect(analyzeRequest("x", "de", ["Kranbau GmbH"]).allow_list).toEqual([...PRESIDIO_ALLOW_LIST, "^Kranbau$", "^Kranbau GmbH$"]);
  });
});

describe("client", () => {
  it("maps session languages", () => {
    expect([presidioLanguage("de"), presidioLanguage("de-DE"), presidioLanguage("en-GB"), presidioLanguage("cs")]).toEqual(["de", "de", "en", "en"]);
  });

  it("analyze request carries entities and the regex allow-list", () => {
    expect(analyzeRequest("x", "de")).toMatchObject({ language: "de", allow_list_match: "regex", allow_list: PRESIDIO_ALLOW_LIST });
  });

  it("calls analyze then anonymize, and skips anonymize when nothing is found", async () => {
    const calls: string[] = [];
    const fake = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(url));
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith("/analyze")) {
        return Response.json(body.text.includes("Peter") ? [{ entity_type: "PERSON", start: 9, end: 14, score: 0.85 }] : []);
      }
      return Response.json({ text: "Frag den <PERSON>.", items: [] });
    };
    const opts = { analyzerUrl: "http://a/", anonymizerUrl: "http://n", fetch: fake as typeof fetch };
    expect(await redact("Frag den Peter.", "de", opts)).toEqual({ text: "Frag den <PERSON>.", findings: [{ entity_type: "PERSON", start: 9, end: 14, score: 0.85 }] });
    expect(calls).toEqual(["http://a/analyze", "http://n/anonymize"]);
    calls.length = 0;
    expect((await redact("Geht auf 0400.", "de", opts)).text).toBe("Geht auf 0400.");
    expect(calls).toEqual(["http://a/analyze"]);
  });

  it("fails closed: Presidio errors throw instead of returning unredacted text", async () => {
    const down = (async () => new Response("boom", { status: 503 })) as typeof fetch;
    await expect(redact("Frag den Peter.", "de", { analyzerUrl: "http://a", anonymizerUrl: "http://n", fetch: down })).rejects.toThrow(/503/);
  });
});

// Live Presidio (infra/presidio image): pnpm test:presidio, after
//   docker compose -f dev/docker-compose.yml up -d --build presidio-analyzer presidio-anonymizer
const ANALYZER = process.env.PRESIDIO_ANALYZER_URL;
const ANONYMIZER = process.env.PRESIDIO_ANONYMIZER_URL ?? "http://localhost:5001";

// 10 AP sentences (DESIGN ticket 7): what must disappear, what must survive. The last column is the
// supplier of the record on screen, which callers pass as `keep` (spaCy tags unknown companies as PERSON).
const SENTENCES: [lang: string, text: string, redacted: string[], kept: string[], supplier?: string][] = [
  ["de", "Das ist eine CNC-Vorrichtung von Präzisionswerk Ulm, die geht von 4711 auf 0400.", [], ["Präzisionswerk Ulm", "4711", "0400"], "Präzisionswerk Ulm"],
  ["de", "Kranbau rechnet im Dezember gern doppelt ab, deshalb Rechnung #4480 auf Halt.", [], ["Kranbau", "Dezember", "#4480"], "Kranbau GmbH"],
  ["de", "Frag den Peter Schmidt, Telefon 0731 123456.", ["Peter Schmidt", "0731 123456"], ["Frag", "Telefon"]],
  ["de", "Die IBAN ist DE89 3704 0044 0532 0130 00, bitte nicht auf 4711 buchen.", ["DE89 3704 0044 0532 0130 00"], ["4711"]],
  ["de", "USt-IdNr. von Präzisionswerk: DE123456789, Buchungskreis DE01.", ["DE123456789"], ["Präzisionswerk", "DE01"], "Präzisionswerk Ulm"],
  ["de", "Strojírna Brno hat die DIČ CZ12345678, also CZ01 und zwei Freigaben.", ["CZ12345678"], ["Strojírna Brno", "CZ01"], "Strojírna Brno s.r.o."],
  ["de", "Schreib an sabine.weber@maschinenbau.de wegen Anlagennummer A-2026-117.", ["sabine.weber@maschinenbau.de"], ["Schreib", "A-2026-117"]],
  ["en", "Lena, put invoice 4510 on cost center 0400 and ask Sabine Mueller before saving.", ["Lena", "Sabine Mueller"], ["4510", "0400"]],
  ["en", "Antriebstechnik Nord is a new supplier, call the controller at +49 89 1234567.", ["+49 89 1234567"], ["Antriebstechnik Nord", "controller"], "Antriebstechnik Nord"],
  ["en", "Card 4111 1111 1111 1111 was used for the Kranbau deposit in December.", ["4111 1111 1111 1111"], ["Kranbau", "December"], "Kranbau GmbH"],
];

describe.skipIf(!ANALYZER)("live Presidio: 10 AP sentences", () => {
  it.each(SENTENCES)("[%s] %s", async (lang, text, gone, kept, supplier) => {
    const out = await redact(text, lang, { analyzerUrl: ANALYZER!, anonymizerUrl: ANONYMIZER, timeoutMs: 5000, ...(supplier ? { keep: [supplier] } : {}) });
    for (const g of gone) expect(out.text, `should redact ${g}`).not.toContain(g);
    for (const k of kept) expect(out.text, `should keep ${k}`).toContain(k);
    if (gone.length > 0) expect(out.text).toMatch(/<[A-Z_]+>/);
  });
});
