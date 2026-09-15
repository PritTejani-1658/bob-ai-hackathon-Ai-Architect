import { useState, useMemo } from 'react';
import { useStore } from '../../shared/store';
import {
  SCENARIO_LABELS, SCENARIO_DESCRIPTIONS,
  runSimulation, stateFingerprint, isSimulationError,
} from '../../shared/services/simulationEngine';
import type { ScenarioType, ScenarioConfig, SimulationResult } from '../../shared/services/simulationEngine';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import {
  Play, RotateCcw, CheckCircle, AlertTriangle, Ship, Zap,
  Anchor, ArrowRight, Clock, Activity
} from 'lucide-react';
import type { OptimizationMetrics } from '../../shared/services/optimizationEngine';

// ── Constants ─────────────────────────────────────────────────────────────────


const HORIZON_H = 72;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtH(h: number): string {
  if (h === 0) return '0h';
  const sign = h < 0 ? '−' : '+';
  const abs  = Math.abs(h);
  return `${sign}${abs % 1 === 0 ? abs : abs.toFixed(1)}h`;
}

function metricDelta(before: number, after: number, lowerBetter = true): { text: string; positive: boolean } {
  const d = after - before;
  if (d === 0) return { text: '—', positive: true };
  const sign   = d > 0 ? '+' : '';
  const improved = lowerBetter ? d < 0 : d > 0;
  return { text: `${sign}${typeof d === 'number' ? (Number.isInteger(d) ? d : d.toFixed(1)) : d}`, positive: improved };
}

// ── Sub-components ────────────────────────────────────────────────────────────

type MetricRow = { label: string; key: keyof OptimizationMetrics; lowerBetter?: boolean; fmt?: (v: number) => string };
const METRIC_ROWS: MetricRow[] = [
  { label: 'Est. Waiting Time (h)',  key: 'estimatedWaitingHours',   lowerBetter: true, fmt: v => v.toFixed(1) },
  { label: 'Active Conflicts',       key: 'activeConflicts',         lowerBetter: true },
  { label: 'Crane Shortfalls',       key: 'craneShortfalls',         lowerBetter: true },
  { label: 'Berths at Risk',         key: 'berthsAtRisk',            lowerBetter: true },
  { label: 'Avg Berth Util. %',      key: 'averageBerthUtilisation', lowerBetter: true },
  { label: 'Unassigned Vessels',     key: 'unassignedVessels',       lowerBetter: true },
];

