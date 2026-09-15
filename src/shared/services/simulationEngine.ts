/**
 * What-If Simulation Engine
 * -------------------------
 * Deterministic — same live state + scenario → same result.
 * Never touches Zustand. Operates only on deep-cloned state.
 *
 * Architecture supports single active scenario; multi-scenario
 * can be added by extending ScenarioConfig to an array.
 */
import type { Vessel, Berth, Crane } from '../types';
import { CURRENT_TIME } from './congestionEngine';
import { runOptimization, computePortMetrics } from './optimizationEngine';
import type { OptimizationMetrics, OptimizationResult } from './optimizationEngine';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ScenarioType = 'vessel_delay' | 'crane_outage' | 'early_arrival';

export const SCENARIO_LABELS: Record<ScenarioType, string> = {
  vessel_delay:  'Vessel Delay',
  crane_outage:  'Crane Outage',
  early_arrival: 'Early Vessel Arrival',
};

export const SCENARIO_DESCRIPTIONS: Record<ScenarioType, string> = {
  vessel_delay:  'Push the selected vessel\'s ETA and ETD forward by the specified hours.',
  crane_outage:  'Mark the selected crane as unavailable for the specified duration.',
  early_arrival: 'Pull the selected vessel\'s ETA earlier by the specified hours (ETD unchanged).',
};

export interface ScenarioConfig {
  type: ScenarioType;
  entityId: string;   // vesselId or craneId
  durationHours: number;
}

export interface DisruptionEvent {
  label: string;
  /** Offset from NOW in hours — can be negative for early arrivals */
  startOffsetHours: number;
  /** null for point events; set for duration events (crane outage) */
  endOffsetHours: number | null;
  type: 'delay' | 'outage' | 'early';
}

export interface SimulationResult {
  scenario: ScenarioConfig;
  entityLabel: string;
  baselineMetrics: OptimizationMetrics;
  disruptedMetrics: OptimizationMetrics;
  optimizationResult: OptimizationResult;
  disruption: DisruptionEvent;
  /**
   * Fingerprint of the live state at simulation time.
   * Used to detect staleness before applying recommendations.
   */
  liveStateFingerprint: string;
  simulatedAt: string;
}

export interface SimulationError {
  error: string;
}

export type SimulationOutcome = SimulationResult | SimulationError;

export function isSimulationError(r: SimulationOutcome): r is SimulationError {
  return 'error' in r;
}

// ── Deep clone ────────────────────────────────────────────────────────────────
// Safe for plain-object state — no functions, no circular refs.

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

// ── State fingerprint ─────────────────────────────────────────────────────────
//
// Captures every field that a simulation recommendation could affect.
// If any of these differ between simulation-time and apply-time,
// the simulation is stale and must be re-run.

export function stateFingerprint(vessels: Vessel[], cranes: Crane[], berths: Berth[]): string {
  const vFP = vessels
    .map(v => `${v.id}:${v.scheduledBerthId ?? ''}:${v.eta}:${v.etd}:${v.status}`)
    .sort()
    .join('|');
  const cFP = cranes
    .map(c => `${c.id}:${c.status}:${c.assignedBerthId ?? ''}`)
    .sort()
    .join('|');
  // berth.status, currentVesselId, expectedRelease — all consumed by isBerthEligible and detectConflicts
  const bFP = berths
    .map(b => `${b.id}:${b.status}:${b.currentVesselId ?? ''}:${b.expectedRelease ?? ''}`)
    .sort()
    .join('|');
  return `${vFP}§${cFP}§${bFP}`;
}

// ── Scenario application ──────────────────────────────────────────────────────
//
// Returns a DEEP-CLONED mutated state. The original arrays are never modified.
// Each case is documented with the exact mutation it applies.

