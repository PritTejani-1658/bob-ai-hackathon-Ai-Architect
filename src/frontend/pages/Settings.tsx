import { useStore } from '../../shared/store';
import { Card } from '../components/ui/Card';
import { Settings as SettingsIcon, RefreshCw, AlertTriangle } from 'lucide-react';

export default function Settings() {
  const { resetState } = useStore();

  const handleReset = () => {
    if (confirm('Are you sure you want to reset all operational data back to the baseline simulation state? This will clear all optimisations and what-if scenarios.')) {
      resetState();
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight flex items-center space-x-3">
            <SettingsIcon className="w-8 h-8 text-primary" />
            <span>Settings</span>
          </h1>
          <p className="text-gray-400 mt-2">Application configuration and data management</p>
        </div>
      </div>

      <Card title="Data Source">
        <div className="flex items-start space-x-4 mb-6">
          <div className="bg-surface-hover p-4 rounded border border-border flex-1">
            <h3 className="text-white font-bold mb-1">Current Data Source</h3>
            <p className="text-sm text-gray-400 mb-3">The application is currently running on a deterministic synthetic dataset for the IBM BoB Hackathon demonstration.</p>
            <div className="inline-flex items-center space-x-2 bg-success/10 text-success px-3 py-1.5 rounded-full text-xs font-bold border border-success/20">
              <span className="w-2 h-2 rounded-full bg-success"></span>
              <span>Local Simulated Data</span>
            </div>
          </div>
        </div>

        <div className="border-t border-border pt-6">
          <h3 className="text-white font-bold flex items-center space-x-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-warning" />
            <span>Reset Simulation State</span>
          </h3>
          <p className="text-sm text-gray-400 mb-4">
            If the current data state has become too heavily modified through optimisations or what-if scenarios, you can reset it to the original baseline mock data.
          </p>
          <button onClick={handleReset} className="btn btn-secondary flex items-center space-x-2">
            <RefreshCw className="w-4 h-4" />
            <span>Reset to Baseline</span>
          </button>
        </div>
      </Card>
      
      <Card title="Engine Configuration">
        <p className="text-sm text-gray-400 italic">
          Routing and Optimisation engine thresholds are hardcoded for the current POC.
        </p>
      </Card>
    </div>
  );
}
