import type { Vessel, Berth, Crane, RiskProfile } from '../types';
import { calculateBerthRisk } from './congestionEngine';
import { estimateRequiredCranes } from '../utils/vesselUtils';

// Re-export the canonical simulation clock so the entire app shares one reference
export { CURRENT_TIME } from './congestionEngine';

export const PLAN_HOURS = 72;

// ─── Time Bucket ─────────────────────────────────────────────────────────────

export type TimeBucket = 'now-24' | '24-48' | '48-72';

export function getBucket(isoTimestamp: string, nowMs: number): TimeBucket | null {
  const t = new Date(isoTimestamp).getTime();
  const hoursOffset = (t - nowMs) / (1000 * 60 * 60);
  if (hoursOffset < 0 || hoursOffset > PLAN_HOURS) return null;
  if (hoursOffset <= 24) return 'now-24';
  if (hoursOffset <= 48) return '24-48';
  return '48-72';
}

// ─── Planned Vessel Operation ─────────────────────────────────────────────────

export interface PlannedOperation {
  vessel: Vessel;
  berthId: string | null;
  etaMs: number;
  etdMs: number;
  etaBucket: TimeBucket | null;
  etdBucket: TimeBucket | null;
  handlingDurationHours: number;
  risk: RiskProfile;
  requiredCranes: number;
  assignedCranes: Crane[];
  craneShortfall: number;
  barStartPct: number;
  barWidthPct: number;
}

export function buildPlannedOperations(
  vessels: Vessel[],
  berths: Berth[],
  cranes: Crane[],
  nowMs: number
): PlannedOperation[] {
  const planEnd = nowMs + PLAN_HOURS * 60 * 60 * 1000;

  return vessels
    .filter(v => {
      const eta = new Date(v.eta).getTime();
      const etd = new Date(v.etd).getTime();
      return etd > nowMs && eta < planEnd;
    })
    .map(v => {
      const etaMs = new Date(v.eta).getTime();
      const etdMs = new Date(v.etd).getTime();
      const berthId = v.scheduledBerthId ?? null;
      const berth = berths.find(b => b.id === berthId) ?? null;
      const risk: RiskProfile = berth
        ? calculateBerthRisk(berth, vessels, cranes)
        : { score: 0, level: 'LOW', timeToCongestionHours: null, factors: [] };

      const requiredCranes = estimateRequiredCranes(v);
      const assignedCranes = cranes.filter(
        c => c.assignedBerthId === berthId && c.status === 'Active'
      );
      const craneShortfall = Math.max(0, requiredCranes - assignedCranes.length);

      const planWindowMs = PLAN_HOURS * 60 * 60 * 1000;
      const barStart = Math.max(0, etaMs - nowMs);
      const barEnd = Math.min(planWindowMs, etdMs - nowMs);
      const barStartPct = (barStart / planWindowMs) * 100;
      const barWidthPct = Math.max(0.5, ((barEnd - barStart) / planWindowMs) * 100);

      return {
        vessel: v,
        berthId,
        etaMs,
        etdMs,
        etaBucket: getBucket(v.eta, nowMs),
        etdBucket: getBucket(v.etd, nowMs),
        handlingDurationHours: v.handlingDurationHours,
        risk,
        requiredCranes,
        assignedCranes,
        craneShortfall,
        barStartPct,
        barWidthPct,
      };
    })
    .sort((a, b) => a.etaMs - b.etaMs);
}

// ─── Bucket Summary ───────────────────────────────────────────────────────────

export interface BucketSummary {
  bucket: TimeBucket;
  label: string;
  timeRange: string;
  operations: PlannedOperation[];
  highPriorityCount: number;
  atRiskCount: number;
  criticalCount: number;
}

export function buildBucketSummaries(
  ops: PlannedOperation[],
  nowMs: number
): BucketSummary[] {
  const buckets: { bucket: TimeBucket; label: string; startH: number; endH: number }[] = [
    { bucket: 'now-24', label: 'Today', startH: 0, endH: 24 },
    { bucket: '24-48', label: '+24 – 48 Hours', startH: 24, endH: 48 },
    { bucket: '48-72', label: '+48 – 72 Hours', startH: 48, endH: 72 },
  ];

  return buckets.map(({ bucket, label, startH, endH }) => {
    const startMs = nowMs + startH * 3600_000;
    const endMs   = nowMs + endH * 3600_000;
    const bucketOps = ops.filter(op => op.etaMs >= startMs && op.etaMs < endMs);
    const fmt = (ms: number) =>
      new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    return {
      bucket,
      label,
      timeRange: `${fmt(startMs)} → ${fmt(endMs)}`,
      operations: bucketOps,
      highPriorityCount: bucketOps.filter(o => o.vessel.priority === 'High' || o.vessel.priority === 'Critical').length,
      atRiskCount: bucketOps.filter(o => o.risk.level === 'HIGH').length,
      criticalCount: bucketOps.filter(o => o.risk.level === 'CRITICAL').length,
    };
  });
}

// ─── Plan-level Status ────────────────────────────────────────────────────────

export type PlanStatus = 'STABLE' | 'WATCH' | 'CONGESTION RISK' | 'CRITICAL';

export function derivePlanStatus(
  ops: PlannedOperation[],
  conflictCount: number,
  criticalConflicts: number
): { status: PlanStatus; reasons: string[] } {
  const reasons: string[] = [];
  const criticalOps = ops.filter(o => o.risk.level === 'CRITICAL').length;
  const shortfalls  = ops.filter(o => o.craneShortfall > 0).length;

  if (criticalConflicts > 0 || criticalOps > 1) {
    reasons.push(criticalOps > 0 ? `${criticalOps} berth(s) at CRITICAL congestion risk` : '');
    if (criticalConflicts > 0) reasons.push(`${criticalConflicts} CRITICAL resource conflict(s)`);
    return { status: 'CRITICAL', reasons: reasons.filter(Boolean) };
  }
  if (conflictCount > 2 || ops.filter(o => o.risk.level === 'HIGH').length > 1) {
    reasons.push(`${conflictCount} resource conflict(s) require attention`);
    if (shortfalls > 0) reasons.push(`${shortfalls} operation(s) have crane shortfalls`);
    return { status: 'CONGESTION RISK', reasons };
  }
  if (conflictCount > 0 || shortfalls > 0) {
    if (conflictCount > 0) reasons.push(`${conflictCount} minor scheduling issue(s)`);
    if (shortfalls > 0) reasons.push(`${shortfalls} crane assignment gap(s)`);
    return { status: 'WATCH', reasons };
  }
  reasons.push('All operations within normal parameters');
  return { status: 'STABLE', reasons };
}
