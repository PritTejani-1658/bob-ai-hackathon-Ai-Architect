import type { Vessel } from '../types';

/**
 * Single deterministic source for vessel crane requirement.
 * Based on cargo size. The Vessel type has no requiredCranes field,
 * so this function is the canonical definition used by:
 *   - optimizationEngine.ts
 *   - planningEngine.ts
 * Do NOT maintain a separate copy elsewhere.
 */
export function estimateRequiredCranes(vessel: Vessel): number {
  if (vessel.cargoSize >= 15_000) return 3;
  if (vessel.cargoSize >= 8_000)  return 2;
  return 1;
}

/** Numeric sort weight per priority level (higher = more urgent) */
export const PRIORITY_WEIGHT: Record<string, number> = {
  Critical: 4,
  High:     3,
  Normal:   2,
  Low:      1,
};
