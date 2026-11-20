import { base, type Height } from "./budget-table.js";

export type { Height } from "./budget-table.js";

/**
 * The budgets of `budget-table.ts`, scaled for where the tests run: a CI runner
 * has no GPU and shares its CPU, so they are multiplied there. Override with
 * GLOW_BUDGET_SCALE (e.g. GLOW_BUDGET_SCALE=3 bun run test:e2e).
 */
export const scale = Number(
  process.env.GLOW_BUDGET_SCALE ?? (process.env.CI ? 4 : 1)
);

export const budget = {
  latencyMs: (height: Height) => base.latencyMs[height] * scale,
  mainThreadMs: (height: Height) => base.mainThreadMs[height] * scale,
  watcherMs: (height: Height) => base.watcherMs[height] * scale,
};
