import React, { useState, useRef, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Ship, Anchor, Calendar, Activity, BarChart2, Cpu, Settings, Bell, Zap, AlertTriangle } from 'lucide-react';
import { useStore } from '../../shared/store';
import { generateAlertsAndRecs } from '../../shared/services/congestionEngine';
import { Badge } from '../components/ui/Badge';

const NAV_ITEMS = [
  { path: '/command-center', label: 'Command Center', icon: LayoutDashboard },
  { path: '/vessels', label: 'Vessels', icon: Ship },
  { path: '/berths-cranes', label: 'Berths & Cranes', icon: Anchor },
  { path: '/72-hour-plan', label: '72-Hour Plan', icon: Calendar },
  { path: '/what-if', label: 'What-If Simulator', icon: Activity },
  { path: '/analytics', label: 'Analytics', icon: BarChart2 },
  { path: '/copilot', label: 'Operations Copilot', icon: Cpu },
  { path: '/settings', label: 'Settings', icon: Settings },
];

export const MainLayout: React.FC = () => {
  const location = useLocation();
  const { vessels, berths, cranes } = useStore();
  const [showNotifications, setShowNotifications] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const { alerts } = generateAlertsAndRecs(berths, vessels, cranes);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="flex h-screen bg-background text-gray-200">
      <aside className="w-64 bg-surface border-r border-border flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <Zap className="w-6 h-6 text-primary mr-2" />
          <span className="font-bold text-lg text-white uppercase tracking-wider">BoB AI Ops</span>
        </div>
        <nav className="flex-1 py-4">
          {NAV_ITEMS.map((item) => (
            <Link key={item.path} to={item.path} className={`flex items-center px-6 py-3 text-sm transition-colors ${location.pathname.startsWith(item.path) || (location.pathname === '/' && item.path === '/command-center') ? 'bg-surface-hover text-primary border-r-2 border-primary' : 'text-gray-400 hover:bg-surface-hover hover:text-gray-200'}`}>
              <item.icon className="w-5 h-5 mr-3" />
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-surface border-b border-border flex items-center justify-between px-8 z-20">
          <h2 className="text-xl font-semibold text-white capitalize">{location.pathname === '/' ? 'Command Center' : location.pathname.split('/')[1]?.replace(/-/g, ' ') || 'Dashboard'}</h2>
          <div className="flex items-center space-x-6 relative">
            <div className="flex items-center text-sm text-gray-400">
              <span className="w-2 h-2 rounded-full bg-success mr-2"></span>
              Operational Data: Simulated
            </div>
            
            <div ref={notifRef} className="relative">
              <button 
                onClick={() => setShowNotifications(!showNotifications)}
                className={`text-gray-400 hover:text-white transition-colors relative ${showNotifications ? 'text-white' : ''}`}
              >
                <Bell className="w-5 h-5" />
                {alerts.length > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-danger border-2 border-surface"></span>
                  </span>
                )}
              </button>
              
              {showNotifications && (
                <div className="absolute right-0 mt-2 w-80 bg-surface border border-border rounded-lg shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100 z-50">
                  <div className="flex items-center justify-between p-3 border-b border-border bg-surface-hover">
                    <h3 className="text-sm font-bold text-white">Notifications</h3>
                    <Badge variant="default" className="text-[10px]">{alerts.length}</Badge>
                  </div>
                  <div className="max-h-96 overflow-y-auto p-2 custom-scrollbar">
                    {alerts.length === 0 ? (
                      <div className="text-sm text-gray-500 p-4 text-center">No active alerts.</div>
                    ) : (
                      <div className="space-y-1">
                        {alerts.map((a, i) => (
                          <div key={i} className="flex items-start space-x-3 p-3 rounded hover:bg-surface-hover transition-colors">
                            {a.type === 'CRITICAL' ? <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" /> : <Activity className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />}
                            <div>
                              <div className="text-sm font-medium text-white mb-0.5">{a.message}</div>
                              <div className="text-xs text-gray-400">
                                {new Date(a.timestamp).toLocaleString([], {month:'short', day:'numeric', hour: '2-digit', minute:'2-digit'})}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-8 z-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
