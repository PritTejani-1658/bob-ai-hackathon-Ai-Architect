import { useState, useMemo } from 'react';
import { useStore } from '../../shared/store';
import type { Berth, Crane, RiskProfile } from '../../shared/types';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { MetricCard } from '../components/ui/MetricCard';
import { calculateBerthRisk } from '../../shared/services/congestionEngine';
import { detectConflicts } from '../../shared/services/resourceConflictEngine';
import { runOptimization } from '../../shared/services/optimizationEngine';
import type { OptimizationResult } from '../../shared/services/optimizationEngine';
import { useNavigate } from 'react-router-dom';
import {
  Anchor, Activity, AlertTriangle, CheckCircle, Wrench,
  Zap, Ship, ChevronRight, Play, ArrowRight, TriangleAlert
} from 'lucide-react';

const berthStatusVariant = (status: string) => {
  if (status === 'Available') return 'success';
  if (status === 'Occupied') return 'warning';
  return 'default';
};

const craneStatusVariant = (status: string) => {
  if (status === 'Active') return 'success';
  if (status === 'Fault') return 'danger';
  if (status === 'Maintenance') return 'warning';
  return 'default';
};

const riskVariant = (level: string) => {
  if (level === 'CRITICAL') return 'danger';
  if (level === 'HIGH') return 'warning';
  if (level === 'LOW') return 'success';
  return 'default';
};

const conflictVariant = (severity: string) => {
  if (severity === 'CRITICAL') return 'danger';
  if (severity === 'HIGH') return 'warning';
  return 'default';
};

const CraneStatusIcon = ({ status }: { status: string }) => {
  if (status === 'Active') return <Zap className="w-4 h-4 text-emerald-400" />;
  if (status === 'Fault') return <AlertTriangle className="w-4 h-4 text-red-400" />;
  if (status === 'Maintenance') return <Wrench className="w-4 h-4 text-amber-400" />;
  return <Activity className="w-4 h-4 text-gray-400" />;
};

