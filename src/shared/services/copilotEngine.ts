import type { Vessel, Berth, Crane, TimelineEvent } from '../types';
import { calculateBerthRisk, generateTimeline } from './congestionEngine';
import { detectConflicts, getBerthUtilisation } from './resourceConflictEngine';
import { runOptimization } from './optimizationEngine';
import type { OptimizationMetrics } from './optimizationEngine';
import { evaluateRoutingOptions } from './routingEngine';

export interface CopilotInsight {
  id: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  category: 'CONGESTION' | 'VESSEL' | 'BERTH' | 'CRANE' | 'ROUTING' | 'PLANNING';
  title: string;
  explanation: string;
  recommendedAction: string;
  impact: string;
  relatedVesselId?: string;
  relatedBerthId?: string;
  relatedCraneId?: string;
}

export interface CopilotBriefing {
  portHealth: {
    congestionRisk: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
    berthUtilisation: number;
    availableCranes: number;
    vesselsAtRisk: number;
  };
  shiftSummary: string;
  topRisks: CopilotInsight[];
  next12Hours: TimelineEvent[];
  optimisationOpportunity: {
    baseline: OptimizationMetrics;
    optimized: OptimizationMetrics;
  } | null;
  routingOpportunities: CopilotInsight[];
}

export function generateCopilotBriefing(
  vessels: Vessel[],
  berths: Berth[],
  cranes: Crane[]
): CopilotBriefing {
  let insightIdCounter = 1;
  const allRisks: CopilotInsight[] = [];
  const routingOpportunities: CopilotInsight[] = [];

  // ── Port Health Metrics ───────────────────────────────────────────────────
  let vesselsAtRisk = 0;
  vessels.forEach(v => {
    if (v.scheduledBerthId) {
      const berth = berths.find(b => b.id === v.scheduledBerthId);
      if (berth) {
        const risk = calculateBerthRisk(berth, vessels, cranes);
        if (risk.level === 'HIGH' || risk.level === 'CRITICAL') vesselsAtRisk++;
      }
    }
  });

  const berthUtil = berths.length > 0 
    ? berths.reduce((sum, b) => sum + getBerthUtilisation(b, vessels), 0) / berths.length 
    : 0;
  
  const availableCranes = cranes.filter(c => c.status === 'Active' || c.status === 'Idle').length;

  let overallCongestionRisk: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' = 'LOW';
  if (vesselsAtRisk >= 3) overallCongestionRisk = 'CRITICAL';
  else if (vesselsAtRisk > 0) overallCongestionRisk = 'HIGH';
  else if (berthUtil > 80) overallCongestionRisk = 'MODERATE';

  // ── 1. Conflicts ──────────────────────────────────────────────────────────
  const conflicts = detectConflicts(berths, cranes, vessels);
  for (const c of conflicts) {
    let category: CopilotInsight['category'] = 'CONGESTION';
    if (c.message.toLowerCase().includes('crane')) category = 'CRANE';
    if (c.message.toLowerCase().includes('berth')) category = 'BERTH';

    let sev: CopilotInsight['severity'] = 'HIGH';
    if (c.severity === 'CRITICAL') sev = 'CRITICAL';
    if (c.severity === 'HIGH') sev = 'HIGH';
    if (c.severity === 'WARNING') sev = 'MEDIUM'; // map warning to medium

    allRisks.push({
      id: `insight-${insightIdCounter++}`,
      severity: sev,
      category,
      title: c.message,
      explanation: 'Detected deterministic conflict in the schedule.',
      recommendedAction: 'Run Optimisation Engine or manually reassign.',
      impact: 'Prevents operational delays.',
      relatedBerthId: c.affectedBerthId,
      relatedVesselId: c.affectedVesselId,
      relatedCraneId: c.affectedCraneId
    });
  }

  // ── 2. High-Risk Vessels ──────────────────────────────────────────────────
  for (const v of vessels) {
    if (v.status !== 'Inbound' && v.status !== 'Delayed') continue;
    if (v.scheduledBerthId) {
      const b = berths.find(x => x.id === v.scheduledBerthId);
      if (b) {
        const r = calculateBerthRisk(b, vessels, cranes);
        if (r.level === 'CRITICAL' || r.level === 'HIGH') {
          allRisks.push({
            id: `insight-${insightIdCounter++}`,
            severity: r.level,
            category: 'VESSEL',
            title: `Vessel at ${r.level} Risk: ${v.name}`,
            explanation: r.factors.join(' '),
            recommendedAction: 'Review routing options or adjust berth allocation.',
            impact: 'Avoids vessel wait time accumulation.',
            relatedVesselId: v.id,
            relatedBerthId: v.scheduledBerthId
          });
        }
      }
    }
  }

  // ── 3. Crane Faults ───────────────────────────────────────────────────────
  for (const c of cranes) {
    if (c.status === 'Fault') {
      allRisks.push({
        id: `insight-${insightIdCounter++}`,
        severity: 'HIGH',
        category: 'CRANE',
        title: `Crane Fault: ${c.name}`,
        explanation: `Crane is currently in Fault state${c.assignedBerthId ? ` at ${c.assignedBerthId}` : ''}.`,
        recommendedAction: 'Dispatch maintenance team or reassign idle crane.',
        impact: 'Restores handling capacity.',
        relatedCraneId: c.id,
        relatedBerthId: c.assignedBerthId ?? undefined
      });
    }
  }

  // ── 4. Routing Opportunities ──────────────────────────────────────────────
  const eligibleVessels = vessels.filter(v => v.status === 'Inbound' || v.status === 'Anchored' || v.status === 'Delayed');
  for (const v of eligibleVessels) {
    const route = evaluateRoutingOptions(v, vessels, berths, cranes);
    const recommendedOpt = route.options.find(o => o.id === route.recommendedOptionId);
    if (recommendedOpt && recommendedOpt.id !== 'current-port') {
      routingOpportunities.push({
        id: `insight-${insightIdCounter++}`,
        severity: 'MEDIUM',
        category: 'ROUTING',
        title: `Better Route for ${v.name}`,
        explanation: `${recommendedOpt.name} saves waiting time.`,
        recommendedAction: `Reroute to ${recommendedOpt.name}`,
        impact: recommendedOpt.reasons.find(r => r.includes('improves')) || 'Reduces overall time.',
        relatedVesselId: v.id
      });
    }
  }

  // ── 5. Optimisation Impact ────────────────────────────────────────────────
  const optResult = runOptimization(vessels, berths, cranes);
  let optOpp: CopilotBriefing['optimisationOpportunity'] = null;
  if (optResult.status === 'improved') {
    optOpp = {
      baseline: optResult.baseline,
      optimized: optResult.optimized
    };
  }

  // ── Ranking & Selection ───────────────────────────────────────────────────
  const severityWeight = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };
  allRisks.sort((a, b) => severityWeight[b.severity] - severityWeight[a.severity]);
  
  // Dedup slightly by title to prevent spam
  const seenTitles = new Set<string>();
  const topRisks: CopilotInsight[] = [];
  for (const r of allRisks) {
    if (!seenTitles.has(r.title)) {
      seenTitles.add(r.title);
      topRisks.push(r);
      if (topRisks.length >= 5) break;
    }
  }

  // ── Shift Summary Generation ──────────────────────────────────────────────
  const highPrioCount = vessels.filter(v => v.priority === 'Critical' || v.priority === 'High').length;
  let summary = `${highPrioCount} high-priority vessels require attention. `;
  
  if (optResult.baseline.craneShortfalls > 0) {
    summary += `Crane availability is heavily constrained with ${optResult.baseline.craneShortfalls} shortfalls across active operations. `;
  } else if (availableCranes < cranes.length / 2) {
    summary += `Crane capacity is tight (${availableCranes} available). `;
  } else {
    summary += `Crane capacity is sufficient. `;
  }

  if (vesselsAtRisk > 0) {
    summary += `There are ${vesselsAtRisk} vessels currently at elevated congestion risk. `;
  }

  if (optOpp) {
    summary += `An active optimisation opportunity exists to reduce waiting time by ${(optOpp.baseline.estimatedWaitingHours - optOpp.optimized.estimatedWaitingHours).toFixed(1)}h.`;
  } else {
    summary += `Current assignments are operating as planned without immediate algorithmic improvements.`;
  }

  return {
    portHealth: {
      congestionRisk: overallCongestionRisk,
      berthUtilisation: berthUtil,
      availableCranes,
      vesselsAtRisk
    },
    shiftSummary: summary,
    topRisks,
    next12Hours: generateTimeline(vessels).slice(0, 6),
    optimisationOpportunity: optOpp,
    routingOpportunities
  };
}
