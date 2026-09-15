import type { Vessel, Berth, Crane } from '../types';

export type ConflictSeverity = 'CRITICAL' | 'HIGH' | 'WARNING';

export interface ResourceConflict {
  id: string;
  severity: ConflictSeverity;
  resource: string;
  message: string;
  reason: string;
  affectedVesselId?: string;
  affectedBerthId?: string;
  affectedCraneId?: string;
}

/**
 * Transparent deterministic resource conflict detection engine.
 * Identifies operational issues from current port state.
 * Designed to be replaced by a full optimisation engine later.
 */
export function detectConflicts(
  berths: Berth[],
  cranes: Crane[],
  vessels: Vessel[]
): ResourceConflict[] {
  const conflicts: ResourceConflict[] = [];
  let id = 1;

  // Rule 1: Cranes marked FAULT/MAINTENANCE but still assigned to an active berth
  cranes.forEach(crane => {
    if ((crane.status === 'Fault' || crane.status === 'Maintenance') && crane.assignedBerthId) {
      const berth = berths.find(b => b.id === crane.assignedBerthId);
      const severity: ConflictSeverity = crane.status === 'Fault' ? 'CRITICAL' : 'HIGH';
      conflicts.push({
        id: `C-${id++}`,
        severity,
        resource: crane.name,
        message: `${crane.name} is ${crane.status.toLowerCase()} but assigned to ${crane.assignedBerthId}`,
        reason: `Crane marked ${crane.status} cannot fulfil operations at ${berth?.name ?? crane.assignedBerthId}`,
        affectedCraneId: crane.id,
        affectedBerthId: crane.assignedBerthId,
        affectedVesselId: berth?.currentVesselId ?? undefined,
      });
    }
  });

  // Rule 2: Berth under maintenance with an assigned vessel
  berths.forEach(berth => {
    if (berth.status === 'Maintenance' && berth.currentVesselId) {
      const vessel = vessels.find(v => v.id === berth.currentVesselId);
      conflicts.push({
        id: `C-${id++}`,
        severity: 'CRITICAL',
        resource: berth.name,
        message: `${berth.id} is under maintenance but has vessel assigned`,
        reason: `${vessel?.name ?? berth.currentVesselId} cannot be serviced at a maintenance berth`,
        affectedBerthId: berth.id,
        affectedVesselId: berth.currentVesselId,
      });
    }
  });

  // Rule 3: Occupied berth has NO active cranes assigned
  berths.forEach(berth => {
    if (berth.status === 'Occupied') {
      const assignedCranes = cranes.filter(c => c.assignedBerthId === berth.id);
      const activeCranes = assignedCranes.filter(c => c.status === 'Active');
      if (assignedCranes.length > 0 && activeCranes.length === 0) {
        conflicts.push({
          id: `C-${id++}`,
          severity: 'HIGH',
          resource: berth.name,
          message: `${berth.id} is occupied but has no active cranes`,
          reason: `All assigned cranes (${assignedCranes.map(c => c.name).join(', ')}) are inactive or faulted`,
          affectedBerthId: berth.id,
          affectedVesselId: berth.currentVesselId ?? undefined,
        });
      }
    }
  });

  // Rule 4: Inbound vessel scheduled to a berth that is Maintenance or already fully occupied by another vessel
  vessels.forEach(vessel => {
    if ((vessel.status === 'Inbound' || vessel.status === 'Anchored') && vessel.scheduledBerthId) {
      const berth = berths.find(b => b.id === vessel.scheduledBerthId);
      if (!berth) return;

      if (berth.status === 'Maintenance') {
        conflicts.push({
          id: `C-${id++}`,
          severity: 'HIGH',
          resource: vessel.name,
          message: `${vessel.name} is scheduled to berth ${berth.id} which is under maintenance`,
          reason: `Berth ${berth.id} will not be available for scheduled arrival`,
          affectedBerthId: berth.id,
          affectedVesselId: vessel.id,
        });
      } else if (berth.status === 'Occupied' && berth.currentVesselId && berth.currentVesselId !== vessel.id) {
        // Check if the release time is before vessel ETA
        if (berth.expectedRelease) {
          const releaseTime = new Date(berth.expectedRelease).getTime();
          const eta = new Date(vessel.eta).getTime();
          if (eta < releaseTime) {
            const vessel2 = vessels.find(v => v.id === berth.currentVesselId);
            conflicts.push({
              id: `C-${id++}`,
              severity: 'WARNING',
              resource: vessel.name,
              message: `Scheduling conflict at ${berth.id} — ${vessel.name} arrives before ${vessel2?.name ?? berth.currentVesselId} departs`,
              reason: `Berth expected release at ${new Date(berth.expectedRelease).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, vessel ETA earlier`,
              affectedBerthId: berth.id,
              affectedVesselId: vessel.id,
            });
          }
        }
      }
    }
  });

  // Rule 5: Berth utilisation exceeds threshold (>85%) — warning only
  berths.forEach(berth => {
    if (berth.status === 'Occupied' && berth.currentVesselId) {
      const vessel = vessels.find(v => v.id === berth.currentVesselId);
      if (vessel) {
        const utilisation = Math.min(100, Math.round((vessel.cargoSize / berth.capacity) * 100));
        if (utilisation > 85) {
          conflicts.push({
            id: `C-${id++}`,
            severity: 'WARNING',
            resource: berth.name,
            message: `${berth.id} utilisation at ${utilisation}% — approaching operational limit`,
            reason: `Vessel cargo (${vessel.cargoSize.toLocaleString()}) is at ${utilisation}% of berth capacity (${berth.capacity.toLocaleString()})`,
            affectedBerthId: berth.id,
            affectedVesselId: vessel.id,
          });
        }
      }
    }
  });

  // Sort by severity: CRITICAL first
  const order: Record<ConflictSeverity, number> = { CRITICAL: 0, HIGH: 1, WARNING: 2 };
  conflicts.sort((a, b) => order[a.severity] - order[b.severity]);

  return conflicts;
}

/**
 * Calculate per-berth utilisation percentage based on assigned vessel cargo vs berth capacity.
 */
export function getBerthUtilisation(berth: Berth, vessels: Vessel[]): number {
  if (berth.status !== 'Occupied' || !berth.currentVesselId) return 0;
  const vessel = vessels.find(v => v.id === berth.currentVesselId);
  if (!vessel) return 0;
  return Math.min(100, Math.round((vessel.cargoSize / berth.capacity) * 100));
}
