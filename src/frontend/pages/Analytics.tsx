import { useStore } from '../../shared/store';
import { Card } from '../components/ui/Card';
import { calculateBerthRisk } from '../../shared/services/congestionEngine';
import { getBerthUtilisation } from '../../shared/services/resourceConflictEngine';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';
import { BarChart2 } from 'lucide-react';

export default function Analytics() {
  const { vessels, berths, cranes } = useStore();

  const berthData = berths.map(b => {
    const risk = calculateBerthRisk(b, vessels, cranes);
    return {
      name: b.name,
      utilisation: getBerthUtilisation(b, vessels),
      riskScore: risk.score,
      riskLevel: risk.level,
    };
  });

  const vesselStatusCount = {
    Inbound: 0, Anchored: 0, Moored: 0, Departing: 0, Delayed: 0
  };
  vessels.forEach(v => { vesselStatusCount[v.status]++; });
  const pieData = Object.entries(vesselStatusCount).map(([name, value]) => ({ name, value })).filter(d => d.value > 0);
  const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

  return (
    <div className="space-y-6 pb-12">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight flex items-center space-x-3">
            <BarChart2 className="w-8 h-8 text-primary" />
            <span>Port Analytics</span>
          </h1>
          <p className="text-gray-400 mt-2">Real-time simulated operational metrics</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Berth Utilisation & Risk" className="h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={berthData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
              <XAxis dataKey="name" stroke="#4B5563" />
              <YAxis stroke="#4B5563" />
              <Tooltip cursor={{ fill: '#1E2738' }} contentStyle={{ backgroundColor: '#151C2C', borderColor: '#2A3441', color: '#fff' }} />
              <Bar dataKey="utilisation" name="Utilisation %" radius={[4, 4, 0, 0]}>
                {berthData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.riskLevel === 'CRITICAL' ? '#EF4444' : entry.riskLevel === 'HIGH' ? '#F59E0B' : '#3B82F6'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Vessel Status Distribution" className="h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={120} label={({name, value}) => `${name}: ${value}`}>
                {pieData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: '#151C2C', borderColor: '#2A3441', color: '#fff' }} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}
