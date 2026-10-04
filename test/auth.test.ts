import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AuthError, checkInternalToken, internalAuth, signSessionToken, verifyHmac, verifySessionToken } from "../src/index.js";

const secret = "test-session-secret-0123456789abcdef";
const claims = { sid: "sess1", org: "org1", role: "expert", kind: "capture" } as const;

describe("session tokens", () => {
  it("round-trips claims with a 2 h default TTL", () => {
    const now = 1_700_000_000;
    const token = signSessionToken(claims, secret, undefined, now);
    const out = verifySessionToken(token, secret, now + 60);
    expect(out).toMatchObject(claims);
    expect(out.exp - out.iat).toBe(7200);
  });

  it("is a standard HS256 JWT", () => {
    const [header] = signSessionToken(claims, secret).split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({ alg: "HS256", typ: "JWT" });
  });

  it("rejects an expired token", () => {
    const token = signSessionToken(claims, secret, 10, 1000);
    expect(() => verifySessionToken(token, secret, 1010)).toThrow(/expired/);
  });

  it("rejects a wrong secret or tampered payload", () => {
    const token = signSessionToken(claims, secret);
    expect(() => verifySessionToken(token, "other-secret")).toThrow(AuthError);
    const [h, , s] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...claims, role: "admin", iat: 0, exp: 9e9 })).toString("base64url");
    expect(() => verifySessionToken(`${h}.${forged}.${s}`, secret)).toThrow(/signature/);
  });

  it("rejects alg none and malformed tokens", () => {
    const none = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const [, p, s] = signSessionToken(claims, secret).split(".");
    expect(() => verifySessionToken(`${none}.${p}.${s}`, secret)).toThrow(/alg/);
    expect(() => verifySessionToken("abc", secret)).toThrow(/malformed/);
  });
});

describe("internal token", () => {
  it("checks the header in constant time", () => {
    expect(checkInternalToken("abc", "abc")).toBe(true);
    expect(checkInternalToken(["abc"], "abc")).toBe(true);
    expect(checkInternalToken("abd", "abc")).toBe(false);
    expect(checkInternalToken(undefined, "abc")).toBe(false);
    expect(checkInternalToken("", "")).toBe(false);
  });

  it("internalAuth replies 401 without the right header", async () => {
    const sent: unknown[] = [];
    let status = 0;
    const reply = { code: (c: number) => ((status = c), { send: (p?: unknown) => sent.push(p) }) };
    const pre = internalAuth("tok");
    await pre({ headers: { "x-internal-token": "nope" } }, reply);
    expect(status).toBe(401);
    status = 0;
    await pre({ headers: { "x-internal-token": "tok" } }, reply);
    expect(status).toBe(0);
  });
});

describe("verifyHmac", () => {
  const body = '{"hello":"world"}';
  const sig = createHmac("sha256", "whsec").update(body).digest("hex");

  it("accepts hex and sha256=hex", () => {
    expect(verifyHmac(body, sig, "whsec")).toBe(true);
    expect(verifyHmac(Buffer.from(body), `sha256=${sig}`, "whsec")).toBe(true);
  });

  it("rejects a bad or missing signature", () => {
    expect(verifyHmac(body, sig, "other")).toBe(false);
    expect(verifyHmac(body + " ", sig, "whsec")).toBe(false);
    expect(verifyHmac(body, undefined, "whsec")).toBe(false);
  });
});
