/**
 * lib/audit — the guided box-audit package (FEATURES.md §5.4/§9,
 * plan/tab-shelves.md R2-25/Q-10). Barrel re-export: pure math (`variance`),
 * client-side resumable progress (`progress`), and the DB-writing server
 * action (`actions`, `"use server"`).
 */

export * from "./types";
export * from "./variance";
export * from "./progress";
export * from "./actions";
