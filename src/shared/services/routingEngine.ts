import type { Vessel, Berth, Crane } from '../types';
import { calculateBerthRisk } from './congestionEngine';
import { vesselWaitHours } from './optimizationEngine';
import { PRIORITY_WEIGHT } from '../utils/vesselUtils';

export interface RouteOption {
  id: string;
  name: string;
  isBaseline: boolean;
  status: 'RECOMMENDED' | 'VIABLE' | 'NOT RECOMMENDED';
  congestionRisk: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  estimatedWaitingHours: number;
  additionalSailingHours: number;
  totalEstimatedTime: number; // waiting + sailing
  score: number;
  reasons: string[];
  tradeOffs: string;
}

export interface RouteRecommendation {
  vesselId: string;
  options: RouteOption[];
  recommendedOptionId: string;
  baselineOptionId: string;
}

const RISK_PENALTY = {
  LOW: 0,
  MODERATE: 1,
  HIGH: 3,
  CRITICAL: 6,
};

const ALTERNATES = [
  { id: 'alt-a', name: 'Alternate Port A', baseSailingTime: 4.5, baseWaitTime: 1.0, baseRisk: 'LOW' as const },
  { id: 'alt-b', name: 'Alternate Port B', baseSailingTime: 2.0, baseWaitTime: 3.5, baseRisk: 'MODERATE' as const }
];

export function evaluateRoutingOptions(
  vessel: Vessel,
  vessels: Vessel[],
  berths: Berth[],
  cranes: Crane[]
): RouteRecommendation {
  const options: RouteOption[] = [];

  // ── Baseline (Current Port) ───────────────────────────────────────────────
  let baselineWait = 0;
  let baselineRisk: keyof typeof RISK_PENALTY = 'HIGH';
  
  if (vessel.scheduledBerthId) {
    const berth = berths.find(b => b.id === vessel.scheduledBerthId);
    baselineWait = vesselWaitHours(vessel, vessel.scheduledBerthId, berths);
    if (berth) {
      baselineRisk = calculateBerthRisk(berth, vessels, cranes).level;
    }
  } else {
    baselineWait = vesselWaitHours(vessel, null, berths); // Returns DEFAULT_UNASSIGNED_WAIT_H
    baselineRisk = 'CRITICAL';
  }

  const baselineScore = baselineWait + 0 + RISK_PENALTY[baselineRisk];
  const baselineTotalTime = baselineWait + 0;

  options.push({
    id: 'current-port',
    name: 'Current Port',
    isBaseline: true,
    status: 'NOT RECOMMENDED', // placeholder, will be updated
    congestionRisk: baselineRisk,
    estimatedWaitingHours: baselineWait,
    additionalSailingHours: 0,
    totalEstimatedTime: baselineTotalTime,
    score: baselineScore,
    reasons: [],
    tradeOffs: 'Baseline operational plan.'
  });

  // ── Alternate Ports ───────────────────────────────────────────────────────
  for (const alt of ALTERNATES) {
    // Adjust wait time slightly by priority just to make it a bit dynamic per vessel
    const prioWeight = PRIORITY_WEIGHT[vessel.priority] ?? 2;
    // higher priority gets slightly better service at alt ports
    const waitTime = Math.max(0, alt.baseWaitTime - ((prioWeight - 2) * 0.2));
    
    const score = waitTime + alt.baseSailingTime + RISK_PENALTY[alt.baseRisk];
    
    options.push({
      id: alt.id,
      name: alt.name,
      isBaseline: false,
      status: 'NOT RECOMMENDED',
      congestionRisk: alt.baseRisk,
      estimatedWaitingHours: waitTime,
      additionalSailingHours: alt.baseSailingTime,
      totalEstimatedTime: waitTime + alt.baseSailingTime,
      score: score,
      reasons: [],
      tradeOffs: ''
    });
  }

  // ── Evaluate & Classify ───────────────────────────────────────────────────
  // Lower score is better
  options.sort((a, b) => a.score - b.score);
  
  const bestScore = options[0].score;
  const baselineOption = options.find(o => o.isBaseline)!;
  
  for (const opt of options) {
    if (opt.score === bestScore) {
      opt.status = 'RECOMMENDED';
    } else if (opt.score <= baselineOption.score + 2) {
      // If it's worse than the best but not much worse than baseline, it's viable
      opt.status = 'VIABLE';
    } else {
      opt.status = 'NOT RECOMMENDED';
    }

    // Generate reasons
    if (opt.isBaseline) {
      opt.reasons.push(`Current port congestion risk is ${opt.congestionRisk}.`);
      opt.reasons.push(`Expected berth wait is ${opt.estimatedWaitingHours.toFixed(1)}h.`);
    } else {
      opt.reasons.push(`${opt.name} adds ${opt.additionalSailingHours.toFixed(1)}h sailing time.`);
      opt.reasons.push(`Expected berth wait is ${opt.estimatedWaitingHours.toFixed(1)}h.`);
      const timeDiff = baselineOption.totalEstimatedTime - opt.totalEstimatedTime;
      if (timeDiff > 0) {
        opt.reasons.push(`Net estimated operational time improves by ${timeDiff.toFixed(1)}h.`);
        opt.tradeOffs = `Saves time but requires rerouting.`;
      } else {
        opt.reasons.push(`Net estimated operational time worsens by ${Math.abs(timeDiff).toFixed(1)}h.`);
        opt.tradeOffs = `Added sailing time outweighs waiting time benefits.`;
      }
    }
  }

  // If current port is the best option or tied for best, make sure it's the only recommended
  if (baselineOption.score === bestScore) {
    options.forEach(o => {
      if (!o.isBaseline && o.status === 'RECOMMENDED') {
        o.status = 'VIABLE';
      }
    });
    baselineOption.status = 'RECOMMENDED';
  }

  return {
    vesselId: vessel.id,
    options: options, // sorted by score
    recommendedOptionId: options.find(o => o.status === 'RECOMMENDED')!.id,
    baselineOptionId: 'current-port'
  };
}
