/**
 * Berth & Crane Optimisation Engine
 * ------------------------------------
 * Deterministic greedy heuristic. Same input → same output.
 * Architecture is designed to allow replacement with OR-Tools later.
 *
 * Scoring: higher = better.
 * Two-pass approach:
 *   Pass 1 — Berth assignment (priority-sorted, greedy best-score)
 *   Pass 2 — Crane reassignment (priority-sorted, covers shortfalls from idle pool)
 */
import type { Vessel, Berth, Crane, RiskProfile } from '../types';
import { calculateBerthRisk, CURRENT_TIME } from './congestionEngine';
import { detectConflicts, getBerthUtilisation } from './resourceConflictEngine';
import { estimateRequiredCranes, PRIORITY_WEIGHT } from '../utils/vesselUtils';

export { CURRENT_TIME };



// ── Waiting-Time Model ────────────────────────────────────────────────────────
//
// For every candidate vessel (Inbound | Anchored | Delayed) we compute how long
// it must wait before it can enter a berth, given the berth's current occupancy
// and expected-release time.
//
// Rules (all deterministic, data-driven):
//   case 1 — Berth is Available:          wait = 0 h
//   case 2 — Berth is Occupied, release known and BEFORE vessel ETA:
//             wait = 0 h  (berth free by the time vessel arrives)
//   case 3 — Berth is Occupied, release known and AFTER vessel ETA:
//             wait = (releaseMs - etaMs) / 3_600_000  hours
//   case 4 — Berth is Occupied, no release known:
//             wait = DEFAULT_OCCUPIED_WAIT_H  (documented constant)
//   case 5 — Berth is Maintenance:        wait = DEFAULT_MAINTENANCE_WAIT_H
//   case 6 — No berth assigned:           wait = DEFAULT_UNASSIGNED_WAIT_H
//
// The same function is called for baseline and optimised states (same formula,
// different input vessel→berth mapping), so BEFORE vs AFTER is directly comparable.

const DEFAULT_OCCUPIED_WAIT_H     = 4;  // hours: occupied berth with unknown release
const DEFAULT_MAINTENANCE_WAIT_H  = 8;  // hours: maintenance berth
const DEFAULT_UNASSIGNED_WAIT_H   = 6;  // hours: no berth assigned

export function vesselWaitHours(vessel: Vessel, berthId: string | null | undefined, berths: Berth[]): number {
  if (!berthId) return DEFAULT_UNASSIGNED_WAIT_H;
  const berth = berths.find(b => b.id === berthId);
  if (!berth) return DEFAULT_UNASSIGNED_WAIT_H;
  if (berth.status === 'Maintenance') return DEFAULT_MAINTENANCE_WAIT_H;
  if (berth.status === 'Available')  return 0;

  // Occupied
  if (!berth.expectedRelease) return DEFAULT_OCCUPIED_WAIT_H;
  const releaseMs = new Date(berth.expectedRelease).getTime();
  const etaMs     = new Date(vessel.eta).getTime();
  return Math.max(0, (releaseMs - etaMs) / 3_600_000);
}

