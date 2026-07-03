/**
 * lib/receive/types.ts — form input contracts for the Receive surface
 * (plan/tab-receive.md · FEATURES.md §7).
 *
 * Every server action validates its payload against one of these zod schemas
 * before touching the DB (CLAUDE.md / OWNERSHIP.md convention) — the
 * `Database` generic on the Supabase client is not the validation layer.
 */

import { z } from "zod";
import { FieldTypeSchema, PART_CATEGORIES } from "@/types/db";

/** Re-exported so components don't reach into types/db.ts directly for the chip list. */
export const PART_CATEGORY_OPTIONS = PART_CATEGORIES;

/**
 * Categories where Voltage is meaningful enough to show as its own field
 * [R2-24]. Deliberately conservative — Value alone already covers most
 * passive specs; Voltage adds a second required-looking box only where the
 * client's real sheets carry one (`0.1µF/50V` style combined values).
 */
const VOLTAGE_CATEGORIES = new Set<string>([
  "Capacitor",
  "Inductor",
  "IC",
  "Module",
  "SMPS",
  "Diode",
  "Transistor",
  "LED",
  "Relay",
]);

export function categoryHasVoltage(category: string | null | undefined): boolean {
  return Boolean(category) && VOLTAGE_CATEGORIES.has(category as string);
}

/** `smark_part_field_templates.field_key` — slug key into `smark_parts.attributes` [R2-23]. */
export function slugifyFieldKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const CustomFieldValueSchema = z.union([z.string(), z.number()]);

/** "New part" card (R2-23 flat card #1). */
export const NewPartFormSchema = z.object({
  category: z.string().trim().min(1, "Pick a category"),
  value: z.string().trim().min(1, "Value is required"),
  /** [R2-24] own field, split out of the old combined "0.1µF/50V" string. */
  voltage: z.string().trim().nullish(),
  package: z.string().trim().min(1, "Package is required"),
  qty: z.coerce.number().int().positive("Quantity must be a positive whole number"),
  mpn: z.string().trim().nullish(),
  manufacturer: z.string().trim().nullish(),
  /** Keyed by `field_key` (slugified label) — values land in `smark_parts.attributes` [R2-23]. */
  customFields: z.record(z.string(), CustomFieldValueSchema).default({}),
});
export type NewPartFormInput = z.infer<typeof NewPartFormSchema>;

/** "+ add custom field" — remembered on `smark_part_field_templates` [R2-23]. */
export const CustomFieldTemplateInputSchema = z.object({
  label: z.string().trim().min(1, "Name the field"),
  fieldType: FieldTypeSchema,
});
export type CustomFieldTemplateInput = z.infer<typeof CustomFieldTemplateInputSchema>;

/** "Top up existing" card (R2-23 flat card #2). */
export const TopUpInputSchema = z.object({
  code: z.string().trim().min(1, "Scan or type a PID"),
  qty: z.coerce.number().int().positive("Quantity must be a positive whole number"),
});
export type TopUpInput = z.infer<typeof TopUpInputSchema>;

/** "Put away arrivals" card (R2-23 flat card #3 · R2-12 PO grouping). */
export const PutAwayInputSchema = z.object({
  orderLineId: z.uuid(),
  arrivedQty: z.coerce.number().int().positive("Arrived qty must be a positive whole number"),
});
export type PutAwayInput = z.infer<typeof PutAwayInputSchema>;

/** Onboarding queue — "assign Shelf → Box → ESD inline" for a no-location import row. */
export const OnboardingAssignInputSchema = z
  .object({
    partId: z.uuid(),
    /** Pick an existing box… */
    boxId: z.uuid().nullish(),
    /** …or create one (requires a shelf code alongside it). */
    newBoxName: z.string().trim().nullish(),
    shelfCode: z.string().trim().nullish(),
    esdNote: z.string().trim().nullish(),
  })
  .refine((v) => Boolean(v.boxId) || (Boolean(v.newBoxName) && Boolean(v.shelfCode)), {
    message: "Pick an existing box, or provide a new box name + shelf",
  });
export type OnboardingAssignInput = z.infer<typeof OnboardingAssignInputSchema>;
