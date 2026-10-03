import { z } from "zod";

export const UsageRecordSchema = z.object({
  service: z.string().min(1),
  vendor: z.enum(["elevenlabs", "typesafe", "anthropic", "gemini", "recall"]),
  units: z.number().nonnegative(),
  unit: z.enum(["tokens_in", "tokens_out", "minutes", "hours"]),
  cost_usd: z.number().nonnegative(),
  counterfactual_usd: z.number().nonnegative().optional(),
});
export type UsageRecord = z.infer<typeof UsageRecordSchema>;
