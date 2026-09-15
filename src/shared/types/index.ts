export type VesselType = 'Container' | 'Bulk' | 'Tanker' | 'RoRo';
export type VesselStatus = 'Inbound' | 'Moored' | 'Anchored' | 'Departing' | 'Delayed';
export type Priority = 'Low' | 'Normal' | 'High' | 'Critical';

export interface Vessel {
  id: string;
  name: string;
  type: VesselType;
  status: VesselStatus;
  eta: string;
  etd: string;
  priority: Priority;
  scheduledBerthId?: string | null;
  handlingDurationHours: number;
  cargoSize: number; // TEUs or Tons
  destination: string;
}

export type BerthStatus = 'Occupied' | 'Available' | 'Maintenance';

export interface Berth {
  id: string;
  name: string;
  status: BerthStatus;
  capacity: number; // max TEUs or size
  expectedRelease: string | null;
  currentVesselId: string | null;
}

export type CraneStatus = 'Active' | 'Idle' | 'Maintenance' | 'Fault';

export interface Crane {
  id: string;
  name: string;
  status: CraneStatus;
  assignedBerthId: string | null;
  efficiency: number; // moves per hour
}

export type AlertType = 'CRITICAL' | 'WARNING' | 'INFO';

export interface Alert {
  id: string;
  type: AlertType;
  message: string;
  timestamp: string;
  relatedEntityId?: string; // berth or vessel ID
}

export interface Recommendation {
  id: string;
  action: string;
  reason: string;
  expectedImpact: string;
}

export interface RiskProfile {
  score: number; // 0 - 100
  level: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  timeToCongestionHours: number | null;
  factors: string[];
}

export interface TimelineEvent {
  id: string;
  timestamp: string;
  timeOffsetHours: number;
  description: string;
  type: 'arrival' | 'departure' | 'maintenance' | 'congestion_risk' | 'info';
}

export interface Route { id: string; }
export interface Assignment { id: string; }
export interface OperationsPlan { id: string; }
export interface SimulationScenario { id: string; }
export interface PortSettings { id: string; }
