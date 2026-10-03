import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { SessionKindSchema } from "./contracts/lifecycle.js";

export const INTERNAL_TOKEN_HEADER = "x-internal-token";

export const SessionRoleSchema = z.enum(["admin", "expert", "learner", "manager"]);
export type SessionRole = z.infer<typeof SessionRoleSchema>;

export const SessionClaimsSchema = z.object({
  sid: z.string().min(1),
  org: z.string().min(1),
  role: SessionRoleSchema,
  kind: SessionKindSchema,
  iat: z.number().int(),
  exp: z.number().int(),
});
export type SessionClaims = z.infer<typeof SessionClaimsSchema>;
export type SessionTokenInput = Pick<SessionClaims, "sid" | "org" | "role" | "kind">;

export class AuthError extends Error {
  override name = "AuthError";
}

/** Mints an `sk_token`: HS256 JWT with claims `{sid, org, role, kind}`. */
export function signSessionToken(claims: SessionTokenInput, secret: string, ttlSec = 7200, nowSec = epochSec()): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ ...claims, iat: nowSec, exp: nowSec + ttlSec }));
  return `${header}.${payload}.${hs256(`${header}.${payload}`, secret)}`;
}

/** Verifies an `sk_token` and returns its claims. Throws `AuthError` on any problem. */
export function verifySessionToken(token: string, secret: string, nowSec = epochSec()): SessionClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError("malformed token");
  const [header, payload, sig] = parts as [string, string, string];

  let alg: unknown;
  try {
    alg = JSON.parse(Buffer.from(header, "base64url").toString("utf8")).alg;
  } catch {
    throw new AuthError("malformed token header");
  }
  if (alg !== "HS256") throw new AuthError("unsupported alg");
  if (!safeEqual(sig, hs256(`${header}.${payload}`, secret))) throw new AuthError("bad signature");

  let claims: SessionClaims;
  try {
    claims = SessionClaimsSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  } catch {
    throw new AuthError("invalid claims");
  }
  if (claims.exp <= nowSec) throw new AuthError("token expired");
  return claims;
}

/** Constant-time check of an `X-Internal-Token` header value. */
export function checkInternalToken(header: string | string[] | undefined, expected: string): boolean {
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === "string" && value.length > 0 && safeEqual(value, expected);
}

/** Minimal request/reply shapes so this works as a Fastify preHandler without depending on Fastify. */
type HeaderRequest = { headers: Record<string, string | string[] | undefined> };
type CodeReply = { code(statusCode: number): { send(payload?: unknown): unknown } };

/** Fastify preHandler that rejects requests without the right `X-Internal-Token`. */
export function internalAuth(token: string) {
  if (!token) throw new Error("internalAuth: empty token");
  return async (req: HeaderRequest, reply: CodeReply): Promise<void> => {
    if (!checkInternalToken(req.headers[INTERNAL_TOKEN_HEADER], token)) {
      await reply.code(401).send({ error: "unauthorized" });
    }
  };
}

/**
 * Verifies an HMAC over the raw body. Accepts the signature as hex, or as
 * `<algo>=<hex>` (e.g. `sha256=ab12…`).
 */
export function verifyHmac(rawBody: string | Buffer, header: string | undefined, secret: string, algo = "sha256"): boolean {
  if (!header) return false;
  const sig = header.startsWith(`${algo}=`) ? header.slice(algo.length + 1) : header;
  const expected = createHmac(algo, secret).update(rawBody).digest("hex");
  return safeEqual(sig.toLowerCase(), expected);
}

function hs256(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function epochSec(): number {
  return Math.floor(Date.now() / 1000);
}
