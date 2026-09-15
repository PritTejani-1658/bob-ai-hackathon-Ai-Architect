import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../shared/store';
import { detectConflicts } from '../../shared/services/resourceConflictEngine';
import {
  CURRENT_TIME, PLAN_HOURS,
  buildPlannedOperations, buildBucketSummaries, derivePlanStatus,
} from '../../shared/services/planningEngine';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { MetricCard } from '../components/ui/MetricCard';
import {
  AlertTriangle, Ship, Anchor, Zap, ChevronRight,
  Activity, Clock, CheckCircle, Filter
} from 'lucide-react';
import type { PlannedOperation, PlanStatus } from '../../shared/services/planningEngine';

// ─── helpers ────────────────────────────────────────────────────────────────

const NOW_MS = new Date(CURRENT_TIME).getTime();

const riskVariant = (level: string) =>
  level === 'CRITICAL' ? 'danger' : level === 'HIGH' ? 'warning' : level === 'LOW' ? 'success' : 'default';

const priorityVariant = (p: string) =>
  p === 'Critical' ? 'danger' : p === 'High' ? 'warning' : p === 'Low' ? 'default' : 'info';

const planStatusStyle: Record<PlanStatus, { border: string; text: string; bg: string }> = {
  'STABLE':          { border: 'border-emerald-500/30', text: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  'WATCH':           { border: 'border-amber-500/30',   text: 'text-amber-400',   bg: 'bg-amber-500/10'   },
  'CONGESTION RISK': { border: 'border-orange-500/30',  text: 'text-orange-400',  bg: 'bg-orange-500/10'  },
  'CRITICAL':        { border: 'border-red-500/30',     text: 'text-red-400',     bg: 'bg-red-500/10'     },
};

const barColor = (op: PlannedOperation) => {
  if (op.risk.level === 'CRITICAL') return 'bg-red-500/70';
  if (op.risk.level === 'HIGH')     return 'bg-amber-500/70';
  if (op.vessel.status === 'Moored') return 'bg-primary/60';
  return 'bg-emerald-500/50';
};

// Gantt time labels (every 12h)
function ganttLabels() {
  const labels: { label: string; pct: number }[] = [];
  for (let h = 0; h <= PLAN_HOURS; h += 12) {
    const ms = NOW_MS + h * 3600_000;
    labels.push({
      label: h === 0 ? 'NOW' : `+${h}h\n${new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' })}`,
      pct: (h / PLAN_HOURS) * 100,
    });
  }
  return labels;
}

// ─── sub-components ──────────────────────────────────────────────────────────

function PlanStatusBanner({ status, reasons }: { status: PlanStatus; reasons: string[] }) {
  const s = planStatusStyle[status];
  return (
    <div className={`rounded border ${s.border} ${s.bg} p-4 flex items-start space-x-4`}>
      <div className={`text-2xl font-black tracking-tight ${s.text}`}>{status}</div>
      <div className="flex-1">
        <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Plan Status — Reason</div>
        <ul className="space-y-0.5">
          {reasons.map((r, i) => <li key={i} className="text-sm text-gray-300">{r}</li>)}
        </ul>
      </div>
    </div>
  );
}

function BucketCard({ summary }: { summary: ReturnType<typeof buildBucketSummaries>[0] }) {
  const hasCritical = summary.criticalCount > 0;
  const hasHigh = summary.atRiskCount > 0;
  return (
    <div className={`rounded border p-4 ${hasCritical ? 'border-red-500/30 bg-red-500/5' : hasHigh ? 'border-amber-500/30 bg-amber-500/5' : 'border-border bg-surface-hover'}`}>
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="font-bold text-white text-base">{summary.label}</div>
          <div className="text-xs text-gray-500 mt-0.5">{summary.timeRange}</div>
        </div>
        {hasCritical && <Badge variant="danger">CRITICAL</Badge>}
        {!hasCritical && hasHigh && <Badge variant="warning">WATCH</Badge>}
        {!hasCritical && !hasHigh && summary.operations.length > 0 && <Badge variant="success">OK</Badge>}
      </div>
      {summary.operations.length === 0 ? (
        <p className="text-sm text-gray-500 italic">No vessel operations in this window.</p>
      ) : (
        <div className="space-y-1 text-sm">
          <div className="flex justify-between text-gray-300">
            <span className="text-gray-400">Vessel Ops</span>
            <span className="font-medium">{summary.operations.length}</span>
          </div>
          <div className="flex justify-between text-gray-300">
            <span className="text-gray-400">High/Critical Priority</span>
            <span className={summary.highPriorityCount > 0 ? 'text-amber-400 font-medium' : ''}>{summary.highPriorityCount}</span>
          </div>
          <div className="flex justify-between text-gray-300">
            <span className="text-gray-400">At Risk</span>
            <span className={(summary.atRiskCount + summary.criticalCount) > 0 ? 'text-red-400 font-medium' : ''}>{summary.atRiskCount + summary.criticalCount}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── main component ──────────────────────────────────────────────────────────

export default function Plan72Hour() {
  const { vessels, berths, cranes } = useStore();
  const navigate = useNavigate();

  // Filters
  const [filterPriority, setFilterPriority] = useState<string>('All');
  const [filterRisk, setFilterRisk] = useState<string>('All');
  const [filterBerth, setFilterBerth] = useState<string>('All');

  // Derive all plan data from store — no hardcoded values
  const allOps = useMemo(
    () => buildPlannedOperations(vessels, berths, cranes, NOW_MS),
    [vessels, berths, cranes]
  );

  const conflicts = useMemo(() => detectConflicts(berths, cranes, vessels), [berths, cranes, vessels]);
  const criticalConflicts = conflicts.filter(c => c.severity === 'CRITICAL').length;

  const { status: planStatus, reasons: statusReasons } = useMemo(
    () => derivePlanStatus(allOps, conflicts.length, criticalConflicts),
    [allOps, conflicts, criticalConflicts]
  );

  const buckets = useMemo(() => buildBucketSummaries(allOps, NOW_MS), [allOps]);

  // Filtered ops for Gantt + table
  const filteredOps = useMemo(() => {
    let ops = [...allOps];
    if (filterPriority !== 'All') ops = ops.filter(o => o.vessel.priority === filterPriority);
    if (filterRisk !== 'All')     ops = ops.filter(o => o.risk.level === filterRisk.toUpperCase());
    if (filterBerth !== 'All')    ops = ops.filter(o => o.berthId === filterBerth);
    return ops;
  }, [allOps, filterPriority, filterRisk, filterBerth]);

  // Unique berths appearing in the plan (for Gantt rows)
  const ganttBerths = useMemo(() => {
    const ids = [...new Set(filteredOps.map(o => o.berthId).filter(Boolean) as string[])];
    return ids.map(id => berths.find(b => b.id === id)!).filter(Boolean);
  }, [filteredOps, berths]);

  const labels = useMemo(() => ganttLabels(), []);

  // KPIs
  const mooredCount   = vessels.filter(v => v.status === 'Moored').length;
  const anchoredCount = vessels.filter(v => v.status === 'Anchored').length;
  const inboundCount  = vessels.filter(v => v.status === 'Inbound').length;
  const craneConflicts = conflicts.filter(c => c.affectedCraneId).length;

  return (
    <div className="space-y-6 pb-16">

      {/* Page header */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">72-Hour Operations Plan</h1>
          <p className="text-sm text-gray-400 mt-1">
            Operational horizon: <span className="text-gray-200">{new Date(NOW_MS).toLocaleString()}</span>
            &nbsp;→&nbsp;
            <span className="text-gray-200">{new Date(NOW_MS + 72 * 3600_000).toLocaleString()}</span>
          </p>
        </div>
        <PlanStatusBanner status={planStatus} reasons={statusReasons} />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Total Operations" value={allOps.length} icon={<Ship className="w-5 h-5 opacity-70"/>} />
        <MetricCard title="Currently Berthed" value={mooredCount} icon={<Anchor className="w-5 h-5 opacity-70"/>} />
        <MetricCard title="Inbound / Anchored" value={`${inboundCount} / ${anchoredCount}`} variant={anchoredCount > 1 ? 'warning' : 'default'} icon={<Activity className="w-5 h-5 opacity-70"/>} />
        <MetricCard title="Active Conflicts" value={conflicts.length} variant={criticalConflicts > 0 ? 'danger' : conflicts.length > 0 ? 'warning' : 'default'} icon={<AlertTriangle className="w-5 h-5 opacity-70"/>} />
      </div>

      {/* Planning buckets */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {buckets.map(b => <BucketCard key={b.bucket} summary={b} />)}
      </div>

      {/* ── Gantt chart ────────────────────────────────────────────────── */}
      <Card title="72-Hour Operations Gantt">

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-4 pb-4 border-b border-border items-center">
          <Filter className="w-4 h-4 text-gray-400 shrink-0" />
          <select className="bg-background border border-border rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-primary" value={filterPriority} onChange={e => setFilterPriority(e.target.value)}>
            <option value="All">All Priorities</option>
            <option value="Critical">Critical</option>
            <option value="High">High</option>
            <option value="Normal">Normal</option>
            <option value="Low">Low</option>
          </select>
          <select className="bg-background border border-border rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-primary" value={filterRisk} onChange={e => setFilterRisk(e.target.value)}>
            <option value="All">All Risks</option>
            <option value="Critical">Critical Risk</option>
            <option value="High">High Risk</option>
            <option value="Moderate">Moderate Risk</option>
            <option value="Low">Low Risk</option>
          </select>
          <select className="bg-background border border-border rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-primary" value={filterBerth} onChange={e => setFilterBerth(e.target.value)}>
            <option value="All">All Berths</option>
            {berths.map(b => <option key={b.id} value={b.id}>{b.id}</option>)}
          </select>
          {(filterPriority !== 'All' || filterRisk !== 'All' || filterBerth !== 'All') && (
            <button onClick={() => { setFilterPriority('All'); setFilterRisk('All'); setFilterBerth('All'); }} className="text-xs text-primary hover:underline">Clear filters</button>
          )}
        </div>

        {filteredOps.length === 0 ? (
          <p className="text-gray-500 text-sm py-8 text-center">No operations match the current filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[700px]">

              {/* Time axis */}
              <div className="flex mb-1 pl-24 relative">
                {labels.map((l, i) => (
                  <div key={i} className="absolute text-[10px] text-gray-500 whitespace-pre-line leading-tight" style={{ left: `calc(6rem + ${l.pct}%)`, transform: 'translateX(-50%)' }}>
                    {l.label}
                  </div>
                ))}
                <div className="h-6" />
              </div>

              {/* NOW marker */}
              <div className="relative pl-24 mb-2">
                <div className="absolute h-full border-l-2 border-primary/70 border-dashed" style={{ left: 'calc(6rem)' }}>
                  <div className="absolute -top-1 -left-[1px] w-2 h-2 bg-primary rounded-full" />
                </div>
              </div>

              {/* Gantt rows — one row per berth */}
              {ganttBerths.length === 0 ? (
                // If no berth grouping possible, show all ops as flat rows
                <div className="space-y-1 pt-2">
                  {filteredOps.map(op => (
                    <GanttRow key={op.vessel.id} ops={[op]} rowLabel={op.vessel.name} onSelect={() => navigate('/vessels')} />
                  ))}
                </div>
              ) : (
                <div className="space-y-1 pt-2">
                  {ganttBerths.map(berth => {
                    const berthOps = filteredOps.filter(o => o.berthId === berth.id);
                    return (
                      <GanttRow key={berth.id} ops={berthOps} rowLabel={berth.id} onSelect={() => navigate('/vessels')} />
                    );
                  })}
                  {/* Ops without a berth */}
                  {(() => {
                    const noBerth = filteredOps.filter(o => !o.berthId);
                    return noBerth.length > 0
                      ? <GanttRow ops={noBerth} rowLabel="Unassigned" onSelect={() => navigate('/vessels')} />
                      : null;
                  })()}
                </div>
              )}

              {/* Time axis bottom line */}
              <div className="pl-24 mt-2 border-t border-border" />
            </div>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Operations Table ──────────────────────────────────────────── */}
        <div className="lg:col-span-2">
          <Card title="Planned Operations" className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-gray-400 uppercase bg-surface-hover border-b border-border">
                  <tr>
                    <th className="px-4 py-3">Vessel</th>
                    <th className="px-4 py-3">ETA</th>
                    <th className="px-4 py-3">ETD</th>
                    <th className="px-4 py-3">Berth</th>
                    <th className="px-4 py-3">Priority</th>
                    <th className="px-4 py-3">Risk</th>
                    <th className="px-4 py-3">Cranes</th>
                    <th className="px-4 py-3 text-right">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOps.map(op => (
                    <tr key={op.vessel.id} className="border-b border-border hover:bg-surface-hover/60 cursor-pointer" onClick={() => navigate('/vessels')}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{op.vessel.name}</div>
                        <div className="text-xs text-gray-500">{op.vessel.id} · {op.vessel.type}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-300">{new Date(op.etaMs).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="px-4 py-3 text-gray-300">{new Date(op.etdMs).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="px-4 py-3 text-gray-300">{op.berthId ?? '—'}</td>
                      <td className="px-4 py-3"><Badge variant={priorityVariant(op.vessel.priority)}>{op.vessel.priority}</Badge></td>
                      <td className="px-4 py-3"><Badge variant={riskVariant(op.risk.level)}>{op.risk.level}</Badge></td>
                      <td className="px-4 py-3">
                        <span className={op.craneShortfall > 0 ? 'text-red-400 font-medium' : 'text-gray-300'}>
                          {op.assignedCranes.length}/{op.requiredCranes}
                          {op.craneShortfall > 0 && <span className="ml-1 text-xs">(−{op.craneShortfall})</span>}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={e => { e.stopPropagation(); navigate('/vessels'); }} className="text-primary hover:text-blue-400">
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* ── Right Column ─────────────────────────────────────────────── */}
        <div className="space-y-6">

          {/* Shift Briefing */}
          <Card title="Shift Briefing" className="border-primary/20">
            <div className="space-y-4 text-sm">
              <ShiftSection
                title="Current State"
                icon={<Anchor className="w-4 h-4 text-gray-400" />}
                items={[
                  `${mooredCount} vessel(s) currently berthed`,
                  `${anchoredCount} vessel(s) in anchorage`,
                  `${cranes.filter(c => c.status === 'Active').length} cranes operational`,
                  `${berths.filter(b => b.status === 'Available').length} berths available`,
                ]}
              />
              <ShiftSection
                title="Next 24 Hours"
                icon={<Clock className="w-4 h-4 text-gray-400" />}
                items={[
                  `${buckets[0].operations.length} vessel operations planned`,
                  ...(buckets[0].highPriorityCount > 0 ? [`${buckets[0].highPriorityCount} high/critical priority vessel(s)`] : []),
                  ...(buckets[0].criticalCount > 0 ? [`${buckets[0].criticalCount} operation(s) at CRITICAL risk`] : []),
                  ...(buckets[0].atRiskCount > 0 ? [`${buckets[0].atRiskCount} operation(s) at HIGH risk`] : []),
                ]}
              />
              {(conflicts.length > 0 || craneConflicts > 0) && (
                <ShiftSection
                  title="Attention Required"
                  icon={<AlertTriangle className="w-4 h-4 text-amber-400" />}
                  items={[
                    ...conflicts.slice(0, 3).map(c => c.message),
                  ]}
                  variant="warning"
                />
              )}
              {conflicts.length === 0 && (
                <ShiftSection
                  title="Status"
                  icon={<CheckCircle className="w-4 h-4 text-emerald-400" />}
                  items={['No critical issues requiring immediate intervention']}
                  variant="ok"
                />
              )}
            </div>
          </Card>

          {/* Crane Resource Plan */}
          <Card title="Crane Resource Plan">
            {filteredOps.filter(o => o.craneShortfall > 0).length === 0 ? (
              <div className="flex items-center space-x-2 text-emerald-400 text-sm py-1">
                <CheckCircle className="w-5 h-5" />
                <span>No crane shortfalls detected.</span>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredOps.filter(o => o.craneShortfall > 0).map(op => (
                  <div key={op.vessel.id} className="p-3 rounded border border-amber-500/20 bg-amber-500/10 text-sm">
                    <div className="font-medium text-white mb-1">{op.vessel.name}</div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-400">Required cranes</span>
                      <span className="text-white">{op.requiredCranes}</span>
                    </div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-400">Active assigned</span>
                      <span className="text-white">{op.assignedCranes.length}</span>
                    </div>
                    <div className="flex justify-between text-xs font-bold">
                      <span className="text-amber-400">Shortfall</span>
                      <span className="text-amber-400">−{op.craneShortfall} crane(s)</span>
                    </div>
                    <button
                      onClick={() => navigate('/berths-cranes')}
                      className="mt-2 text-xs text-primary hover:underline flex items-center space-x-1"
                    >
                      <Zap className="w-3 h-3" /><span>View Resource Panel</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Conflicts */}
          {conflicts.length > 0 && (
            <Card title="Planning Conflicts">
              <div className="space-y-3">
                {conflicts.slice(0, 5).map(c => (
                  <div key={c.id} className={`text-xs p-3 rounded border ${c.severity === 'CRITICAL' ? 'bg-red-500/10 border-red-500/20' : c.severity === 'HIGH' ? 'bg-amber-500/10 border-amber-500/20' : 'bg-surface-hover border-border'}`}>
                    <Badge variant={c.severity === 'CRITICAL' ? 'danger' : c.severity === 'HIGH' ? 'warning' : 'default'} className="mb-1">{c.severity}</Badge>
                    <div className="font-medium text-white mt-1">{c.message}</div>
                    <div className="text-gray-400 mt-0.5">{c.reason}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

        </div>
      </div>

    </div>
  );
}

// ─── Gantt Row sub-component ────────────────────────────────────────────────

function GanttRow({
  ops,
  rowLabel,
  onSelect,
}: {
  ops: PlannedOperation[];
  rowLabel: string;
  onSelect: () => void;
}) {
  return (
    <div className="flex items-center h-10 group">
      {/* Row label */}
      <div className="w-24 shrink-0 pr-2 text-right text-xs text-gray-400 truncate" title={rowLabel}>{rowLabel}</div>
      {/* Track */}
      <div className="flex-1 relative h-7 bg-background/60 rounded border border-border/50">
        {ops.map(op => (
          <button
            key={op.vessel.id}
            onClick={onSelect}
            title={`${op.vessel.name}\nETA: ${new Date(op.etaMs).toLocaleString()}\nETD: ${new Date(op.etdMs).toLocaleString()}\nRisk: ${op.risk.level}`}
            className={`absolute top-0.5 h-6 rounded text-[10px] font-medium text-white truncate px-1.5 flex items-center transition-opacity hover:opacity-90 cursor-pointer ${barColor(op)}`}
            style={{
              left: `${op.barStartPct}%`,
              width: `${op.barWidthPct}%`,
              minWidth: '4px',
            }}
          >
            <span className="truncate">{op.vessel.name}</span>
          </button>
        ))}
        {/* NOW line */}
        <div className="absolute top-0 bottom-0 border-l border-primary/70 border-dashed" style={{ left: '0%' }} />
      </div>
    </div>
  );
}

// ─── Shift section sub-component ────────────────────────────────────────────

function ShiftSection({
  title,
  icon,
  items,
  variant = 'default',
}: {
  title: string;
  icon: React.ReactNode;
  items: string[];
  variant?: 'warning' | 'ok' | 'default';
}) {
  const textColor = variant === 'warning' ? 'text-amber-300/90' : variant === 'ok' ? 'text-emerald-300/90' : 'text-gray-300';
  return (
    <div>
      <div className="flex items-center space-x-1.5 text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">
        {icon}<span>{title}</span>
      </div>
      <ul className="space-y-0.5 pl-1">
        {items.map((item, i) => (
          <li key={i} className={`text-sm ${textColor} flex items-start space-x-1.5`}>
            <span className="mt-1.5 w-1 h-1 bg-gray-500 rounded-full shrink-0" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