/** Total estimated waiting hours across all candidate vessels */
export function totalEstimatedWaitHours(
  vessels: Vessel[],
  berths: Berth[],
  overrideBerthMap: Record<string, string | null> = {}
): number {
  const candidates = vessels.filter(v =>
    v.status === 'Inbound' || v.status === 'Anchored' || v.status === 'Delayed'
  );
  return candidates.reduce((sum, v) => {
    const berthId = overrideBerthMap[v.id] !== undefined ? overrideBerthMap[v.id] : v.scheduledBerthId;
    return sum + vesselWaitHours(v, berthId, berths);
  }, 0);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AssignmentChange {
  vesselId: string;
  vesselName: string;
  type: 'berth' | 'crane';
  fromId: string | null;
  toId: string;
  toName: string;
  score: number;
  reason: string;
  factors: string[];
  impact: string;
}

export interface OptimizationMetrics {
  estimatedWaitingHours: number;
  activeConflicts: number;
  craneShortfalls: number;
  berthsAtRisk: number;
  averageBerthUtilisation: number;
  unassignedVessels: number;
}

export interface OptimizationResult {
  status: 'improved' | 'no_change' | 'infeasible';
  baseline: OptimizationMetrics;
  optimized: OptimizationMetrics;
  waitingTimeImprovementHours: number;
  waitingTimeImprovementPct: number | null; // null when baseline = 0
  changes: AssignmentChange[];
  /** Preview-only — NOT applied to Zustand until user confirms */
  proposedVesselBerths: Record<string, string | null>;
  proposedCraneAssignments: Record<string, string | null>;
  unresolvedConflicts: string[];
}

// ── Berth Eligibility ─────────────────────────────────────────────────────────
//
// A berth is INELIGIBLE (hard constraint) when:
//   (a) It is under Maintenance.
//   (b) It is currently Occupied AND the berth's release time is unknown.
//   (c) It is currently Occupied AND the vessel's ETA is BEFORE the release time
//       (i.e. the candidate vessel would arrive while the berth is still busy).
//   (d) Another vessel has been tentatively assigned to it in the current pass.
//   (e) The vessel's cargoSize exceeds the berth's physical capacity.
//
// A berth that becomes free BEFORE the candidate vessel arrives (release <= ETA)
// IS eligible, but still receives a waiting-time component in its score when
// the wait is non-zero.
//
// This distinction is important: ineligibility is binary / hard;
// scoring penalties are continuous / soft.

function isBerthEligible(
  berth: Berth,
  vessel: Vessel,
  tentativeOccupants: Map<string, string | null>
): boolean {
  // (a) Maintenance
  if (berth.status === 'Maintenance') return false;

  // (d) Tentatively claimed in this optimisation pass by a different vessel
  const tentative = tentativeOccupants.get(berth.id);
  if (tentative !== undefined && tentative !== null && tentative !== vessel.id) return false;

  // (b + c) Occupied — check release timing
  if (berth.status === 'Occupied' && berth.currentVesselId && berth.currentVesselId !== vessel.id) {
    if (!berth.expectedRelease) return false;  // (b) unknown release
    const releaseMs = new Date(berth.expectedRelease).getTime();
    const etaMs     = new Date(vessel.eta).getTime();
    if (etaMs < releaseMs) return false;       // (c) vessel arrives before berth frees
    // berth frees before ETA → eligible (receives no waiting-time penalty)
  }

  // (e) Capacity
  if (berth.capacity > 0 && vessel.cargoSize > berth.capacity) return false;

  return true;
}

// ── Berth Scoring (higher = better) ──────────────────────────────────────────
//
//  Component                   Range      Weight / Rationale
//  priorityBonus               +10–40     vessel urgency
//  waitingTimePenalty          −0–25      actual estimated wait from schedule data
//  congestionPenalty           −0–30      existing berth risk score / 100 × 30
//  craneShortagePenalty        −5 each    active cranes below requirement
//  capacityHeadroomBonus       +0–5       lower utilisation = more headroom

function scoreBerth(
  berth: Berth,
  vessel: Vessel,
  vessels: Vessel[],
  cranes: Crane[]
): { score: number; factors: string[]; waitHours: number } {
  let score = 0;
  const factors: string[] = [];

  // Priority bonus
  const pBonus = (PRIORITY_WEIGHT[vessel.priority] ?? 2) * 10;
  score += pBonus;
  factors.push(`Priority bonus +${pBonus} (${vessel.priority})`);

  // Waiting-time penalty (capped at 25 pts for ≥10h wait)
  // Computed inline from berth directly to avoid type conversion
  let waitHours = 0;
  if (berth.status === 'Available') {
    waitHours = 0;
  } else if (berth.status === 'Maintenance') {
    waitHours = DEFAULT_MAINTENANCE_WAIT_H;
  } else if (berth.status === 'Occupied') {
    if (!berth.expectedRelease) {
      waitHours = DEFAULT_OCCUPIED_WAIT_H;
    } else {
      const releaseMs = new Date(berth.expectedRelease).getTime();
      const etaMs     = new Date(vessel.eta).getTime();
      waitHours = Math.max(0, (releaseMs - etaMs) / 3_600_000);
    }
  }
  const waitPenalty = Math.min(25, Math.round(waitHours * 2.5));
  score -= waitPenalty;
  if (waitPenalty > 0) factors.push(`Waiting-time penalty -${waitPenalty} (est. ${waitHours.toFixed(1)}h wait)`);
  else factors.push('No waiting time expected (berth available)');

  // Congestion penalty
  const risk: RiskProfile = calculateBerthRisk(berth, vessels, cranes);
  const congestionPenalty = Math.round((risk.score / 100) * 30);
  score -= congestionPenalty;
  if (congestionPenalty > 0) factors.push(`Congestion penalty -${congestionPenalty} (risk ${risk.level})`);

  // Crane shortage penalty
  const required = estimateRequiredCranes(vessel);
  const activeAtBerth = cranes.filter(c => c.assignedBerthId === berth.id && c.status === 'Active').length;
  const shortage = Math.max(0, required - activeAtBerth);
  if (shortage > 0) {
    const cranePenalty = shortage * 5;
    score -= cranePenalty;
    factors.push(`Crane shortage penalty -${cranePenalty} (${shortage} crane(s) short)`);
  } else {
    factors.push(`Crane capacity adequate (${activeAtBerth} active, ${required} required)`);
  }

  // Capacity headroom bonus
  if (berth.capacity > 0) {
    const utilisationFraction = Math.min(1, vessel.cargoSize / berth.capacity);
    const capBonus = Math.round((1 - utilisationFraction) * 5);
    score += capBonus;
    if (capBonus > 0) factors.push(`Capacity headroom bonus +${capBonus} (${Math.round(utilisationFraction * 100)}% loaded)`);
  }

  return { score, factors, waitHours };
}

// ── Metrics ──────────────────────────────────────────────────────────────────

function calculateMetrics(
  vessels: Vessel[],
  berths: Berth[],
  cranes: Crane[],
  vesselBerthOverride: Record<string, string | null> = {}
): OptimizationMetrics {
  // Apply override map for projected state
  const effectiveVessels = vessels.map(v => ({
    ...v,
    scheduledBerthId: vesselBerthOverride[v.id] !== undefined
      ? vesselBerthOverride[v.id]
      : v.scheduledBerthId,
  }));

  const conflicts = detectConflicts(berths, cranes, effectiveVessels);
  const atRisk = berths.filter(b => {
    const r = calculateBerthRisk(b, effectiveVessels, cranes);
    return r.level === 'HIGH' || r.level === 'CRITICAL';
  }).length;
  const avgUtil = Math.round(
    berths.reduce((sum, b) => sum + getBerthUtilisation(b, effectiveVessels), 0) / (berths.length || 1)
  );
  const craneShortfalls = effectiveVessels
    .filter(v => v.scheduledBerthId && (v.status === 'Moored' || v.status === 'Anchored' || v.status === 'Inbound' || v.status === 'Delayed'))
    .filter(v => {
      const required = estimateRequiredCranes(v);
      const active = cranes.filter(c => c.assignedBerthId === v.scheduledBerthId && c.status === 'Active').length;
      return active < required;
    }).length;
  const unassigned = effectiveVessels.filter(
    v => !v.scheduledBerthId && (v.status === 'Inbound' || v.status === 'Anchored')
  ).length;
  const estimatedWaitingHours = totalEstimatedWaitHours(vessels, berths, vesselBerthOverride);

  return { estimatedWaitingHours, activeConflicts: conflicts.length, craneShortfalls, berthsAtRisk: atRisk, averageBerthUtilisation: avgUtil, unassignedVessels: unassigned };
}

// ── Main Engine ───────────────────────────────────────────────────────────────

export function runOptimization(
  vessels: Vessel[],
  berths: Berth[],
  cranes: Crane[]
): OptimizationResult {
  const baseline = calculateMetrics(vessels, berths, cranes);
  const changes: AssignmentChange[] = [];
  const unresolvedConflicts: string[] = [];

  // ── Pass 1: Berth Assignment ──────────────────────────────────────────────
  //
  // Candidates: Inbound, Anchored, Delayed — sorted descending by priority weight.
  // Higher-priority vessels claim berths first (greedy).

  const candidates = vessels
    .filter(v => v.status === 'Inbound' || v.status === 'Anchored' || v.status === 'Delayed')
    .sort((a, b) => (PRIORITY_WEIGHT[b.priority] ?? 2) - (PRIORITY_WEIGHT[a.priority] ?? 2));

  const proposedVesselBerths: Record<string, string | null> = {};

  // Seed tentative occupants from current real assignments (Moored vessels hold their berths)
  const tentativeOccupants = new Map<string, string | null>();
  berths.forEach(b => { if (b.currentVesselId) tentativeOccupants.set(b.id, b.currentVesselId); });

  for (const vessel of candidates) {
    const eligible = berths.filter(b => isBerthEligible(b, vessel, tentativeOccupants));

    if (eligible.length === 0) {
      unresolvedConflicts.push(`${vessel.name}: no eligible berth found — may need to hold in anchorage`);
      proposedVesselBerths[vessel.id] = vessel.scheduledBerthId ?? null;
      continue;
    }

    const scored = eligible
      .map(b => ({ berth: b, ...scoreBerth(b, vessel, vessels, cranes) }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    proposedVesselBerths[vessel.id] = best.berth.id;

    if (best.berth.id !== (vessel.scheduledBerthId ?? null)) {
      const waitImprovement = vesselWaitHours(vessel, vessel.scheduledBerthId, berths)
        - vesselWaitHours(vessel, best.berth.id, berths);
      const waitStr = waitImprovement > 0
        ? `reduces estimated wait by ${waitImprovement.toFixed(1)}h`
        : 'maintains current wait time';

      changes.push({
        vesselId: vessel.id,
        vesselName: vessel.name,
        type: 'berth',
        fromId: vessel.scheduledBerthId ?? null,
        toId: best.berth.id,
        toName: best.berth.name,
        score: best.score,
        reason: vessel.scheduledBerthId
          ? `${best.berth.id} scores ${best.score} vs current ${vessel.scheduledBerthId}`
          : `${best.berth.id} is best available berth (score ${best.score})`,
        factors: best.factors,
        impact: waitStr.charAt(0).toUpperCase() + waitStr.slice(1),
      });
      tentativeOccupants.set(best.berth.id, vessel.id);
    }
  }

  // ── Pass 2: Crane Reassignment ─────────────────────────────────────────────
  //
  // Safety rules:
  //   - Only IDLE cranes are moved (Active cranes stay in place).
  //   - FAULT and MAINTENANCE cranes are never assigned.
  //   - Operations processed in priority order — higher-priority vessels claim cranes first.
  //   - Once a crane is committed to an operation in this pass it is not available to others.

  const proposedCraneAssignments: Record<string, string | null> = {};

  // Pool: idle cranes (sorted best efficiency first)
  const idleCranePool = cranes
    .filter(c => c.status === 'Idle')
    .sort((a, b) => b.efficiency - a.efficiency);

  const committedCraneIds = new Set<string>();

  // Sort occupied berths by their vessel's priority (Critical first)
  const occupiedBerthOps = berths
    .filter(b => b.status === 'Occupied' && b.currentVesselId)
    .map(b => {
      const vessel = vessels.find(v => v.id === b.currentVesselId)!;
      return { berth: b, vessel };
    })
    .filter(({ vessel }) => !!vessel)
    .sort((a, b) => (PRIORITY_WEIGHT[b.vessel.priority] ?? 2) - (PRIORITY_WEIGHT[a.vessel.priority] ?? 2));

  for (const { berth, vessel } of occupiedBerthOps) {
    const required  = estimateRequiredCranes(vessel);
    const activeNow = cranes.filter(c => c.assignedBerthId === berth.id && c.status === 'Active').length;
    const shortfall = required - activeNow;
    if (shortfall <= 0) continue;

    for (let i = 0; i < shortfall; i++) {
      const crane = idleCranePool.find(c => !committedCraneIds.has(c.id));
      if (!crane) {
        unresolvedConflicts.push(`${berth.id}: crane shortfall of ${shortfall - i} cannot be resolved — no idle cranes remain`);
        break;
      }
      committedCraneIds.add(crane.id);
      proposedCraneAssignments[crane.id] = berth.id;
      changes.push({
        vesselId: vessel.id,
        vesselName: vessel.name,
        type: 'crane',
        fromId: crane.assignedBerthId ?? null,
        toId: berth.id,
        toName: berth.name,
        score: crane.efficiency,
        reason: `${crane.name} (idle, ${crane.efficiency} mv/h) assigned to cover shortfall at ${berth.id}`,
        factors: [
          `${berth.id} has ${activeNow} active cranes, requires ${required}`,
          `${vessel.name} priority: ${vessel.priority}`,
          `${crane.name} efficiency: ${crane.efficiency} moves/hr`,
        ],
        impact: `Restores ${crane.efficiency} moves/hr capacity at ${berth.id}`,
      });
    }
  }

  // ── Projected metrics — true AFTER state ──────────────────────────────────
  // Build projected crane array for metrics calculation
  const projectedCranes: Crane[] = cranes.map(c => ({
    ...c,
    assignedBerthId: proposedCraneAssignments[c.id] !== undefined
      ? proposedCraneAssignments[c.id]
      : c.assignedBerthId,
    status: proposedCraneAssignments[c.id] !== undefined ? 'Active' as const : c.status,
  }));

  // calculateMetrics uses the berth override map and projected cranes
  const optimized = calculateMetrics(vessels, berths, projectedCranes, proposedVesselBerths);

  // Waiting-time improvement
  const waitingTimeImprovementHours = baseline.estimatedWaitingHours - optimized.estimatedWaitingHours;
  const waitingTimeImprovementPct = baseline.estimatedWaitingHours > 0
    ? Math.round((waitingTimeImprovementHours / baseline.estimatedWaitingHours) * 100)
    : null;

  const improved =
    optimized.estimatedWaitingHours < baseline.estimatedWaitingHours ||
    optimized.activeConflicts < baseline.activeConflicts ||
    optimized.craneShortfalls < baseline.craneShortfalls ||
    optimized.berthsAtRisk < baseline.berthsAtRisk ||
    optimized.unassignedVessels < baseline.unassignedVessels;

  return {
    status: changes.length === 0 ? 'no_change' : improved ? 'improved' : 'no_change',
    baseline,
    optimized,
    waitingTimeImprovementHours,
    waitingTimeImprovementPct,
    changes,
    proposedVesselBerths,
    proposedCraneAssignments,
    unresolvedConflicts,
  };
}

/**
 * Public metric computation API — reusable by simulationEngine.ts.
 * Accepts an explicit state so it works on both live and simulated states.
 * Uses the same methodology as the internal optimisation baseline.
 */
export function computePortMetrics(
  vessels: Vessel[],
  berths: Berth[],
  cranes: Crane[]
): OptimizationMetrics {
  return calculateMetrics(vessels, berths, cranes);
}
