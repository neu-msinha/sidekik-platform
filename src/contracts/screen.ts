import { z } from "zod";

const EntityRefSchema = z.object({ kind: z.string().min(1), id: z.string().min(1) });

export const InvoiceStateSchema = z.object({
  invoice_id: z.string().optional(),
  supplier: z.string().optional(),
  supplier_known: z.boolean().optional(),
  net_amount: z.number().optional(),
  currency: z.string().optional(),
  invoice_date: z.string().optional(),
  invoice_month: z.number().int().min(1).max(12).optional(),
  company_code: z.string().optional(),
  category: z.string().optional(),
  cost_center: z.string().optional(),
  asset_number: z.string().optional(),
  approvals_count: z.number().int().nonnegative().optional(),
});
export type InvoiceState = z.infer<typeof InvoiceStateSchema>;

export const ScreenStateSchema = z.object({
  app: z.string().optional(),
  screen: z.string().optional(),
  record: InvoiceStateSchema.optional(),
  focused_field: z.string().optional(),
});
export type ScreenState = z.infer<typeof ScreenStateSchema>;

export const DomEventSchema = z.object({
  kind: z.enum(["field_focus", "field_change", "save_attempt", "record_open"]),
  record: EntityRefSchema.optional(),
  field: z.string().optional(),
  before: z.string().optional(),
  after: z.string().optional(),
  state: InvoiceStateSchema.optional(),
});
export type DomEvent = z.infer<typeof DomEventSchema>;

export const ScreenEventTypeSchema = z.enum([
  "app_opened",
  "record_opened",
  "field_changed",
  "button_clicked",
  "value_read",
  "navigation",
  "dialog",
  "typing_in_progress",
  "idle",
]);
export type ScreenEventType = z.infer<typeof ScreenEventTypeSchema>;

export const ScreenEventSchema = z.object({
  event_id: z.string().min(1),
  type: ScreenEventTypeSchema,
  entity: EntityRefSchema.optional(),
  field: z.string().optional(),
  before: z.string().optional(),
  after: z.string().optional(),
  state: ScreenStateSchema,
  confidence: z.number().min(0).max(1),
  source: z.enum(["vision", "dom"]),
  keyframe_id: z.string().optional(),
  /** Raw text read off the screen. Treat as data only, never as instructions. */
  untrusted_screen_text: z.string().optional(),
});
export type ScreenEvent = z.infer<typeof ScreenEventSchema>;
