import { useMemo } from 'react';
import { useStore } from '../../shared/store';
import { generateCopilotBriefing } from '../../shared/services/copilotEngine';
import type { CopilotInsight } from '../../shared/services/copilotEngine';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { MetricCard } from '../components/ui/MetricCard';
import { AlertTriangle, Activity, Navigation, GitBranch, Terminal, ExternalLink, Ship, Anchor } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const severityVariant = (level: string) => {
  if (level === 'CRITICAL') return 'danger';
  if (level === 'HIGH') return 'warning';
  if (level === 'MEDIUM') return 'info';
  return 'default';
};

export default function Copilot() {
  const { vessels, berths, cranes } = useStore();
  const navigate = useNavigate();

  const briefing = useMemo(() => {
    return generateCopilotBriefing(vessels, berths, cranes);
  }, [vessels, berths, cranes]);

  const handleAction = (insight: CopilotInsight) => {
    if (insight.category === 'VESSEL' || insight.category === 'ROUTING') {
      navigate('/vessels');
    } else if (insight.category === 'BERTH' || insight.category === 'CRANE' || insight.category === 'CONGESTION') {
      navigate('/berths-cranes');
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight flex items-center space-x-3">
            <Terminal className="w-8 h-8 text-primary" />
            <span>Operations Copilot</span>
          </h1>
          <p className="text-gray-400 mt-2">Deterministic Decision Support for the Current Shift</p>
        </div>
        <Badge variant="default" className="text-xs font-mono">Simulated Operational Data</Badge>
      </div>

      {/* Port Health */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard
          title="Congestion Risk"
          value={briefing.portHealth.congestionRisk}
          icon={<Activity className={`w-6 h-6 ${briefing.portHealth.congestionRisk === 'CRITICAL' || briefing.portHealth.congestionRisk === 'HIGH' ? 'text-red-400' : 'text-primary'}`} />}
          trend={briefing.portHealth.congestionRisk === 'CRITICAL' ? 'down' : 'neutral'}
        />
        <MetricCard
          title="Berth Utilisation"
          value={`${briefing.portHealth.berthUtilisation.toFixed(1)}%`}
          icon={<Anchor className="w-6 h-6 text-primary" />}
        />
        <MetricCard
          title="Available Cranes"
          value={briefing.portHealth.availableCranes.toString()}
          icon={<Activity className="w-6 h-6 text-primary" />}
        />
        <MetricCard
          title="Vessels At Risk"
          value={briefing.portHealth.vesselsAtRisk.toString()}
          icon={<Ship className={`w-6 h-6 ${briefing.portHealth.vesselsAtRisk > 0 ? 'text-amber-400' : 'text-primary'}`} />}
          trend={briefing.portHealth.vesselsAtRisk > 0 ? 'down' : 'neutral'}
        />
      </div>

      {/* Shift Briefing */}
      <Card title="Shift Briefing" className="bg-primary/5 border-primary/20">
        <div className="text-lg text-white leading-relaxed font-medium">
          {briefing.shiftSummary}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Top Risks & Recommended Actions */}
        <div className="lg:col-span-2 space-y-6">
          <Card title="Top Identified Risks">
            {briefing.topRisks.length === 0 ? (
              <div className="text-gray-500 italic py-4">No critical risks identified in current schedule.</div>
            ) : (
              <div className="space-y-4 mt-2">
                {briefing.topRisks.map(risk => (
                  <div key={risk.id} className="bg-surface p-4 rounded border border-border hover:border-gray-600 transition-colors cursor-pointer group" onClick={() => handleAction(risk)}>
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center space-x-2">
                        {risk.severity === 'CRITICAL' || risk.severity === 'HIGH' ? (
                          <AlertTriangle className="w-4 h-4 text-red-400" />
                        ) : (
                          <Activity className="w-4 h-4 text-primary" />
                        )}
                        <h4 className="font-bold text-white text-sm group-hover:text-primary transition-colors">{risk.title}</h4>
                      </div>
                      <Badge variant={severityVariant(risk.severity)} className="text-[10px]">{risk.severity}</Badge>
                    </div>
                    <p className="text-sm text-gray-400 mb-3">{risk.explanation}</p>
                    
                    <div className="bg-surface-hover p-3 rounded text-sm flex justify-between items-center border border-border">
                      <div>
                        <span className="text-gray-500 uppercase tracking-wider text-[10px] block mb-1">Recommended Action</span>
                        <span className="text-gray-200">{risk.recommendedAction}</span>
                      </div>
                      <ExternalLink className="w-4 h-4 text-gray-500 group-hover:text-primary" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Routing Opportunities */}
          {briefing.routingOpportunities.length > 0 && (
            <Card title="Routing Opportunities" className="border-blue-500/30">
              <div className="space-y-4">
                {briefing.routingOpportunities.map(opp => (
                  <div key={opp.id} className="flex justify-between items-center bg-surface p-4 rounded border border-border" onClick={() => handleAction(opp)}>
                    <div>
                      <div className="flex items-center space-x-2 mb-1">
                        <Navigation className="w-4 h-4 text-blue-400" />
                        <h4 className="font-bold text-white text-sm">{opp.title}</h4>
                      </div>
                      <p className="text-xs text-gray-400">{opp.explanation}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold text-primary mb-1">{opp.recommendedAction}</div>
                      <div className="text-[10px] text-gray-500">{opp.impact}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Optimisation Impact */}
          <Card title="Algorithmic Optimisation Impact">
            {briefing.optimisationOpportunity ? (
              <div>
                <p className="text-sm text-gray-400 mb-4">Applying the optimisation engine will yield the following deterministic improvements:</p>
                <div className="overflow-x-auto rounded border border-border">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-gray-400 uppercase bg-surface-hover border-b border-border">
                      <tr>
                        <th className="px-4 py-2">Metric</th>
                        <th className="px-4 py-2">Current</th>
                        <th className="px-4 py-2">Optimised</th>
                        <th className="px-4 py-2 text-right">Impact</th>
                      </tr>
                    </thead>
                    <tbody className="bg-surface">
                      <tr className="border-b border-border">
                        <td className="px-4 py-2 font-medium text-gray-300">Wait Time</td>
                        <td className="px-4 py-2 text-red-400">{briefing.optimisationOpportunity.baseline.estimatedWaitingHours.toFixed(1)}h</td>
                        <td className="px-4 py-2 text-green-400">{briefing.optimisationOpportunity.optimized.estimatedWaitingHours.toFixed(1)}h</td>
                        <td className="px-4 py-2 text-right text-primary font-bold">
                          -{(briefing.optimisationOpportunity.baseline.estimatedWaitingHours - briefing.optimisationOpportunity.optimized.estimatedWaitingHours).toFixed(1)}h
                        </td>
                      </tr>
                      <tr className="border-b border-border">
                        <td className="px-4 py-2 font-medium text-gray-300">Active Conflicts</td>
                        <td className="px-4 py-2">{briefing.optimisationOpportunity.baseline.activeConflicts}</td>
                        <td className="px-4 py-2">{briefing.optimisationOpportunity.optimized.activeConflicts}</td>
                        <td className="px-4 py-2 text-right text-primary font-bold">
                          {briefing.optimisationOpportunity.optimized.activeConflicts < briefing.optimisationOpportunity.baseline.activeConflicts ? 'Reduced' : '-'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 text-right">
                  <button onClick={() => navigate('/berths-cranes')} className="btn btn-primary text-sm flex items-center inline-flex space-x-2">
                    <GitBranch className="w-4 h-4" />
                    <span>Review & Apply</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-gray-500 italic py-2 text-sm">No significant algorithmic improvements available for the current state.</div>
            )}
          </Card>
        </div>

        {/* Right Column: Next 12 Hours Timeline */}
        <div className="space-y-6">
          <Card title="Next 12 Hours">
            {briefing.next12Hours.length === 0 ? (
              <div className="text-gray-500 text-sm">No scheduled events.</div>
            ) : (
              <div className="relative border-l-2 border-border ml-3 space-y-6 pb-2 mt-4">
                {briefing.next12Hours.map((event, idx) => (
                  <div key={idx} className="relative pl-6">
                    <div className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 border-surface ${event.type === 'arrival' ? 'bg-primary' : event.type === 'departure' ? 'bg-green-500' : 'bg-gray-500'}`}></div>
                    <div className="text-sm font-bold text-white mb-1">
                      {event.timeOffsetHours > 0 ? `+${event.timeOffsetHours}h` : 'Now'}
                    </div>
                    <div className="text-sm text-gray-300">{event.description}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

      </div>
    </div>
  );
}
