import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BaseServiceEnvSchema, loadEnv } from "../src/index.js";

const good = {
  PORT: "8082",
  REDIS_URL: "redis://localhost:6379",
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "key",
  SK_INTERNAL_TOKEN: "0123456789abcdef0123",
};

describe("loadEnv", () => {
  it("parses and coerces", () => {
    const env = loadEnv(BaseServiceEnvSchema.extend({ JEV_RPS: z.coerce.number().default(30) }), good);
    expect(env.PORT).toBe(8082);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.JEV_RPS).toBe(30);
  });

  it("lists every invalid variable", () => {
    expect(() => loadEnv(BaseServiceEnvSchema, { ...good, PORT: "abc", REDIS_URL: undefined })).toThrow(/PORT[\s\S]*REDIS_URL|REDIS_URL[\s\S]*PORT/);
  });
});
