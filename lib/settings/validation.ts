/**
 * lib/settings/validation.ts — zod input schemas for the Settings forms.
 * Shared by the client components and the Server Actions (lib/settings/actions.ts
 * re-validates — never trust the client), per CLAUDE.md "Forms: react-hook-form
 * + zod" (these forms are small enough to skip react-hook-form itself and
 * just parse on submit, matching lib/expenses/validation.ts's simpler forms).
 */

import { z } from "zod";
import { ConcurrencyPresetSchema } from "@/types/db";

export const AddOrderingRuleSchema = z.object({
  text: z.string().trim().min(1, "A rule needs some text").max(200),
});
export type AddOrderingRuleInput = z.infer<typeof AddOrderingRuleSchema>;

export const DistributorFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  method: z.enum(["rest", "browse"]),
  baseUrl: z.string().trim().max(500).nullable().optional(),
  defaultRegion: z.string().trim().max(10).nullable().optional(),
});
export type DistributorFormInput = z.infer<typeof DistributorFormSchema>;

export const AppConfigFormSchema = z.object({
  labelSize: z.enum(["avery_l7651"]).optional(),
  concurrencyDefault: ConcurrencyPresetSchema.optional(),
  lowStockDefaultThreshold: z.number().int().min(0).nullable().optional(),
});
export type AppConfigFormInput = z.infer<typeof AppConfigFormSchema>;