export default function BerthsCranes() {
  const { vessels, berths, cranes } = useStore();
  const navigate = useNavigate();

  const [selectedBerth, setSelectedBerth] = useState<Berth | null>(null);
  const [selectedCrane, setSelectedCrane] = useState<Crane | null>(null);
  const [optResult, setOptResult] = useState<OptimizationResult | null>(null);
  const [showOptPanel, setShowOptPanel] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);

  // All derived values — never hardcoded, always from store
  const conflicts = useMemo(() => detectConflicts(berths, cranes, vessels), [berths, cranes, vessels]);

  const berthsWithData = useMemo(() => berths.map(b => {
    const vessel = vessels.find(v => v.id === b.currentVesselId) ?? null;
    const assignedCranes = cranes.filter(c => c.assignedBerthId === b.id);
    const activeCranes = assignedCranes.filter(c => c.status === 'Active');
    const utilisation = b.status === 'Occupied' ? Math.round(((vessel?.cargoSize || 0) / b.capacity) * 100) : 0;
    const risk: RiskProfile = calculateBerthRisk(b, vessels, cranes);
    return { berth: b, vessel, assignedCranes, activeCranes, utilisation, risk };
  }), [berths, vessels, cranes]);

  // Summary KPIs
  const occupiedCount = berths.filter(b => b.status === 'Occupied').length;
  const availableCount = berths.filter(b => b.status === 'Available').length;
  const berthsAtRisk = berthsWithData.filter(b => b.risk.level === 'HIGH' || b.risk.level === 'CRITICAL').length;
  const avgUtil = Math.round(berthsWithData.reduce((sum, b) => sum + b.utilisation, 0) / (berths.length || 1));
  const activeCraneCount = cranes.filter(c => c.status === 'Active').length;
  const faultCount = cranes.filter(c => c.status === 'Fault' || c.status === 'Maintenance').length;

  // Selected berth detail data
  const selectedBerthData = useMemo(() => {
    if (!selectedBerth) return null;
    return berthsWithData.find(b => b.berth.id === selectedBerth.id) ?? null;
  }, [selectedBerth, berthsWithData]);

  // Selected crane detail data
  const selectedCraneVessel = useMemo(() => {
    if (!selectedCrane?.assignedBerthId) return null;
    const berth = berths.find(b => b.id === selectedCrane.assignedBerthId);
    return vessels.find(v => v.id === berth?.currentVesselId) ?? null;
  }, [selectedCrane, berths, vessels]);

  // ── Optimization handlers ──────────────────────────────────────────────────
  const { updateVessel, updateCrane } = useStore();
  const [skippedMessages, setSkippedMessages] = useState<string[]>([]);

  function handleRunOptimization() {
    const result = runOptimization(vessels, berths, cranes);
    setOptResult(result);
    setShowOptPanel(true);
    setConfirmApply(false);
    setSkippedMessages([]);
  }

  function handleApplyOptimization() {
    if (!optResult) return;
    const skipped: string[] = [];

    // Re-read current Zustand state and re-validate every berth change
    Object.entries(optResult.proposedVesselBerths).forEach(([vesselId, newBerthId]) => {
      const vessel = vessels.find(v => v.id === vesselId);
      if (!vessel) { skipped.push(`Vessel ${vesselId}: no longer in state — skipped`); return; }
      if (newBerthId === vessel.scheduledBerthId) return; // no change needed
      if (!newBerthId) { skipped.push(`${vessel.name}: proposed berth is null — skipped`); return; }
      const targetBerth = berths.find(b => b.id === newBerthId);
      if (!targetBerth) { skipped.push(`${vessel.name}: target berth ${newBerthId} not found — skipped`); return; }
      if (targetBerth.status === 'Maintenance') {
        skipped.push(`${vessel.name} → ${newBerthId}: berth now under maintenance — recommendation skipped`);
        return;
      }
      // Check occupancy timing again
      if (targetBerth.status === 'Occupied' && targetBerth.currentVesselId && targetBerth.currentVesselId !== vesselId) {
        if (!targetBerth.expectedRelease) {
          skipped.push(`${vessel.name} → ${newBerthId}: berth occupied with no release time — recommendation skipped`);
          return;
        }
        const releaseMs = new Date(targetBerth.expectedRelease).getTime();
        const etaMs = new Date(vessel.eta).getTime();
        if (etaMs < releaseMs) {
          skipped.push(`${vessel.name} → ${newBerthId}: berth release overlaps vessel ETA — recommendation skipped`);
          return;
        }
      }
      updateVessel(vesselId, { scheduledBerthId: newBerthId });
    });

    // Re-validate crane reassignments
    Object.entries(optResult.proposedCraneAssignments).forEach(([craneId, newBerthId]) => {
      const crane = cranes.find(c => c.id === craneId);
      if (!crane) { skipped.push(`Crane ${craneId}: no longer in state — skipped`); return; }
      if (crane.status === 'Fault') { skipped.push(`${crane.name}: now FAULT — crane reassignment skipped`); return; }
      if (crane.status === 'Maintenance') { skipped.push(`${crane.name}: now MAINTENANCE — crane reassignment skipped`); return; }
      if (!newBerthId) return;
      updateCrane(craneId, { assignedBerthId: newBerthId, status: 'Active' });
    });

    if (skipped.length > 0) {
      setSkippedMessages(skipped);
      setConfirmApply(false);
      // Keep panel open to show skipped messages; user can dismiss manually
    } else {
      setOptResult(null);
      setShowOptPanel(false);
      setConfirmApply(false);
    }
  }

  return (
    <div className="space-y-6 pb-12">

      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Berths & Cranes</h1>
          <p className="text-sm text-gray-400 mt-1">Port resource control — berth occupancy, crane status, and conflict detection</p>
        </div>
        <button
          onClick={handleRunOptimization}
          className="flex items-center space-x-2 bg-primary hover:bg-primary/80 text-white text-sm font-semibold px-4 py-2 rounded border border-primary/40 transition-colors"
        >
          <Play className="w-4 h-4" />
          <span>Run Optimisation</span>
        </button>
      </div>

      {/* ── OPTIMISATION RESULTS PANEL (MOVED TO TOP) ───────────────── */}
      {showOptPanel && optResult && (
        <div className={`rounded border p-5 space-y-5 ${
          optResult.status === 'improved'
            ? 'border-primary/30 bg-primary/5'
            : 'border-border bg-surface-hover'
        }`}>
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <h2 className="text-lg font-bold text-white">Optimisation Result</h2>
              {optResult.status === 'improved' && (
                <Badge variant="success">IMPROVEMENT FOUND</Badge>
              )}
              {optResult.status === 'no_change' && (
                <Badge variant="default">NO BENEFICIAL CHANGE</Badge>
              )}
            </div>
            <button onClick={() => setShowOptPanel(false)} className="text-gray-400 hover:text-white text-xl leading-none">&times;</button>
          </div>

          {optResult.status === 'no_change' && optResult.changes.length === 0 ? (
            <div className="flex items-center space-x-2 text-gray-400 text-sm py-2">
              <CheckCircle className="w-5 h-5 text-emerald-400" />
              <span>No beneficial optimisation found for the current state. Assignments are already optimal or no candidates are available.</span>
            </div>
          ) : (
            <>
              {/* BEFORE / AFTER / CHANGE Table */}
              <div>
                <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Before / After / Change</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-500 uppercase border-b border-border">
                        <th className="text-left py-2 pr-4">Metric</th>
                        <th className="text-center py-2 px-3">Before</th>
                        <th className="text-center py-2 px-3">After</th>
                        <th className="text-center py-2 px-3">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        {
                          label: 'Est. Waiting Time (h)',
                          before: optResult.baseline.estimatedWaitingHours.toFixed(1),
                          after: optResult.optimized.estimatedWaitingHours.toFixed(1),
                          diff: optResult.optimized.estimatedWaitingHours - optResult.baseline.estimatedWaitingHours,
                          pct: optResult.waitingTimeImprovementPct,
                          lowerBetter: true,
                        },
                        {
                          label: 'Active Conflicts',
                          before: optResult.baseline.activeConflicts,
                          after: optResult.optimized.activeConflicts,
                          diff: optResult.optimized.activeConflicts - optResult.baseline.activeConflicts,
                          pct: null,
                          lowerBetter: true,
                        },
                        {
                          label: 'Crane Shortfalls',
                          before: optResult.baseline.craneShortfalls,
                          after: optResult.optimized.craneShortfalls,
                          diff: optResult.optimized.craneShortfalls - optResult.baseline.craneShortfalls,
                          pct: null,
                          lowerBetter: true,
                        },
                        {
                          label: 'Berths at Risk',
                          before: optResult.baseline.berthsAtRisk,
                          after: optResult.optimized.berthsAtRisk,
                          diff: optResult.optimized.berthsAtRisk - optResult.baseline.berthsAtRisk,
                          pct: null,
                          lowerBetter: true,
                        },
                        {
                          label: 'Average Utilisation',
                          before: `${optResult.baseline.averageBerthUtilisation}%`,
                          after: `${optResult.optimized.averageBerthUtilisation}%`,
                          diff: optResult.optimized.averageBerthUtilisation - optResult.baseline.averageBerthUtilisation,
                          pct: null,
                          lowerBetter: false,
                        },
                        {
                          label: 'Unassigned Vessels',
                          before: optResult.baseline.unassignedVessels,
                          after: optResult.optimized.unassignedVessels,
                          diff: optResult.optimized.unassignedVessels - optResult.baseline.unassignedVessels,
                          pct: null,
                          lowerBetter: true,
                        }
                      ].map((row, i) => {
                        const improved = row.lowerBetter ? row.diff < 0 : row.diff > 0;
                        const worsened = row.lowerBetter ? row.diff > 0 : row.diff < 0;
                        return (
                          <tr key={i} className="border-b border-border/50">
                            <td className="py-2 pr-4 text-gray-300">{row.label}</td>
                            <td className="py-2 px-3 text-center">{row.before}</td>
                            <td className="py-2 px-3 text-center font-medium text-white">{row.after}</td>
                            <td className="py-2 px-3 text-center">
                              {row.diff === 0 ? (
                                <span className="text-gray-500">—</span>
                              ) : (
                                <span className={`font-bold ${improved ? 'text-emerald-400' : worsened ? 'text-red-400' : 'text-gray-400'}`}>
                                  {row.diff > 0 ? '+' : ''}{typeof row.diff === 'number' && !Number.isInteger(row.diff) ? row.diff.toFixed(1) : row.diff}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {optResult.waitingTimeImprovementHours > 0 && (
                  <div className="mt-3 text-xs text-emerald-400 font-medium">
                    ↓ Total estimated waiting time reduced by {optResult.waitingTimeImprovementHours.toFixed(1)}h
                    {optResult.waitingTimeImprovementPct !== null && ` (${optResult.waitingTimeImprovementPct}% improvement)`}
                  </div>
                )}
              </div>

              {/* Proposed Changes */}
              {optResult.changes.length > 0 && (
                <div>
                  <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Proposed Changes ({optResult.changes.length})</h3>
                  <div className="space-y-3">
                    {optResult.changes.map((c, i) => (
                      <div key={i} className={`p-4 rounded border ${c.type === 'berth' ? 'border-primary/20 bg-primary/5' : 'border-amber-500/20 bg-amber-500/5'}`}>
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center space-x-2">
                            {c.type === 'berth' ? <Anchor className="w-4 h-4 text-primary" /> : <Zap className="w-4 h-4 text-amber-400" />}
                            <span className="font-semibold text-white text-sm">{c.vesselName}</span>
                            <Badge variant={c.type === 'berth' ? 'info' : 'warning'} className="text-[10px]">{c.type.toUpperCase()}</Badge>
                          </div>
                          <span className="text-xs text-gray-500">Score: {c.score}</span>
                        </div>
                        <div className="flex items-center space-x-2 text-sm mb-2">
                          <span className="text-gray-400">{c.fromId ?? 'Unassigned'}</span>
                          <ArrowRight className="w-3 h-3 text-gray-500" />
                          <span className="text-white font-medium">{c.toName} ({c.toId})</span>
                        </div>
                        <p className="text-xs text-gray-400 mb-1"><span className="text-gray-300 font-medium">Reason:</span> {c.reason}</p>
                        <p className="text-xs text-emerald-400"><span className="text-gray-300 font-medium">Impact:</span> {c.impact}</p>
                        {c.factors.length > 0 && (
                          <details className="mt-2">
                            <summary className="text-[11px] text-gray-500 cursor-pointer hover:text-gray-300">Scoring factors</summary>
                            <ul className="mt-1 pl-3 space-y-0.5">
                              {c.factors.map((f, j) => <li key={j} className="text-[11px] text-gray-400">• {f}</li>)}
                            </ul>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Unresolved Conflicts */}
              {optResult.unresolvedConflicts.length > 0 && (
                <div className="p-3 rounded border border-amber-500/20 bg-amber-500/5">
                  <div className="flex items-center space-x-2 mb-2">
                    <TriangleAlert className="w-4 h-4 text-amber-400" />
                    <span className="text-sm font-semibold text-amber-400">Unresolved Constraints</span>
                  </div>
                  <ul className="space-y-1">
                    {optResult.unresolvedConflicts.map((c, i) => (
                      <li key={i} className="text-xs text-amber-200/80">• {c}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Skipped recommendations after apply */}
              {skippedMessages.length > 0 && (
                <div className="p-3 rounded border border-red-500/20 bg-red-500/5">
                  <div className="text-sm font-semibold text-red-400 mb-2">Recommendations Skipped (state changed)</div>
                  <ul className="space-y-1">
                    {skippedMessages.map((m, i) => <li key={i} className="text-xs text-red-200/80">• {m}</li>)}
                  </ul>
                  <button onClick={() => { setShowOptPanel(false); setOptResult(null); setSkippedMessages([]); }} className="mt-3 text-xs text-gray-400 hover:text-white underline">Dismiss</button>
                </div>
              )}

              {/* Apply section */}
              {optResult.changes.length > 0 && (
                <div className="pt-3 border-t border-border">
                  {!confirmApply ? (
                    <div className="flex items-center space-x-3">
                      <button
                        onClick={() => setConfirmApply(true)}
                        className="flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-4 py-2 rounded transition-colors"
                      >
                        <CheckCircle className="w-4 h-4" />
                        <span>Apply Recommendations</span>
                      </button>
                      <button
                        onClick={() => { setShowOptPanel(false); setOptResult(null); }}
                        className="text-sm text-gray-400 hover:text-white px-4 py-2 rounded border border-border transition-colors"
                      >
                        Discard
                      </button>
                    </div>
                  ) : (
                    <div className="p-3 rounded border border-emerald-500/30 bg-emerald-500/5">
                      <p className="text-sm text-emerald-300 mb-3">
                        This will update <strong>{optResult.changes.length}</strong> assignment(s) in the central operational state.
                        Command Center, Vessels, and the 72-Hour Plan will reflect the changes immediately.
                      </p>
                      <div className="flex items-center space-x-3">
                        <button
                          onClick={handleApplyOptimization}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-4 py-2 rounded transition-colors"
                        >
                          Confirm &amp; Apply
                        </button>
                        <button
                          onClick={() => setConfirmApply(false)}
                          className="text-sm text-gray-400 hover:text-white"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Occupied / Total" value={`${occupiedCount}/${berths.length}`} icon={<Anchor className="w-5 h-5 opacity-70" />} />
        <MetricCard title="Available Berths" value={availableCount} variant={availableCount === 0 ? 'danger' : 'default'} icon={<CheckCircle className="w-5 h-5 opacity-70" />} />
        <MetricCard title="Berths at Risk" value={berthsAtRisk} variant={berthsAtRisk > 0 ? 'danger' : 'default'} icon={<AlertTriangle className="w-5 h-5 opacity-70" />} />
        <MetricCard title="Avg. Berth Util." value={`${avgUtil}%`} variant={avgUtil > 80 ? 'warning' : 'default'} icon={<Activity className="w-5 h-5 opacity-70" />} />
        <MetricCard title="Active Cranes" value={`${activeCraneCount}/${cranes.length}`} variant={activeCraneCount < cranes.length / 2 ? 'danger' : 'default'} icon={<Zap className="w-5 h-5 opacity-70" />} />
        <MetricCard title="Fault / Maintenance" value={faultCount} variant={faultCount > 0 ? 'warning' : 'default'} icon={<Wrench className="w-5 h-5 opacity-70" />} />
        <MetricCard title="Active Conflicts" value={conflicts.length} variant={conflicts.some(c => c.severity === 'CRITICAL') ? 'danger' : conflicts.length > 0 ? 'warning' : 'default'} icon={<AlertTriangle className="w-5 h-5 opacity-70" />} />
        <MetricCard title="Idle Cranes" value={cranes.filter(c => c.status === 'Idle').length} icon={<Activity className="w-5 h-5 opacity-70" />} />
      </div>

      {/* ── BERTH BOARD ──────────────────────────────────────────────────── */}
      <Card title="Berth Status Board">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {berthsWithData.map(({ berth, vessel, assignedCranes, activeCranes, utilisation, risk }) => (
            <div
              key={berth.id}
              onClick={() => setSelectedBerth(berth)}
              className={`rounded border p-4 cursor-pointer transition-colors hover:border-gray-500 ${
                berth.status === 'Maintenance' ? 'border-red-500/30 bg-red-500/5' :
                berth.status === 'Occupied'    ? 'border-amber-500/30 bg-amber-500/5' :
                                                 'border-border bg-surface-hover'
              }`}
            >
              {/* Card header */}
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="text-lg font-bold text-white">{berth.id}</div>
                  <div className="text-xs text-gray-400">{berth.name}</div>
                </div>
                <div className="flex flex-col items-end space-y-1">
                  <Badge variant={berthStatusVariant(berth.status)}>{berth.status.toUpperCase()}</Badge>
                  <Badge variant={riskVariant(risk.level)}>{risk.level}</Badge>
                </div>
              </div>

              {/* Vessel info */}
              {vessel ? (
                <div className="text-sm mb-3 pb-3 border-b border-border/60">
                  <div className="flex items-center justify-between mb-0.5">
                    <div className="flex items-center space-x-1 text-gray-200 font-medium">
                      <Ship className="w-4 h-4 shrink-0 text-gray-400" />
                      <span className="truncate">{vessel.name}</span>
                    </div>
                    <Badge variant="success" className="text-[10px] px-1">MOORED</Badge>
                  </div>
                  <div className="text-xs text-gray-400 pl-5">
                    ETD: {vessel.etd ? new Date(vessel.etd).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </div>
                </div>
              ) : berth.status === 'Available' ? (
                <div className="text-sm mb-3 pb-3 border-b border-border/60">
                  {vessels.filter(v => v.scheduledBerthId === berth.id && v.status !== 'Moored').length > 0 ? (
                    <div className="space-y-2">
                      <div className="text-xs text-gray-500 uppercase tracking-wider">Scheduled</div>
                      {vessels.filter(v => v.scheduledBerthId === berth.id && v.status !== 'Moored').slice(0, 1).map(sv => (
                        <div key={sv.id} className="flex flex-col">
                          <div className="flex items-center justify-between">
                            <span className="text-gray-200 font-medium">{sv.name}</span>
                            <Badge variant="info" className="text-[10px] px-1">{sv.status.toUpperCase()}</Badge>
                          </div>
                          <span className="text-xs text-gray-400">ETA: {new Date(sv.eta).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-gray-500 italic">No vessel assigned</div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-amber-500/80 mb-3 pb-3 border-b border-border/60 italic">Maintenance scheduled</div>
              )}

              {/* Utilisation bar */}
              <div className="mb-3">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>Utilisation</span>
                  <span>{utilisation}%</span>
                </div>
                <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${utilisation > 85 ? 'bg-red-500' : utilisation > 60 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${utilisation}%` }}
                  />
                </div>
              </div>

              {/* Crane row */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center space-x-1 text-gray-400">
                  <Zap className="w-3.5 h-3.5" />
                  <span>{activeCranes.length}/{assignedCranes.length} cranes active</span>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-600" />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── CRANES TABLE ─────────────────────────────────────────────────── */}
        <div className="lg:col-span-2">
          <Card title="Crane Operations" className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-gray-400 uppercase bg-surface-hover border-b border-border">
                  <tr>
                    <th className="px-4 py-3">Crane</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Assigned Berth</th>
                    <th className="px-4 py-3">Efficiency</th>
                    <th className="px-4 py-3">Utilisation</th>
                    <th className="px-4 py-3 text-right">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {cranes.map(crane => {
                    const assignedBerth = berths.find(b => b.id === crane.assignedBerthId);
                    const utilisation = crane.status === 'Active' ? Math.round((crane.efficiency / 40) * 100) : 0;
                    return (
                      <tr
                        key={crane.id}
                        onClick={() => setSelectedCrane(crane)}
                        className="border-b border-border hover:bg-surface-hover/60 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center space-x-2">
                            <CraneStatusIcon status={crane.status} />
                            <div>
                              <div className="font-medium text-white">{crane.name}</div>
                              <div className="text-xs text-gray-500">{crane.id}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={craneStatusVariant(crane.status)}>{crane.status.toUpperCase()}</Badge>
                        </td>
                        <td className="px-4 py-3 text-gray-300">{assignedBerth ? `${assignedBerth.id} — ${assignedBerth.name}` : '—'}</td>
                        <td className="px-4 py-3 text-gray-300">{crane.efficiency > 0 ? `${crane.efficiency} moves/h` : '—'}</td>
                        <td className="px-4 py-3 w-36">
                          <div className="flex items-center space-x-2">
                            <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${crane.status === 'Fault' ? 'bg-red-500' : crane.status === 'Maintenance' ? 'bg-amber-500' : crane.status === 'Active' ? 'bg-emerald-500' : 'bg-gray-500'}`}
                                style={{ width: `${utilisation}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-400 w-8 text-right">{utilisation}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={e => { e.stopPropagation(); setSelectedCrane(crane); }}
                            className="text-primary hover:text-blue-400 text-xs font-medium"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* ── RESOURCE ALERTS ──────────────────────────────────────────────── */}
        <div className="flex flex-col h-full">
          <Card 
            title="Resource Alerts" 
            className={`flex flex-col h-full ${conflicts.some(c => c.severity === 'CRITICAL') ? 'border-red-500/20' : ''}`}
          >
            {conflicts.length === 0 ? (
              <div className="flex items-center space-x-2 text-emerald-400 text-sm py-4">
                <CheckCircle className="w-5 h-5" />
                <span>No resource conflicts detected.</span>
              </div>
            ) : (
              <div className="space-y-3 overflow-y-auto max-h-[600px] pr-2 custom-scrollbar">
                {conflicts.map(c => (
                  <div
                    key={c.id}
                    className={`p-3.5 rounded-lg border text-sm cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-lg ${
                      c.severity === 'CRITICAL' ? 'bg-red-500/10 border-red-500/20 hover:border-red-500/40 shadow-red-900/20' :
                      c.severity === 'HIGH'     ? 'bg-amber-500/10 border-amber-500/20 hover:border-amber-500/40 shadow-amber-900/20' :
                                                   'bg-gray-500/10 border-gray-500/20 hover:border-gray-500/40 shadow-gray-900/20'
                    }`}
                    onClick={() => {
                      if (c.affectedBerthId) setSelectedBerth(berths.find(b => b.id === c.affectedBerthId) ?? null);
                      else if (c.affectedCraneId) setSelectedCrane(cranes.find(cr => cr.id === c.affectedCraneId) ?? null);
                    }}
                  >
                    <div className="flex items-start space-x-3">
                      <AlertTriangle className={`w-5 h-5 shrink-0 mt-0.5 ${c.severity === 'CRITICAL' ? 'text-red-400' : c.severity === 'HIGH' ? 'text-amber-400' : 'text-gray-400'}`} />
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-bold text-white text-xs uppercase tracking-wide">{c.resource}</span>
                          <Badge variant={conflictVariant(c.severity)} className="text-[10px] px-1.5 py-0">{c.severity}</Badge>
                        </div>
                        <p className={`text-xs leading-relaxed ${c.severity === 'CRITICAL' ? 'text-red-200/90' : c.severity === 'HIGH' ? 'text-amber-200/90' : 'text-gray-300'}`}>{c.message}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <Modal
        isOpen={!!selectedBerth}
        onClose={() => setSelectedBerth(null)}
        title={`Berth Detail: ${selectedBerth?.id}`}
        footer={
          <div className="flex space-x-3">
            {selectedBerthData?.vessel && (
              <button
                onClick={() => { setSelectedBerth(null); navigate('/vessels'); }}
                className="btn btn-primary flex-1 text-sm"
              >
                View Vessel
              </button>
            )}
            <button
              onClick={() => {
                setSelectedBerth(null);
                window.scrollTo({ top: 0, behavior: 'smooth' });
                handleRunOptimization();
              }}
              className="btn btn-secondary flex-1 text-sm"
            >
              Reassign
            </button>
          </div>
        }
      >
        {selectedBerthData && (() => {
          const { berth, vessel, assignedCranes, activeCranes, risk } = selectedBerthData;
          const berthConflicts = conflicts.filter(c => c.affectedBerthId === berth.id);
          return (
            <div className="space-y-5">
              {/* Identity */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Identity</div>
                  <div className="text-xl font-bold text-white">{berth.id}</div>
                  <div className="text-sm text-gray-400">{berth.name}</div>
                  <div className="text-sm text-gray-400 mt-1">Capacity: {berth.capacity.toLocaleString()}</div>
                </div>
                <div className="text-right space-y-1">
                  <Badge variant={berthStatusVariant(berth.status)}>{berth.status.toUpperCase()}</Badge>
                  <div></div>
                  <Badge variant={riskVariant(risk.level)}>{risk.level} RISK ({risk.score}%)</Badge>
                </div>
              </div>

              {/* Current Operation */}
              <div className="bg-surface-hover rounded border border-border p-4">
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Current Operation</div>
                {vessel ? (
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2 text-white">
                      <Ship className="w-4 h-4 text-gray-400" />
                      <span className="font-medium">{vessel.name}</span>
                      <span className="text-xs text-gray-500">({vessel.id})</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Cargo:</span>
                      <span className="text-gray-200">{vessel.cargoSize.toLocaleString()} / {berth.capacity.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Est. Release:</span>
                      <span className="text-gray-200">{berth.expectedRelease ? new Date(berth.expectedRelease).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-gray-400 italic">No vessel assigned</div>
                )}
              </div>

              {/* Assigned Cranes */}
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Assigned Cranes ({assignedCranes.length})</div>
                {assignedCranes.length === 0 ? (
                  <div className="text-sm text-gray-400 italic">No cranes assigned to this berth.</div>
                ) : (
                  <div className="space-y-2">
                    {assignedCranes.map(crane => (
                      <div key={crane.id} className="flex items-center justify-between text-sm bg-background/60 px-3 py-2 rounded border border-border">
                        <div className="flex items-center space-x-2">
                          <CraneStatusIcon status={crane.status} />
                          <span className="text-white">{crane.name}</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          {crane.efficiency > 0 && <span className="text-gray-400 text-xs">{crane.efficiency} mv/h</span>}
                          <Badge variant={craneStatusVariant(crane.status)}>{crane.status}</Badge>
                        </div>
                      </div>
                    ))}
                    <div className="text-xs text-gray-500 pt-1">{activeCranes.length} of {assignedCranes.length} cranes operational</div>
                  </div>
                )}
              </div>

              {/* Risk Factors */}
              {risk.factors.length > 0 && (
                <div className={`p-3 rounded border ${risk.level === 'CRITICAL' ? 'bg-red-500/10 border-red-500/20' : risk.level === 'HIGH' ? 'bg-amber-500/10 border-amber-500/20' : 'bg-surface-hover border-border'}`}>
                  <div className="text-xs font-bold text-gray-300 mb-1 uppercase tracking-wider">Risk Factors</div>
                  <ul className="list-disc pl-4 text-xs text-gray-300 space-y-0.5">
                    {risk.factors.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
              )}

              {/* Conflicts */}
              {berthConflicts.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs text-gray-500 uppercase tracking-wider">Issues Detected</div>
                  {berthConflicts.map(c => (
                    <div key={c.id} className="text-xs p-2 rounded bg-red-500/10 border border-red-500/20 text-red-200/80">
                      <span className="font-bold">{c.severity}: </span>{c.reason}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      <Modal
        isOpen={!!selectedCrane}
        onClose={() => setSelectedCrane(null)}
        title={`Crane Detail: ${selectedCrane?.name}`}
        footer={
          <div className="flex space-x-3">
            {selectedCrane?.assignedBerthId && (
              <button
                onClick={() => {
                  const assignedBerth = berths.find(b => b.id === selectedCrane.assignedBerthId) ?? null;
                  if (assignedBerth) {
                    setSelectedCrane(null);
                    setSelectedBerth(assignedBerth);
                  }
                }}
                className="btn btn-primary flex-1 text-sm"
              >
                View Berth
              </button>
            )}
            <button
              onClick={() => {
                setSelectedCrane(null);
                window.scrollTo({ top: 0, behavior: 'smooth' });
                handleRunOptimization();
              }}
              className="btn btn-secondary flex-1 text-sm"
            >
              Reassign Crane
            </button>
          </div>
        }
      >
        {selectedCrane && (() => {
          const assignedBerth = berths.find(b => b.id === selectedCrane.assignedBerthId) ?? null;
          const utilisation = selectedCrane.status === 'Active' ? Math.round((selectedCrane.efficiency / 40) * 100) : 0;
          const craneConflicts = conflicts.filter(c => c.affectedCraneId === selectedCrane.id);
          return (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Identity</div>
                  <div className="text-xl font-bold text-white">{selectedCrane.name}</div>
                  <div className="text-sm text-gray-400">{selectedCrane.id}</div>
                </div>
                <div className="text-right">
                  <Badge variant={craneStatusVariant(selectedCrane.status)}>{selectedCrane.status.toUpperCase()}</Badge>
                </div>
              </div>

              <div className="bg-surface-hover rounded border border-border p-4 space-y-2 text-sm">
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Current Assignment</div>
                <div className="flex justify-between"><span className="text-gray-400">Assigned Berth:</span><span className="text-white">{assignedBerth ? `${assignedBerth.id} — ${assignedBerth.name}` : '— Unassigned'}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Active Vessel:</span><span className="text-white">{selectedCraneVessel?.name ?? '—'}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Efficiency:</span><span className="text-white">{selectedCrane.efficiency > 0 ? `${selectedCrane.efficiency} moves/hr` : 'N/A'}</span></div>
                <div className="mt-2">
                  <div className="flex justify-between text-xs text-gray-400 mb-1"><span>Utilisation</span><span>{utilisation}%</span></div>
                  <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${selectedCrane.status === 'Fault' ? 'bg-red-500' : selectedCrane.status === 'Maintenance' ? 'bg-amber-500' : 'bg-emerald-500'}`}
                      style={{ width: `${utilisation}%` }}
                    />
                  </div>
                </div>
              </div>

              {craneConflicts.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs text-gray-500 uppercase tracking-wider">Issues</div>
                  {craneConflicts.map(c => (
                    <div key={c.id} className="text-xs p-2 rounded bg-red-500/10 border border-red-500/20 text-red-200/80">
                      <span className="font-bold">{c.severity}: </span>{c.reason}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

    </div>
  );
}
