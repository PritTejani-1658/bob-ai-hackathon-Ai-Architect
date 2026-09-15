import { create } from 'zustand';
import type { Vessel, Berth, Crane, Alert, Recommendation } from '../types';
import { mockVessels, mockBerths, mockCranes } from '../data/mockData';

interface AppState {
  vessels: Vessel[];
  berths: Berth[];
  cranes: Crane[];
  alerts: Alert[];
  recommendations: Recommendation[];
  updateVessel: (id: string, data: Partial<Vessel>) => void;
  updateBerth: (id: string, data: Partial<Berth>) => void;
  updateCrane: (id: string, data: Partial<Crane>) => void;
  addAlert: (alert: Alert) => void;
  clearAlert: (id: string) => void;
  setRecommendations: (recs: Recommendation[]) => void;
  resetState: () => void;
}

export const useStore = create<AppState>((set) => ({
  vessels: [...mockVessels],
  berths: [...mockBerths],
  cranes: [...mockCranes],
  alerts: [],
  recommendations: [],
  updateVessel: (id, data) => set((state) => ({
    vessels: state.vessels.map(v => v.id === id ? { ...v, ...data } : v)
  })),
  updateBerth: (id, data) => set((state) => ({
    berths: state.berths.map(b => b.id === id ? { ...b, ...data } : b)
  })),
  updateCrane: (id, data) => set((state) => ({
    cranes: state.cranes.map(c => c.id === id ? { ...c, ...data } : c)
  })),
  addAlert: (alert) => set((state) => ({
    alerts: [alert, ...state.alerts.filter(a => a.id !== alert.id)]
  })),
  clearAlert: (id) => set((state) => ({
    alerts: state.alerts.filter(a => a.id !== id)
  })),
  setRecommendations: (recs) => set(() => ({
    recommendations: recs
  })),
  resetState: () => set({
    vessels: [...mockVessels],
    berths: [...mockBerths],
    cranes: [...mockCranes],
    alerts: [],
    recommendations: []
  }),
}));
