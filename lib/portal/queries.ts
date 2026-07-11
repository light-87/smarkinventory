/**
 * lib/portal/queries.ts — server-side reads for the client portal, wrapping
 * the two SECURITY DEFINER RPCs (supabase/migrations/0006_portal_fns.sql)
 * behind zod validation.
 *
 * Wrapped in React's `cache()` so `generateMetadata` and the page component
 * (both calling `getPortalProject` with the same token during one request)
 * share a single round trip instead of two.
 */

import { cache } from "react";
import { createPortalAnonClient } from "./anon-client";
import {
  EMPTY_PORTAL_REQUESTS,
  EMPTY_PORTAL_SHARED,
  PortalPmPayloadSchema,
  PortalProjectPayloadSchema,
  PortalRequestsPayloadSchema,
  PortalSharedPayloadSchema,
  type PortalPmPayload,
  type PortalProjectPayload,
  type PortalRequestsPayload,
  type PortalSharedPayload,
} from "./types";

/** Null = unknown/regenerated token OR an archived project — deliberately indistinguishable (FEATURES §11). */
export const getPortalProject = cache(async (token: string): Promise<PortalProjectPayload | null> => {
  if (!token) return null;

  const supabase = createPortalAnonClient();
  const { data, error } = await supabase.rpc("portal_get_project", { p_token: token });

  if (error) {
    console.error("[portal] portal_get_project RPC failed:", error.message);
    return null;
  }
  if (data === null) return null;

  const parsed = PortalProjectPayloadSchema.safeParse(data);
  if (!parsed.success) {
    console.error("[portal] portal_get_project payload failed validation:", parsed.error.message);
    return null;
  }
  return parsed.data;
});

/** Empty lists (never null) on any failure — the page still renders the timeline even if this leg fails. */
export const getPortalShared = cache(async (token: string): Promise<PortalSharedPayload> => {
  if (!token) return EMPTY_PORTAL_SHARED;

  const supabase = createPortalAnonClient();
  const { data, error } = await supabase.rpc("portal_get_shared", { p_token: token });

  if (error) {
    console.error("[portal] portal_get_shared RPC failed:", error.message);
    return EMPTY_PORTAL_SHARED;
  }
  if (data === null) return EMPTY_PORTAL_SHARED;

  const parsed = PortalSharedPayloadSchema.safeParse(data);
  if (!parsed.success) {
    console.error("[portal] portal_get_shared payload failed validation:", parsed.error.message);
    return EMPTY_PORTAL_SHARED;
  }
  return parsed.data;
});

/**
 * `portal_get_pm(p_token)` (supabase/migrations/0010_pm.sql) — task list +
 * progress. Null on any failure (bad/archived token, RPC error, or a payload
 * that fails validation): the page treats a null PM payload as "nothing to
 * show" rather than 404ing the whole portal, since `getPortalProject`
 * already owns the not-found decision for this token.
 */
export const getPortalPm = cache(async (token: string): Promise<PortalPmPayload | null> => {
  if (!token) return null;

  const supabase = createPortalAnonClient();
  const { data, error } = await supabase.rpc("portal_get_pm", { p_token: token });

  if (error) {
    console.error("[portal] portal_get_pm RPC failed:", error.message);
    return null;
  }
  if (data === null) return null;

  const parsed = PortalPmPayloadSchema.safeParse(data);
  if (!parsed.success) {
    console.error("[portal] portal_get_pm payload failed validation:", parsed.error.message);
    return null;
  }
  return parsed.data;
});

/**
 * `portal_get_requests(p_token)` (0014_portal_requests.sql) — the client's own
 * raised change requests + bug reports with status. Empty list (never null) on
 * any failure: the "Your requests" card just shows its empty state rather than
 * breaking the page.
 */
export const getPortalRequests = cache(async (token: string): Promise<PortalRequestsPayload> => {
  if (!token) return EMPTY_PORTAL_REQUESTS;

  const supabase = createPortalAnonClient();
  const { data, error } = await supabase.rpc("portal_get_requests", { p_token: token });

  if (error) {
    console.error("[portal] portal_get_requests RPC failed:", error.message);
    return EMPTY_PORTAL_REQUESTS;
  }
  if (data === null) return EMPTY_PORTAL_REQUESTS;

  const parsed = PortalRequestsPayloadSchema.safeParse(data);
  if (!parsed.success) {
    console.error("[portal] portal_get_requests payload failed validation:", parsed.error.message);
    return EMPTY_PORTAL_REQUESTS;
  }
  return parsed.data;
});