function MetricTable({ baseline, disrupted, optimized }: {
  baseline: OptimizationMetrics;
  disrupted: OptimizationMetrics;
  optimized: OptimizationMetrics;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-gray-500 uppercase border-b border-border">
            <th className="text-left py-2 pr-3">Metric</th>
            <th className="text-center py-2 px-2 text-gray-400">Current</th>
            <th className="text-center py-2 px-2 text-amber-400">Disrupted</th>
            <th className="text-center py-2 px-2">Δ Disruption</th>
            <th className="text-center py-2 px-2 text-emerald-400">Optimised</th>
            <th className="text-center py-2 px-2">Δ Recovery</th>
          </tr>
        </thead>
        <tbody>
          {METRIC_ROWS.map(({ label, key, lowerBetter = true, fmt }) => {
            const base = baseline[key] as number;
            const dis  = disrupted[key] as number;
            const opt  = optimized[key] as number;
            const dispDelta  = metricDelta(base, dis, lowerBetter);
            const recovDelta = metricDelta(dis, opt, lowerBetter);
            const fmtVal = (v: number) => fmt ? fmt(v) : String(v);
            return (
              <tr key={key} className="border-b border-border/40">
                <td className="py-2.5 pr-3 text-gray-300 text-xs">{label}</td>
                <td className="py-2.5 px-2 text-center text-gray-400 font-mono text-xs">{fmtVal(base)}</td>
                <td className={`py-2.5 px-2 text-center font-mono text-xs font-medium ${dis > base && lowerBetter ? 'text-amber-400' : dis < base && lowerBetter ? 'text-emerald-400' : 'text-gray-300'}`}>{fmtVal(dis)}</td>
                <td className="py-2.5 px-2 text-center">
                  <span className={`text-xs font-semibold ${dispDelta.positive ? 'text-emerald-400' : 'text-amber-400'}`}>{dispDelta.text}</span>
                </td>
                <td className={`py-2.5 px-2 text-center font-mono text-xs font-medium ${opt < dis && lowerBetter ? 'text-emerald-400' : opt > dis && lowerBetter ? 'text-red-400' : 'text-gray-300'}`}>{fmtVal(opt)}</td>
                <td className="py-2.5 px-2 text-center">
                  <span className={`text-xs font-semibold ${recovDelta.positive ? 'text-emerald-400' : 'text-red-400'}`}>{recovDelta.text}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ScenarioTimeline({ result }: { result: SimulationResult }) {
  const { disruption, scenario } = result;
  // Clamp offsets to [0, HORIZON_H]
  const startPct = Math.max(0, Math.min(100, (disruption.startOffsetHours / HORIZON_H) * 100));
  const endPct   = disruption.endOffsetHours !== null
    ? Math.max(0, Math.min(100, (disruption.endOffsetHours / HORIZON_H) * 100))
    : null;

  const labels = [0, 12, 24, 36, 48, 60, 72].map(h => ({
    h,
    pct: (h / HORIZON_H) * 100,
    label: h === 0 ? 'NOW' : `+${h}h`,
  }));

  const eventColor = disruption.type === 'outage' ? 'bg-red-500/50 border-red-500/70'
    : disruption.type === 'delay' ? 'bg-amber-500/50 border-amber-500/70'
    : 'bg-blue-500/50 border-blue-500/70';

  return (
    <div>
      <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Scenario Timeline (72h horizon)</h3>
      <div className="relative h-12 bg-background/60 rounded border border-border">
        {/* Time labels */}
        {labels.map(l => (
          <div key={l.h} className="absolute top-0 h-full flex flex-col" style={{ left: `${l.pct}%`, transform: 'translateX(-50%)' }}>
            <div className="h-2 border-l border-border/60" />
            <div className="text-[9px] text-gray-500 mt-auto pb-1">{l.label}</div>
          </div>
        ))}
        {/* NOW line */}
        <div className="absolute top-0 bottom-0 border-l-2 border-primary/60 border-dashed" style={{ left: '0%' }} />

        {/* Disruption event */}
        {endPct !== null ? (
          // Duration bar (crane outage)
          <div
            className={`absolute top-3 h-4 rounded border ${eventColor}`}
            style={{ left: `${startPct}%`, width: `${Math.max(1, endPct - startPct)}%` }}
            title={`${disruption.label} outage: ${fmtH(disruption.startOffsetHours)} → ${fmtH(disruption.endOffsetHours!)}`}
          />
        ) : (
          // Point marker (vessel delay / early arrival)
          <div
            className="absolute top-2 w-0.5 h-6 bg-amber-400"
            style={{ left: `${startPct}%` }}
            title={`${disruption.label} ETA shift`}
          >
            <div className="absolute -top-4 -translate-x-1/2 text-[9px] text-amber-400 whitespace-nowrap">{disruption.label}</div>
          </div>
        )}
      </div>
      <div className="mt-2 text-xs text-gray-500">
        {scenario.type === 'vessel_delay' && `${disruption.label}: ETA shifted ${fmtH(scenario.durationHours)} forward`}
        {scenario.type === 'crane_outage' && `${disruption.label}: unavailable for ${scenario.durationHours}h starting ${fmtH(disruption.startOffsetHours)} from now`}
        {scenario.type === 'early_arrival' && `${disruption.label}: ETA moved ${fmtH(scenario.durationHours)} earlier`}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function WhatIf() {
  const { vessels, berths, cranes, updateVessel, updateCrane } = useStore();

  // Scenario controls
  const [scenarioType, setScenarioType] = useState<ScenarioType>('vessel_delay');
  const [entityId, setEntityId] = useState<string>('');
  const [durationHours, setDurationHours] = useState<number>(4);

  // Simulation state (local only — never touches Zustand)
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [applySkipped, setApplySkipped] = useState<string[]>([]);

  // Entity options based on scenario type
  const entityOptions = useMemo(() => {
    if (scenarioType === 'crane_outage') {
      return cranes.map(c => ({ id: c.id, label: `${c.name} (${c.status})` }));
    }
    return vessels.map(v => ({ id: v.id, label: `${v.name} (${v.status})` }));
  }, [scenarioType, vessels, cranes]);

  // Keep entityId valid when scenario type switches
  const effectiveEntityId = entityOptions.find(o => o.id === entityId)
    ? entityId
    : (entityOptions[0]?.id ?? '');

  // Staleness check — recomputed whenever Zustand state changes
  const currentFingerprint = useMemo(
    () => stateFingerprint(vessels, cranes, berths),
    [vessels, cranes, berths]
  );
  const simulationIsStale = simResult !== null && currentFingerprint !== simResult.liveStateFingerprint;

  function handleRunSimulation() {
    const cfg: ScenarioConfig = { type: scenarioType, entityId: effectiveEntityId, durationHours };
    const result = runSimulation(vessels, berths, cranes, cfg);
    if (isSimulationError(result)) {
      setSimError(result.error);
      setSimResult(null);
    } else {
      setSimResult(result);
      setSimError(null);
    }
    setConfirmApply(false);
    setIsStale(false);
    setApplySkipped([]);
  }

  function handleReset() {
    setSimResult(null);
    setSimError(null);
    setConfirmApply(false);
    setIsStale(false);
    setApplySkipped([]);
    // Live Zustand state is NOT touched
  }

  function handleApply() {
    if (!simResult) return;
    // Check staleness against current Zustand state
    if (simulationIsStale) {
      setIsStale(true);
      return;
    }

    const optResult = simResult.optimizationResult;
    const skipped: string[] = [];

    // Re-validate and apply berth changes
    Object.entries(optResult.proposedVesselBerths).forEach(([vesselId, newBerthId]) => {
      const vessel = vessels.find(v => v.id === vesselId);
      if (!vessel) { skipped.push(`Vessel ${vesselId} not found — skipped`); return; }
      if (newBerthId === vessel.scheduledBerthId) return;
      if (!newBerthId) { skipped.push(`${vessel.name}: null berth proposal — skipped`); return; }
      const targetBerth = berths.find(b => b.id === newBerthId);
      if (!targetBerth) { skipped.push(`${vessel.name}: berth ${newBerthId} not found — skipped`); return; }
      if (targetBerth.status === 'Maintenance') {
        skipped.push(`${vessel.name} → ${newBerthId}: berth now under maintenance — skipped`);
        return;
      }
      if (targetBerth.status === 'Occupied' && targetBerth.currentVesselId && targetBerth.currentVesselId !== vesselId) {
        if (!targetBerth.expectedRelease) { skipped.push(`${vessel.name} → ${newBerthId}: occupied, no release time — skipped`); return; }
        if (new Date(vessel.eta) < new Date(targetBerth.expectedRelease)) {
          skipped.push(`${vessel.name} → ${newBerthId}: vessel ETA before berth release — skipped`);
          return;
        }
      }
      updateVessel(vesselId, { scheduledBerthId: newBerthId });
    });

    // Re-validate and apply crane changes
    Object.entries(optResult.proposedCraneAssignments).forEach(([craneId, newBerthId]) => {
      const crane = cranes.find(c => c.id === craneId);
      if (!crane) { skipped.push(`Crane ${craneId} not found — skipped`); return; }
      if (crane.status === 'Fault') { skipped.push(`${crane.name}: FAULT — skipped`); return; }
      if (crane.status === 'Maintenance') { skipped.push(`${crane.name}: MAINTENANCE — skipped`); return; }
      if (!newBerthId) return;
      updateCrane(craneId, { assignedBerthId: newBerthId, status: 'Active' });
    });

    setApplySkipped(skipped);
    setConfirmApply(false);
    if (skipped.length === 0) {
      setSimResult(null);
      setSimError(null);
    }
  }

  const optResult = simResult?.optimizationResult ?? null;
  const hasChanges = (optResult?.changes.length ?? 0) > 0;

  return (
    <div className="space-y-6 pb-16">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">What-If Simulator</h1>
        <p className="text-sm text-gray-400 mt-1">
          Simulate port disruptions on a projected state copy. Live operational data is <span className="text-emerald-400 font-medium">never modified</span> during simulation.
        </p>
      </div>

      {/* ── Scenario Controls ───────────────────────────────────────────── */}
      <Card title="Scenario Configuration">
        {/* Type tabs */}
        <div className="flex flex-wrap gap-2 mb-5">
          {(Object.keys(SCENARIO_LABELS) as ScenarioType[]).map(type => (
            <button
              key={type}
              onClick={() => { setScenarioType(type); setEntityId(''); setSimResult(null); setSimError(null); }}
              className={`px-4 py-2 rounded text-sm font-medium border transition-colors ${scenarioType === type ? 'bg-primary/20 border-primary text-primary' : 'bg-background border-border text-gray-400 hover:text-white'}`}
            >
              {SCENARIO_LABELS[type]}
            </button>
          ))}
        </div>

        <p className="text-xs text-gray-500 mb-4">{SCENARIO_DESCRIPTIONS[scenarioType]}</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Entity selector */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              {scenarioType === 'crane_outage' ? 'Select Crane' : 'Select Vessel'}
            </label>
            <select
              className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
              value={effectiveEntityId}
              onChange={e => setEntityId(e.target.value)}
            >
              {entityOptions.length === 0 && <option value="">No entities available</option>}
              {entityOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>

          {/* Duration */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              {scenarioType === 'early_arrival' ? 'Hours Earlier' : 'Duration (hours)'}
            </label>
            <input
              type="number"
              min={1}
              max={72}
              step={0.5}
              value={durationHours}
              onChange={e => setDurationHours(Math.max(0.5, Math.min(72, Number(e.target.value) || 1)))}
              className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
            />
          </div>

          {/* Run button */}
          <div className="flex items-end">
            <button
              onClick={handleRunSimulation}
              disabled={!effectiveEntityId}
              className="w-full flex items-center justify-center space-x-2 bg-primary hover:bg-primary/80 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded border border-primary/40 transition-colors"
            >
              <Play className="w-4 h-4" />
              <span>Run Simulation</span>
            </button>
          </div>
        </div>

        {simError && (
          <div className="mt-4 p-3 rounded border border-red-500/30 bg-red-500/10 text-sm text-red-400">
            <AlertTriangle className="w-4 h-4 inline mr-1.5" />{simError}
          </div>
        )}
      </Card>

      {/* ── Results ─────────────────────────────────────────────────────── */}
      {simResult && (
        <>
          {/* Stale warning */}
          {simulationIsStale && (
            <div className="p-4 rounded border border-amber-500/30 bg-amber-500/10 flex items-start space-x-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-semibold text-amber-400">Simulation is stale</div>
                <div className="text-xs text-gray-400 mt-0.5">The live operational state has changed since this simulation was run. Re-run the simulation to get an accurate result before applying.</div>
                <button onClick={handleRunSimulation} className="mt-2 text-xs text-primary hover:underline">Re-run simulation</button>
              </div>
            </div>
          )}

          {/* Scenario identity */}
          <div className="flex items-center space-x-3 p-3 rounded border border-border bg-surface-hover">
            <div className={`w-2 h-8 rounded ${simResult.disruption.type === 'outage' ? 'bg-red-500' : simResult.disruption.type === 'delay' ? 'bg-amber-500' : 'bg-blue-500'}`} />
            <div>
              <div className="text-sm font-bold text-white">{SCENARIO_LABELS[simResult.scenario.type]}</div>
              <div className="text-xs text-gray-400">
                {simResult.entityLabel} · {simResult.scenario.type === 'early_arrival' ? `${simResult.scenario.durationHours}h earlier` : `${simResult.scenario.durationHours}h`}
              </div>
            </div>
            {simResult.optimizationResult.status === 'improved' && (
              <Badge variant="success" className="ml-auto">OPTIMISATION FOUND</Badge>
            )}
            {simResult.optimizationResult.status === 'no_change' && (
              <Badge variant="default" className="ml-auto">NO OPTIMISATION CHANGE</Badge>
            )}
          </div>

          {/* CURRENT → DISRUPTED → OPTIMISED table */}
          <Card title="Operational Impact — Current vs Disrupted vs Optimised Response">
            <MetricTable
              baseline={simResult.baselineMetrics}
              disrupted={simResult.disruptedMetrics}
              optimized={simResult.optimizationResult.optimized}
            />

            {/* Waiting-time recovery summary */}
            {simResult.optimizationResult.waitingTimeImprovementHours > 0 && (
              <div className="mt-4 flex items-center space-x-2 text-sm text-emerald-400">
                <CheckCircle className="w-4 h-4" />
                <span>
                  Optimised response recovers <strong>{simResult.optimizationResult.waitingTimeImprovementHours.toFixed(1)}h</strong> of disrupted waiting time
                  {simResult.optimizationResult.waitingTimeImprovementPct !== null &&
                    ` (${simResult.optimizationResult.waitingTimeImprovementPct}%)`}
                </span>
              </div>
            )}
          </Card>

          {/* Bottom two-column */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* What changed */}
            <Card title={`What Changed (${optResult?.changes.length ?? 0} recommendations)`}>
              {!hasChanges ? (
                <div className="flex items-center space-x-2 text-gray-500 text-sm py-2">
                  <CheckCircle className="w-5 h-5 text-emerald-400" />
                  <span>No assignment changes proposed — current state is optimal for this scenario.</span>
                </div>
              ) : (
                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  {optResult!.changes.map((c, i) => (
                    <div key={i} className={`p-3 rounded border text-sm ${c.type === 'berth' ? 'border-primary/20 bg-primary/5' : 'border-amber-500/20 bg-amber-500/5'}`}>
                      <div className="flex items-center space-x-2 mb-1.5">
                        {c.type === 'berth' ? <Anchor className="w-3.5 h-3.5 text-primary" /> : <Zap className="w-3.5 h-3.5 text-amber-400" />}
                        <span className="font-semibold text-white">{c.vesselName}</span>
                        <Badge variant={c.type === 'berth' ? 'info' : 'warning'} className="text-[10px]">{c.type.toUpperCase()}</Badge>
                      </div>
                      <div className="flex items-center space-x-2 text-xs text-gray-300 mb-1">
                        <span className="text-gray-400">{c.fromId ?? 'Unassigned'}</span>
                        <ArrowRight className="w-3 h-3 text-gray-500" />
                        <span className="font-medium">{c.toId}</span>
                      </div>
                      <p className="text-xs text-gray-400">
                        <span className="text-gray-300">Reason:</span> {c.reason}
                      </p>
                      <p className="text-xs text-emerald-400 mt-0.5">
                        <span className="text-gray-300">Impact:</span> {c.impact}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* Unresolved */}
              {(optResult?.unresolvedConflicts.length ?? 0) > 0 && (
                <div className="mt-3 p-3 rounded border border-amber-500/20 bg-amber-500/5">
                  <div className="text-xs font-semibold text-amber-400 mb-1">Unresolved constraints</div>
                  {optResult!.unresolvedConflicts.map((c, i) => (
                    <div key={i} className="text-xs text-amber-200/80">• {c}</div>
                  ))}
                </div>
              )}
            </Card>

            {/* Right: Timeline + Apply */}
            <div className="space-y-5">
              <Card title="Scenario Timeline">
                <ScenarioTimeline result={simResult} />
              </Card>

              {/* Apply / Reset */}
              <Card title="Actions">
                {applySkipped.length > 0 && (
                  <div className="mb-4 p-3 rounded border border-red-500/20 bg-red-500/5">
                    <div className="text-xs font-semibold text-red-400 mb-1">Some recommendations were skipped</div>
                    {applySkipped.map((m, i) => <div key={i} className="text-xs text-red-200/80">• {m}</div>)}
                  </div>
                )}

                {isStale ? (
                  <div className="p-3 rounded border border-amber-500/30 bg-amber-500/5 text-sm text-amber-300">
                    Simulation is stale. Current operational state has changed. Re-run simulation before applying.
                    <button onClick={handleRunSimulation} className="block mt-2 text-xs text-primary hover:underline">Re-run simulation</button>
                  </div>
                ) : !confirmApply ? (
                  <div className="flex flex-wrap gap-3">
                    {hasChanges && !simulationIsStale && (
                      <button
                        onClick={() => setConfirmApply(true)}
                        className="flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-4 py-2 rounded transition-colors"
                      >
                        <CheckCircle className="w-4 h-4" />
                        <span>Apply Optimised Response</span>
                      </button>
                    )}
                    <button
                      onClick={handleReset}
                      className="flex items-center space-x-2 text-sm text-gray-400 hover:text-white px-4 py-2 rounded border border-border transition-colors"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span>Reset Simulation</span>
                    </button>
                  </div>
                ) : (
                  <div className="p-3 rounded border border-emerald-500/30 bg-emerald-500/5">
                    <p className="text-sm text-emerald-300 mb-3">
                      This will apply <strong>{optResult?.changes.length}</strong> recommendation(s) to the live operational state.
                      All other modules will reflect the change immediately.
                    </p>
                    <div className="flex items-center space-x-3">
                      <button onClick={handleApply} className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-4 py-2 rounded transition-colors">
                        Confirm &amp; Apply
                      </button>
                      <button onClick={() => setConfirmApply(false)} className="text-sm text-gray-400 hover:text-white">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Info notes */}
                <div className="mt-4 space-y-1.5">
                  <div className="flex items-start space-x-2 text-xs text-gray-500">
                    <Activity className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>Simulation runs on a deep-cloned projected state — live operations are unaffected.</span>
                  </div>
                  <div className="flex items-start space-x-2 text-xs text-gray-500">
                    <Clock className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>Simulated at {new Date(simResult.simulatedAt).toLocaleString()}</span>
                  </div>
                  <div className="flex items-start space-x-2 text-xs text-gray-500">
                    <Ship className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>Apply is re-validated against current state before any Zustand mutation.</span>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </>
      )}

      {/* No simulation yet */}
      {!simResult && !simError && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-full bg-surface-hover border border-border flex items-center justify-center mb-4">
            <Play className="w-7 h-7 text-gray-500" />
          </div>
          <div className="text-base font-semibold text-gray-300 mb-2">No simulation running</div>
          <div className="text-sm text-gray-500 max-w-md">
            Select a disruption scenario above and click <strong className="text-white">Run Simulation</strong> to see predicted operational impact and optimised response.
          </div>
        </div>
      )}
    </div>
  );
}
