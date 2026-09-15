import { useState, useMemo } from 'react';
import { useStore } from '../../shared/store';
import { calculateBerthRisk } from '../../shared/services/congestionEngine';
import { MetricCard } from '../components/ui/MetricCard';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Ship, Anchor, AlertTriangle, Search, Info, ChevronDown, ChevronUp, MapPin } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Vessel, RiskProfile } from '../../shared/types';
import { evaluateRoutingOptions } from '../../shared/services/routingEngine';
import type { RouteRecommendation } from '../../shared/services/routingEngine';

const riskVariant = (level: string) => {
  if (level === 'CRITICAL') return 'danger';
  if (level === 'HIGH') return 'warning';
  if (level === 'LOW') return 'success';
  return 'default';
};

const priorityVariant = (priority: string) => {
  if (priority === 'Critical') return 'danger';
  if (priority === 'High') return 'warning';
  if (priority === 'Low') return 'default';
  return 'info';
};

function RouteRecommendationPanel({ recommendation, routingVessel }: { recommendation: RouteRecommendation, routingVessel: Vessel }) {
  const recommendedOpt = recommendation.options.find(o => o.id === recommendation.recommendedOptionId)!;
  const isAltBetter = recommendedOpt.id !== 'current-port';

  return (
    <div className="space-y-6">
      <div className="bg-surface-hover p-4 rounded border border-border flex justify-between items-center">
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Selected Vessel</div>
          <div className="text-lg font-bold text-white">{routingVessel.name}</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Current Destination</div>
          <div className="text-lg font-bold text-white">{routingVessel.destination || 'Current Port'}</div>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Option Cards</h3>
        {recommendation.options.map(opt => (
          <div key={opt.id} className={`p-4 rounded border ${opt.status === 'RECOMMENDED' ? 'border-primary bg-primary/10' : 'border-border bg-background'}`}>
            <div className="flex justify-between items-start mb-3">
              <div>
                <h4 className="font-bold text-white text-base">{opt.name}</h4>
                <div className="text-xs text-gray-400 mt-1">
                  Status: <Badge variant={opt.isBaseline ? 'default' : (opt.status === 'RECOMMENDED' ? 'success' : opt.status === 'VIABLE' ? 'info' : 'danger')} className="ml-1 text-[10px]">{opt.isBaseline ? 'BASELINE' : opt.status}</Badge>
                </div>
              </div>
              <div className="text-right flex space-x-4">
                <div>
                  <div className="text-xs text-gray-500">Risk</div>
                  <Badge variant={riskVariant(opt.congestionRisk)} className="text-[10px] mt-1">{opt.congestionRisk}</Badge>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Wait</div>
                  <div className="text-sm font-mono text-gray-300 mt-1">{opt.estimatedWaitingHours.toFixed(1)}h</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Sailing</div>
                  <div className="text-sm font-mono text-gray-300 mt-1">{opt.additionalSailingHours > 0 ? `+${opt.additionalSailingHours.toFixed(1)}h` : '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Total Impact</div>
                  <div className={`text-sm font-mono font-bold mt-1 ${opt.status === 'RECOMMENDED' ? 'text-primary' : 'text-gray-200'}`}>{opt.totalEstimatedTime.toFixed(1)}h</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-surface-hover p-4 rounded border border-border">
        <h3 className="text-sm font-semibold text-white uppercase tracking-wider mb-2">Recommended Action</h3>
        <p className="text-base text-primary font-bold mb-4">
          {isAltBetter 
            ? `Reroute to ${recommendedOpt.name}.` 
            : `Current port remains the best option.`}
        </p>

        <h4 className="text-xs text-gray-400 uppercase tracking-wider mb-1">Why</h4>
        <ul className="list-disc pl-5 text-sm text-gray-300 space-y-1 mb-4">
          {recommendedOpt.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>

        {recommendedOpt.tradeOffs && (
          <>
            <h4 className="text-xs text-gray-400 uppercase tracking-wider mb-1">Trade-offs</h4>
            <p className="text-sm text-gray-300">{recommendedOpt.tradeOffs}</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function Vessels() {
  const { vessels, berths, cranes } = useStore();
  const navigate = useNavigate();

  // Pre-calculate risk for all vessels based on their assigned berth
  const vesselsWithRisk = useMemo(() => {
    return vessels.map(v => {
      let risk: RiskProfile = { score: 0, level: 'LOW', timeToCongestionHours: null, factors: [] };
      if (v.scheduledBerthId) {
        const berth = berths.find(b => b.id === v.scheduledBerthId);
        if (berth) {
          risk = calculateBerthRisk(berth, vessels, cranes);
        }
      }
      return { ...v, risk };
    });
  }, [vessels, berths, cranes]);

  // Filters & Search
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [riskFilter, setRiskFilter] = useState<string>('All');
  const [priorityFilter, setPriorityFilter] = useState<string>('All');

  // Sorting
  const [sortField, setSortField] = useState<keyof Vessel | 'riskScore'>('eta');
  const [sortAsc, setSortAsc] = useState(true);

  // Detail Modal
  const [selectedVessel, setSelectedVessel] = useState<typeof vesselsWithRisk[0] | null>(null);

  // Routing Modal
  const [routingVessel, setRoutingVessel] = useState<typeof vesselsWithRisk[0] | null>(null);
  const routeRecommendation = useMemo(() => {
    if (!routingVessel) return null;
    return evaluateRoutingOptions(routingVessel, vessels, berths, cranes);
  }, [routingVessel, vessels, berths, cranes]);

  // Filter Logic
  const filteredVessels = useMemo(() => {
    let result = vesselsWithRisk;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(v => v.name.toLowerCase().includes(q) || v.id.toLowerCase().includes(q) || v.destination.toLowerCase().includes(q));
    }
    if (statusFilter !== 'All') {
      result = result.filter(v => v.status === statusFilter);
    }
    if (riskFilter !== 'All') {
      result = result.filter(v => v.risk.level === riskFilter.toUpperCase());
    }
    if (priorityFilter !== 'All') {
      result = result.filter(v => v.priority === priorityFilter);
    }

    // Sort
    result.sort((a, b) => {
      let valA: any = a[sortField as keyof Vessel];
      let valB: any = b[sortField as keyof Vessel];
      
      if (sortField === 'riskScore') {
        valA = a.risk.score;
        valB = b.risk.score;
      } else if (sortField === 'eta' || sortField === 'etd') {
        valA = new Date(valA).getTime();
        valB = new Date(valB).getTime();
      }

      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });

    return result;
  }, [vesselsWithRisk, search, statusFilter, riskFilter, priorityFilter, sortField, sortAsc]);

  // KPIs
  const inboundCount = vessels.filter(v => v.status === 'Inbound').length;
  const anchoredCount = vessels.filter(v => v.status === 'Anchored').length;
  const atRiskCount = vesselsWithRisk.filter(v => v.risk.level === 'CRITICAL' || v.risk.level === 'HIGH').length;

  const handleSort = (field: keyof Vessel | 'riskScore') => {
    if (sortField === field) setSortAsc(!sortAsc);
    else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return null;
    return sortAsc ? <ChevronUp className="w-4 h-4 inline" /> : <ChevronDown className="w-4 h-4 inline" />;
  };

  return (
    <div className="space-y-6 pb-12">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Vessels Operations</h1>
          <p className="text-sm text-gray-400 mt-1">Manage and track vessel traffic and berth assignments</p>
        </div>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Total Vessels" value={vessels.length} icon={<Ship className="w-5 h-5 opacity-70" />} />
        <MetricCard title="Inbound" value={inboundCount} icon={<MapPin className="w-5 h-5 opacity-70" />} />
        <MetricCard title="Anchorage Queue" value={anchoredCount} variant={anchoredCount > 2 ? 'warning' : 'default'} icon={<Anchor className="w-5 h-5 opacity-70" />} />
        <MetricCard title="At Risk" value={atRiskCount} variant={atRiskCount > 0 ? 'danger' : 'default'} icon={<AlertTriangle className="w-5 h-5 opacity-70" />} />
      </div>

      {/* Filters & Search */}
      <Card className="p-4 bg-surface/50">
        <div className="flex flex-col md:flex-row gap-4 items-center">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-500" />
            <input 
              type="text"
              placeholder="Search by name, ID, or destination..."
              className="w-full bg-background border border-border rounded pl-9 pr-4 py-2 text-sm text-white focus:outline-none focus:border-primary"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className="bg-background border border-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary w-full md:w-auto" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="All">All Statuses</option>
            <option value="Inbound">Inbound</option>
            <option value="Anchored">Anchored</option>
            <option value="Moored">Moored</option>
            <option value="Departing">Departing</option>
            <option value="Delayed">Delayed</option>
          </select>
          <select className="bg-background border border-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary w-full md:w-auto" value={riskFilter} onChange={e => setRiskFilter(e.target.value)}>
            <option value="All">All Risks</option>
            <option value="Low">Low Risk</option>
            <option value="Moderate">Moderate Risk</option>
            <option value="High">High Risk</option>
            <option value="Critical">Critical Risk</option>
          </select>
          <select className="bg-background border border-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary w-full md:w-auto" value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}>
            <option value="All">All Priorities</option>
            <option value="Low">Low</option>
            <option value="Normal">Normal</option>
            <option value="High">High</option>
            <option value="Critical">Critical</option>
          </select>
        </div>
      </Card>

      {/* Vessel Table */}
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-gray-400 uppercase bg-surface-hover border-b border-border">
              <tr>
                <th className="px-4 py-3">Vessel</th>
                <th className="px-4 py-3 cursor-pointer select-none" onClick={() => handleSort('status')}>Status <SortIcon field="status"/></th>
                <th className="px-4 py-3 cursor-pointer select-none" onClick={() => handleSort('eta')}>ETA <SortIcon field="eta"/></th>
                <th className="px-4 py-3 cursor-pointer select-none" onClick={() => handleSort('etd')}>ETD <SortIcon field="etd"/></th>
                <th className="px-4 py-3">Berth</th>
                <th className="px-4 py-3">Destination</th>
                <th className="px-4 py-3 cursor-pointer select-none" onClick={() => handleSort('priority')}>Priority <SortIcon field="priority"/></th>
                <th className="px-4 py-3 cursor-pointer select-none" onClick={() => handleSort('handlingDurationHours')}>Handling <SortIcon field="handlingDurationHours"/></th>
                <th className="px-4 py-3 cursor-pointer select-none" onClick={() => handleSort('riskScore')}>Risk <SortIcon field="riskScore"/></th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredVessels.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-gray-500">
                    No vessels match your search or filters.
                  </td>
                </tr>
              ) : (
                filteredVessels.map((v) => (
                  <tr key={v.id} onClick={() => setSelectedVessel(v)} className="border-b border-border hover:bg-surface-hover/50 cursor-pointer transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{v.name}</div>
                      <div className="text-xs text-gray-500">{v.id} • {v.type}</div>
                    </td>
                    <td className="px-4 py-3"><Badge variant={v.status === 'Delayed' ? 'danger' : v.status === 'Inbound' ? 'info' : 'default'}>{v.status}</Badge></td>
                    <td className="px-4 py-3 text-gray-300">{v.eta ? new Date(v.eta).toLocaleString([], {month:'short', day:'numeric', hour: '2-digit', minute:'2-digit'}) : '-'}</td>
                    <td className="px-4 py-3 text-gray-300">{v.etd ? new Date(v.etd).toLocaleString([], {month:'short', day:'numeric', hour: '2-digit', minute:'2-digit'}) : '-'}</td>
                    <td className="px-4 py-3 text-gray-300">{v.scheduledBerthId || '-'}</td>
                    <td className="px-4 py-3 text-gray-300">{v.destination}</td>
                    <td className="px-4 py-3"><Badge variant={priorityVariant(v.priority)}>{v.priority}</Badge></td>
                    <td className="px-4 py-3 text-gray-300">{v.handlingDurationHours}h</td>
                    <td className="px-4 py-3"><Badge variant={riskVariant(v.risk.level)}>{v.risk.level}</Badge></td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={(e) => { e.stopPropagation(); setSelectedVessel(v); }} className="text-primary hover:text-blue-400 p-1">
                        <Info className="w-5 h-5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Detail Modal */}
      <Modal isOpen={!!selectedVessel} onClose={() => setSelectedVessel(null)} title="Vessel Operations Detail">
        {selectedVessel && (
          <div className="space-y-6">
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-1">Identity</h4>
                <div className="text-lg font-bold text-white">{selectedVessel.name}</div>
                <div className="text-sm text-gray-400">{selectedVessel.id} • {selectedVessel.type} • {selectedVessel.cargoSize.toLocaleString()} capacity</div>
              </div>
              <div className="text-right">
                <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-1">Status</h4>
                <div className="mb-1"><Badge variant={selectedVessel.status === 'Delayed' ? 'danger' : 'info'}>{selectedVessel.status}</Badge></div>
                <div><Badge variant={priorityVariant(selectedVessel.priority)}>{selectedVessel.priority} Priority</Badge></div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 bg-surface-hover p-4 rounded border border-border">
              <div>
                <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Schedule</h4>
                <div className="text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-gray-400">ETA:</span> <span className="text-white">{new Date(selectedVessel.eta).toLocaleString()}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">ETD:</span> <span className="text-white">{new Date(selectedVessel.etd).toLocaleString()}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Destination:</span> <span className="text-white">{selectedVessel.destination}</span></div>
                </div>
              </div>
              <div>
                <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Operations</h4>
                <div className="text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-gray-400">Berth:</span> <span className="text-white">{selectedVessel.scheduledBerthId || 'Unassigned'}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Handling:</span> <span className="text-white">{selectedVessel.handlingDurationHours}h</span></div>
                </div>
              </div>
            </div>

            {/* Timeline */}
            <div>
              <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Operational Timeline</h4>
              <div className="relative border-l-2 border-border ml-2 space-y-4 pb-1">
                <div className="relative pl-6">
                  <div className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 border-surface ${selectedVessel.status === 'Inbound' ? 'bg-primary' : 'bg-gray-500'}`}></div>
                  <div className="text-sm font-medium text-white">Arrival & Anchorage</div>
                  <div className="text-xs text-gray-400">ETA: {new Date(selectedVessel.eta).toLocaleString()}</div>
                </div>
                <div className="relative pl-6">
                  <div className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 border-surface ${['Moored', 'Departing', 'Delayed'].includes(selectedVessel.status) ? 'bg-primary' : 'bg-gray-500'}`}></div>
                  <div className="text-sm font-medium text-white">Berth Assignment & Cargo Ops</div>
                  <div className="text-xs text-gray-400">Berth: {selectedVessel.scheduledBerthId || 'Pending'} ({selectedVessel.handlingDurationHours}h duration)</div>
                </div>
                <div className="relative pl-6">
                  <div className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 border-surface ${selectedVessel.status === 'Departing' ? 'bg-primary' : 'bg-gray-500'}`}></div>
                  <div className="text-sm font-medium text-white">Expected Departure</div>
                  <div className="text-xs text-gray-400">ETD: {new Date(selectedVessel.etd).toLocaleString()}</div>
                </div>
              </div>
            </div>

            {/* Risk Explanation */}
            {(selectedVessel.risk.level === 'HIGH' || selectedVessel.risk.level === 'CRITICAL') && (
              <div className="bg-red-500/10 border border-red-500/20 p-4 rounded">
                <div className="flex items-center space-x-2 mb-2">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                  <h4 className="text-sm font-bold text-red-400">Why is this vessel at risk?</h4>
                </div>
                <ul className="list-disc pl-5 text-sm text-red-200/80 space-y-1">
                  {selectedVessel.risk.factors.length > 0 ? (
                    selectedVessel.risk.factors.map((f, i) => <li key={i}>{f}</li>)
                  ) : (
                    <li>Berth congestion or crane unavailability expected during scheduled window.</li>
                  )}
                </ul>
              </div>
            )}

            {/* Actions */}
            <div className="flex space-x-3 pt-2 border-t border-border">
              <button 
                onClick={() => { setSelectedVessel(null); navigate('/berths-cranes'); }} 
                className="btn btn-primary flex-1 text-sm"
              >
                View Berth
              </button>
              <button 
                onClick={() => setRoutingVessel(selectedVessel)} 
                className="btn btn-secondary flex-1 text-sm"
                disabled={selectedVessel.status !== 'Inbound' && selectedVessel.status !== 'Anchored' && selectedVessel.status !== 'Delayed'}
              >
                Review Route
              </button>
            </div>
            
          </div>
        )}
      </Modal>

      {/* Routing Recommendation Modal */}
      <Modal isOpen={!!routingVessel} onClose={() => setRoutingVessel(null)} title="Route Recommendation">
        {routingVessel && routeRecommendation && (
          <RouteRecommendationPanel recommendation={routeRecommendation} routingVessel={routingVessel} />
        )}
      </Modal>

    </div>
  );
}