function applyScenario(
  vessels: Vessel[],
  berths: Berth[],
  cranes: Crane[],
  scenario: ScenarioConfig
): { vessels: Vessel[]; berths: Berth[]; cranes: Crane[] } {
  const v = deepClone(vessels);
  const b = deepClone(berths);
  const c = deepClone(cranes);

  switch (scenario.type) {
    case 'vessel_delay': {
      // ETA += delay, ETD += delay, status → Delayed
      const vessel = v.find(x => x.id === scenario.entityId);
      if (vessel) {
        const delayMs = scenario.durationHours * 3_600_000;
        vessel.eta    = new Date(new Date(vessel.eta).getTime() + delayMs).toISOString();
        vessel.etd    = new Date(new Date(vessel.etd).getTime() + delayMs).toISOString();
        vessel.status = 'Delayed';
      }
      break;
    }

    case 'crane_outage': {
      const outageEndMs = new Date(CURRENT_TIME).getTime() + scenario.durationHours * 3_600_000;
      const crane = c.find(x => x.id === scenario.entityId);
      if (crane) {
        // Find the vessel this crane is currently serving (if any)
        const assignedBerth = b.find(berth => berth.id === crane.assignedBerthId);
        const servedVessel  = assignedBerth?.currentVesselId
          ? v.find(vessel => vessel.id === assignedBerth.currentVesselId)
          : undefined;
        const vesselEtdMs = servedVessel ? new Date(servedVessel.etd).getTime() : 0;

        if (servedVessel && outageEndMs < vesselEtdMs) {
          // Outage ends BEFORE the served vessel departs:
          //   the crane is temporarily removed but returns during the operation.
          //   Model as Idle (unassigned): the optimiser may reassign it; produces
          //   a lighter disruption than a long outage → different metrics.
          crane.status          = 'Idle';
          crane.assignedBerthId = null;
        } else {
          // Outage covers the full remaining handling window, or the crane is not
          // currently serving a vessel — remove from service entirely.
          crane.status = 'Maintenance';
        }
      }
      break;
    }

    case 'early_arrival': {
      // ETA -= hours (ETD unchanged — vessel handles same cargo but arrives sooner)
      const vessel = v.find(x => x.id === scenario.entityId);
      if (vessel) {
        const shiftMs = scenario.durationHours * 3_600_000;
        vessel.eta    = new Date(new Date(vessel.eta).getTime() - shiftMs).toISOString();
      }
      break;
    }
  }

  return { vessels: v, berths: b, cranes: c };
}

// ── Main simulation pipeline ──────────────────────────────────────────────────

export function runSimulation(
  liveVessels: Vessel[],
  liveBerths: Berth[],
  liveCranes: Crane[],
  scenario: ScenarioConfig
): SimulationOutcome {
  // Validate inputs
  if (!scenario.entityId) {
    return { error: 'No entity selected for the scenario.' };
  }
  if (!Number.isFinite(scenario.durationHours) || scenario.durationHours <= 0) {
    return { error: 'Duration must be a positive number of hours.' };
  }
  if (scenario.durationHours > 72) {
    return { error: 'Duration cannot exceed the 72-hour planning window.' };
  }

  // Validate entity exists
  if (scenario.type === 'vessel_delay' || scenario.type === 'early_arrival') {
    if (!liveVessels.find(v => v.id === scenario.entityId)) {
      return { error: `Vessel ${scenario.entityId} not found in operational state.` };
    }
  } else {
    if (!liveCranes.find(c => c.id === scenario.entityId)) {
      return { error: `Crane ${scenario.entityId} not found in operational state.` };
    }
  }

  // Entity label for display
  const NOW_MS  = new Date(CURRENT_TIME).getTime();
  let entityLabel = scenario.entityId;
  let entityEtaOffsetH = 0;

  if (scenario.type === 'vessel_delay' || scenario.type === 'early_arrival') {
    const vessel    = liveVessels.find(v => v.id === scenario.entityId)!;
    entityLabel     = vessel.name;
    entityEtaOffsetH = (new Date(vessel.eta).getTime() - NOW_MS) / 3_600_000;
  } else {
    const crane = liveCranes.find(c => c.id === scenario.entityId)!;
    entityLabel = crane.name;
    entityEtaOffsetH = 0; // outage starts now
  }

  // ── Step 1: Baseline metrics (live state) ─────────────────────────────────
  const baselineMetrics = computePortMetrics(liveVessels, liveBerths, liveCranes);

  // ── Step 2: Apply scenario to deep clone ──────────────────────────────────
  const { vessels: simV, berths: simB, cranes: simC } = applyScenario(
    liveVessels, liveBerths, liveCranes, scenario
  );

  // ── Step 3: Disrupted metrics ─────────────────────────────────────────────
  const disruptedMetrics = computePortMetrics(simV, simB, simC);

  // ── Step 4: Optimisation on simulated state ───────────────────────────────
  const optimizationResult = runOptimization(simV, simB, simC);

  // ── Step 5: Build disruption event for timeline ───────────────────────────
  const disruption: DisruptionEvent = {
    label: entityLabel,
    startOffsetHours: entityEtaOffsetH,
    endOffsetHours: scenario.type === 'crane_outage'
      ? entityEtaOffsetH + scenario.durationHours
      : null,
    type: scenario.type === 'vessel_delay' ? 'delay'
        : scenario.type === 'crane_outage' ? 'outage'
        : 'early',
  };

  return {
    scenario,
    entityLabel,
    baselineMetrics,
    disruptedMetrics,
    optimizationResult,
    disruption,
    liveStateFingerprint: stateFingerprint(liveVessels, liveCranes, liveBerths),
    simulatedAt: CURRENT_TIME,
  };
}
