import { useEffect, useState } from 'react';
import { useStore } from '../../shared/store';
import { calculateBerthRisk, generateAlertsAndRecs, generateTimeline } from '../../shared/services/congestionEngine';
import { MetricCard } from '../components/ui/MetricCard';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { AlertTriangle, Clock, Ship, Anchor, Activity, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const riskVariant = (level: string) => {
  if (level === 'CRITICAL') return 'danger';
  if (level === 'HIGH') return 'warning';
  if (level === 'LOW') return 'success';
  return 'default';
};

export default function CommandCenter() {
  const { vessels, berths, cranes, setRecommendations } = useStore();
  const navigate = useNavigate();
  const [selectedHotspot, setSelectedHotspot] = useState<any>(null);
  const [selectedVessel, setSelectedVessel] = useState<any>(null);

  // Run intelligence engine
  useEffect(() => {
    const { recommendations } = generateAlertsAndRecs(berths, vessels, cranes);
    // In a real app we'd dispatch alerts to the store, for PoC we can just use them locally or update store if needed.
    // We already have addAlert in store, but to avoid infinite loops, let's just compute them on the fly for the dashboard.
    setRecommendations(recommendations);
  }, [berths, vessels, cranes, setRecommendations]);

  const { alerts, recommendations } = generateAlertsAndRecs(berths, vessels, cranes);
  const timeline = generateTimeline(vessels);

  // Computed KPIs
  const anchored = vessels.filter(v => v.status === 'Anchored').length;
  const inbound = vessels.filter(v => v.status === 'Inbound').length;
  const activeCranes = cranes.filter(c => c.status === 'Active').length;
  const occupiedBerths = berths.filter(b => b.status === 'Occupied').length;
  const berthUtilisation = Math.round((occupiedBerths / berths.length) * 100);
  
  const berthRisks = berths.map(b => ({ berth: b, risk: calculateBerthRisk(b, vessels, cranes) }));
  const hotspots = berthRisks.filter(r => r.risk.level === 'CRITICAL' || r.risk.level === 'HIGH').sort((a, b) => b.risk.score - a.risk.score);
  
  const portHealthScore = Math.max(0, 100 - (hotspots.length * 20) - (anchored * 5));
  let portStatus: 'Operational' | 'Attention Required' | 'Critical' = 'Operational';
  if (portHealthScore < 50) portStatus = 'Critical';
  else if (portHealthScore < 80) portStatus = 'Attention Required';

  const upcomingArrivals = vessels.filter(v => v.status === 'Inbound')
    .sort((a, b) => new Date(a.eta).getTime() - new Date(b.eta).getTime())
    .slice(0, 5);

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Port Operations Control</h1>
          <p className="text-sm text-gray-400 mt-1">Real-time congestion prediction and resource allocation</p>
        </div>
        <div className="flex items-center space-x-3">
          <span className="text-sm text-gray-400">Port Status:</span>
          <Badge variant={portStatus === 'Operational' ? 'success' : portStatus === 'Critical' ? 'danger' : 'warning'} className="text-sm px-3 py-1">
            {portStatus}
          </Badge>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard 
          title="Congestion Risk" 
          value={`${hotspots.length > 0 ? hotspots[0].risk.score : 10}%`} 
          subtitle="Highest at any berth" 
          variant={hotspots.length > 0 && hotspots[0].risk.level === 'CRITICAL' ? 'danger' : 'default'}
          icon={<AlertTriangle className="w-5 h-5 opacity-70" />}
        />
        <MetricCard 
          title="Berth Utilisation" 
          value={`${berthUtilisation}%`} 
          subtitle={`${occupiedBerths} of ${berths.length} occupied`} 
          variant={berthUtilisation > 80 ? 'warning' : 'default'}
          icon={<Anchor className="w-5 h-5 opacity-70" />}
        />
        <MetricCard 
          title="Available Cranes" 
          value={`${activeCranes}/${cranes.length}`} 
          subtitle={`${cranes.filter(c=>c.status==='Fault').length} faults`} 
          variant={activeCranes < cranes.length * 0.5 ? 'danger' : 'default'}
          icon={<Activity className="w-5 h-5 opacity-70" />}
        />
        <MetricCard 
          title="Anchorage Queue" 
          value={anchored} 
          subtitle={`${inbound} inbound within 24h`} 
          variant={anchored > 3 ? 'warning' : 'default'}
          icon={<Ship className="w-5 h-5 opacity-70" />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Congestion Hotspots */}
          <Card title="Predicted Congestion Hotspots" className="border-red-500/20">
            {hotspots.length === 0 ? (
              <p className="text-gray-400 text-sm">No significant congestion predicted.</p>
            ) : (
              <div className="space-y-4">
                {hotspots.map((h, i) => (
                  <div key={i} onClick={() => setSelectedHotspot(h)} className="bg-surface-hover p-4 rounded border border-border flex flex-col md:flex-row md:items-start justify-between cursor-pointer hover:border-gray-500 transition-colors">
                    <div className="mb-3 md:mb-0">
                      <div className="flex items-center space-x-3 mb-2">
                        <span className="font-bold text-lg text-white">{h.berth.id}</span>
                        <Badge variant={riskVariant(h.risk.level)}>{h.risk.level} RISK ({h.risk.score}%)</Badge>
                      </div>
                      <div className="text-sm text-gray-400 flex items-center space-x-2">
                        <Clock className="w-4 h-4" />
                        <span>Critical in ~{h.risk.timeToCongestionHours}h</span>
                      </div>
                    </div>
                    <div className="text-sm">
                      <div className="text-gray-300 font-medium mb-1">Contributing Factors:</div>
                      <ul className="list-disc pl-4 text-gray-400 space-y-1">
                        {h.risk.factors.map((f, j) => <li key={j}>{f}</li>)}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Upcoming Arrivals */}
          <Card title="Upcoming Arrivals (Next 24H)">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-gray-400 uppercase bg-surface-hover">
                  <tr>
                    <th className="px-4 py-3 rounded-tl">Vessel</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">ETA</th>
                    <th className="px-4 py-3">Priority</th>
                    <th className="px-4 py-3 rounded-tr">Dest. Berth</th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingArrivals.map((v, i) => (
                    <tr key={i} onClick={() => setSelectedVessel(v)} className="border-b border-border hover:bg-surface-hover/50 cursor-pointer">
                      <td className="px-4 py-3 font-medium text-white">{v.name}</td>
                      <td className="px-4 py-3 text-gray-400">{v.type}</td>
                      <td className="px-4 py-3 text-gray-300">{new Date(v.eta).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                      <td className="px-4 py-3">
                        <Badge variant={v.priority === 'Critical' ? 'danger' : v.priority === 'High' ? 'warning' : 'default'}>{v.priority}</Badge>
                      </td>
                      <td className="px-4 py-3 text-gray-300">{v.scheduledBerthId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          
          {/* Alerts */}
          <Card title="Operational Alerts">
            <div className="space-y-3">
              {alerts.length === 0 ? <p className="text-gray-400 text-sm">No active alerts.</p> : alerts.map((a, i) => (
                <div key={i} onClick={() => navigate('/berths-cranes')} className="flex items-start space-x-3 p-3 bg-surface-hover rounded border border-border cursor-pointer hover:border-gray-500">
                  {a.type === 'CRITICAL' ? <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" /> : <Activity className="w-5 h-5 text-amber-400 shrink-0" />}
                  <div>
                    <p className={`text-sm font-medium ${a.type === 'CRITICAL' ? 'text-red-100' : 'text-amber-100'}`}>{a.message}</p>
                    <p className="text-xs text-gray-500 mt-1">{a.relatedEntityId}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Recommendations */}
          <Card title="Recommended Actions" className="border-primary/20">
            <div className="space-y-4">
              {recommendations.length === 0 ? <p className="text-gray-400 text-sm">No current recommendations.</p> : recommendations.map((r, i) => (
                <div key={i} className="p-3 bg-primary/5 rounded border border-primary/20 relative">
                  <div className="absolute top-3 right-3 text-primary"><Zap className="w-4 h-4" /></div>
                  <h4 className="text-sm font-semibold text-primary-100 pr-6">{r.action}</h4>
                  <p className="text-xs text-gray-400 mt-1 mb-2">{r.reason}</p>
                  <div className="text-xs font-medium text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded inline-block">
                    Impact: {r.expectedImpact}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Timeline */}
          <Card title="Next 12 Hours">
            <div className="relative border-l border-border ml-3 space-y-6 pb-2">
              {timeline.slice(0, 6).map((t, i) => (
                <div key={i} className="relative pl-6">
                  <span className={`absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full ${t.timeOffsetHours === 0 ? 'bg-primary ring-4 ring-primary/20' : t.type === 'arrival' ? 'bg-emerald-400' : t.type === 'departure' ? 'bg-amber-400' : 'bg-gray-500'}`}></span>
                  <div className="text-xs font-bold text-gray-400 mb-0.5">
                    {t.timeOffsetHours === 0 ? 'NOW' : `+${t.timeOffsetHours}h`}
                  </div>
                  <div className="text-sm text-gray-200">{t.description}</div>
                </div>
              ))}
            </div>
          </Card>

        </div>
      </div>

      {/* Interactive Modals */}
      <Modal isOpen={!!selectedHotspot} onClose={() => setSelectedHotspot(null)} title={`Berth Hotspot: ${selectedHotspot?.berth.id}`}>
        {selectedHotspot && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Predicted Risk:</span>
              <Badge variant={riskVariant(selectedHotspot.risk.level)}>{selectedHotspot.risk.score}% ({selectedHotspot.risk.level})</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Current Status:</span>
              <span className="text-white">{selectedHotspot.berth.status}</span>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-2 border-b border-border pb-1">Factors</h4>
              <ul className="list-disc pl-4 text-gray-300 text-sm space-y-1">
                {selectedHotspot.risk.factors.map((f: string, i: number) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={!!selectedVessel} onClose={() => setSelectedVessel(null)} title={`Vessel: ${selectedVessel?.name}`}>
        {selectedVessel && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Type:</span>
              <span className="text-white">{selectedVessel.type}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">ETA:</span>
              <span className="text-white">{new Date(selectedVessel.eta).toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Priority:</span>
              <Badge variant={selectedVessel.priority === 'High' ? 'danger' : 'default'}>{selectedVessel.priority}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Target Berth:</span>
              <span className="text-white">{selectedVessel.scheduledBerthId || 'Unassigned'}</span>
            </div>
          </div>
        )}
      </Modal>

    </div>
  );
}
