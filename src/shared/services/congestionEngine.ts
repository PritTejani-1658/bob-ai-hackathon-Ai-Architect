import type { Vessel, Berth, Crane, RiskProfile, Alert, Recommendation, TimelineEvent } from '../types';

export const CURRENT_TIME = '2026-09-15T02:00:00Z'; // Used for deterministic PoC calculations

export function calculateBerthRisk(
  berth: Berth,
  vessels: Vessel[],
  cranes: Crane[]
): RiskProfile {
  let score = 0;
  const factors: string[] = [];
  
  // 1. Current Utilisation & Status
  if (berth.status === 'Maintenance') {
    score += 50;
    factors.push('Berth is under maintenance');
  } else if (berth.status === 'Occupied') {
    score += 30;
    factors.push('Berth is currently occupied');
  }

  // 2. Crane Availability
  const assignedCranes = cranes.filter(c => c.assignedBerthId === berth.id);
  const activeCranes = assignedCranes.filter(c => c.status === 'Active');
  const faultCranes = assignedCranes.filter(c => c.status === 'Fault' || c.status === 'Maintenance');
  
  if (assignedCranes.length > 0 && activeCranes.length === 0) {
    score += 40;
    factors.push('No active cranes available');
  } else if (faultCranes.length > 0) {
    score += 20;
    factors.push(`Crane capacity reduced (${faultCranes.length} unavailable)`);
  }

  // 3. Upcoming Vessels Queue
  const scheduledVessels = vessels.filter(v => v.scheduledBerthId === berth.id && (v.status === 'Inbound' || v.status === 'Anchored'));
  if (scheduledVessels.length > 0) {
    score += scheduledVessels.length * 15;
    factors.push(`${scheduledVessels.length} vessel(s) arriving or waiting`);
    
    // Check close ETAs
    const now = new Date(CURRENT_TIME).getTime();
    let overlapping = 0;
    scheduledVessels.forEach(v => {
      const etaTime = new Date(v.eta).getTime();
      const hoursToEta = (etaTime - now) / (1000 * 60 * 60);
      if (hoursToEta < 12) {
        overlapping++;
        score += 10;
      }
    });
    if (overlapping > 0) {
      factors.push(`${overlapping} vessel(s) arriving within 12h`);
    }
  }

  // Cap score at 100
  score = Math.min(100, Math.max(0, score));

  // Risk Level
  let level: RiskProfile['level'] = 'LOW';
  if (score >= 80) level = 'CRITICAL';
  else if (score >= 60) level = 'HIGH';
  else if (score >= 40) level = 'MODERATE';

  // Time to Congestion estimation (very rough heuristic for PoC)
  let timeToCongestionHours = null;
  if (level === 'CRITICAL' || level === 'HIGH') {
    timeToCongestionHours = Math.max(1, Math.round(12 - (score / 10)));
  }

  return { score, level, timeToCongestionHours, factors };
}

export function generateAlertsAndRecs(
  berths: Berth[],
  vessels: Vessel[],
  cranes: Crane[]
): { alerts: Alert[], recommendations: Recommendation[] } {
  const alerts: Alert[] = [];
  const recommendations: Recommendation[] = [];
  let alertId = 1;
  let recId = 1;

  berths.forEach(berth => {
    const risk = calculateBerthRisk(berth, vessels, cranes);
    if (risk.level === 'CRITICAL') {
      alerts.push({
        id: `A-${alertId++}`,
        type: 'CRITICAL',
        message: `${berth.id} predicted to reach congestion threshold in ${risk.timeToCongestionHours} hours.`,
        timestamp: CURRENT_TIME,
        relatedEntityId: berth.id
      });
      recommendations.push({
        id: `R-${recId++}`,
        action: `Divert incoming vessel from ${berth.id}`,
        reason: `${berth.id} has critical congestion risk (${risk.score}%).`,
        expectedImpact: 'Reduces queue time by 4h'
      });
    } else if (risk.level === 'HIGH') {
      alerts.push({
        id: `A-${alertId++}`,
        type: 'WARNING',
        message: `High traffic expected at ${berth.id}.`,
        timestamp: CURRENT_TIME,
        relatedEntityId: berth.id
      });
    }
  });

  cranes.forEach(crane => {
    if (crane.status === 'Fault') {
      alerts.push({
        id: `A-${alertId++}`,
        type: 'WARNING',
        message: `Crane ${crane.name} fault reduces capacity.`,
        timestamp: CURRENT_TIME,
        relatedEntityId: crane.id
      });
      recommendations.push({
        id: `R-${recId++}`,
        action: `Reassign idle crane to replace ${crane.name}`,
        reason: `Maintain handling efficiency at ${crane.assignedBerthId || 'berth'}`,
        expectedImpact: 'Restores 30 moves/hr capacity'
      });
    }
  });

  return { alerts, recommendations };
}

export function generateTimeline(vessels: Vessel[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const now = new Date(CURRENT_TIME).getTime();
  let id = 1;

  events.push({ id: `T-${id++}`, timestamp: CURRENT_TIME, timeOffsetHours: 0, description: 'Current Time', type: 'info' });

  vessels.forEach(v => {
    if (v.status === 'Inbound') {
      const eta = new Date(v.eta).getTime();
      const offset = (eta - now) / (1000 * 60 * 60);
      if (offset > 0 && offset <= 12) {
        events.push({
          id: `T-${id++}`,
          timestamp: v.eta,
          timeOffsetHours: Math.round(offset),
          description: `Arrival: ${v.name} (${v.priority} Priority) at ${v.scheduledBerthId}`,
          type: 'arrival'
        });
      }
    } else if (v.status === 'Moored' && v.etd) {
      const etd = new Date(v.etd).getTime();
      const offset = (etd - now) / (1000 * 60 * 60);
      if (offset > 0 && offset <= 12) {
        events.push({
          id: `T-${id++}`,
          timestamp: v.etd,
          timeOffsetHours: Math.round(offset),
          description: `Departure: ${v.name} from ${v.scheduledBerthId}`,
          type: 'departure'
        });
      }
    }
  });
  
  // Sort by offset
  events.sort((a, b) => a.timeOffsetHours - b.timeOffsetHours);
  
  return events;
}
