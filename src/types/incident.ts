export type IncidentSource = 'LoRa' | 'SMS' | 'App';

export type IncidentPriority = 'Critical' | 'High' | 'Medium' | 'Low';

export type IncidentStatus = 'pending' | 'validated' | 'dispatched' | 'completed';

export interface Incident {
  id: number;
  source: IncidentSource;
  device_id?: string;
  incident_code?: string;
  incident_type: string;
  latitude: number;
  longitude: number;
  gps_locked?: boolean;
  rssi?: number;
  snr?: number;
  priority: IncidentPriority;
  status: IncidentStatus;
  responder_id: number | null;
  validated_by: number | null;
  created_at: string;
}

export interface IncidentsResponse {
  success: boolean;
  incidents: Incident[];
}

export interface IncidentResponse {
  success: boolean;
  incident: Incident;
  message?: string;
}

export interface DispatchedEvent {
  incident_id: number;
  responder_id: number;
}
