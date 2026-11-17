// EOCcomponents/DispatchResponders.tsx
import React, { useState, useEffect } from 'react';
import '../css/DispatchResponders.css';
import { firestore } from '../firebase';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  doc, 
  updateDoc,
  serverTimestamp,
  where,
  getDocs,
  setDoc,
} from 'firebase/firestore';
import { sendPushToUser } from '../services/sendPushNotification';

// ============================================================
// ✅ HELPER: Log any activity to the dashboard feed
// ============================================================
const logActivity = async (payload: {
  icon: string;
  tone: string;
  title: string;
  meta: string;
}) => {
  try {
    await setDoc(doc(collection(firestore, 'activity_feed')), {
      type: 'activity',
      icon: payload.icon,
      tone: payload.tone,
      title: payload.title,
      meta: payload.meta,
      time: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Failed to log activity:', err);
  }
};

// ✅ Normalize incident type for clean dashboard display
function normalizeIncidentType(raw?: string, specific?: string): string {
  if (!raw && !specific) return 'Incident';
  const s = String(raw || '').toLowerCase();
  if (s.includes('fire')) return 'Fire';
  if (s.includes('flood')) return 'Flood';
  if (s.includes('typhoon') || s.includes('storm') || s.includes('bagyo')) return 'Typhoon';
  if (s.includes('earthquake') || s.includes('quake') || s.includes('lindol')) return 'Earthquake';
  if (s.includes('landslide') || s.includes('mudslide')) return 'Landslide';
  if (s.includes('accident') || s.includes('vehic') || s.includes('colli') || s.includes('bangga')) return 'Accident';
  if (s.includes('medic') || s.includes('health') || s.includes('injur') || s.includes('sakit')) return 'Medical';
  if (s.includes('crime') || s.includes('theft') || s.includes('robber') || s.includes('holdap')) return 'Crime';
  if (s.includes('other')) {
    if (specific && String(specific).trim()) return `Others – ${String(specific).trim()}`;
    return 'Others';
  }
  const cleaned = String(raw || '')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/^[^\w]+/g, '')
    .trim();
  return cleaned || 'Incident';
}

interface Incident {
  id: string;
  type: string;
  specificType?: string | null;
  location: string;
  date: string;
  time: string;
  status: string;
  description: string;
  verifiedBy: string;
  forwardedBy: string;
  forwardedTime: string;
  photos?: string[];
  photoUrl?: string | null;
  hasPhoto?: boolean;
  lat?: number;
  lng?: number;
  address?: string;
  reporter?: {
    fullName: string;
    phoneNumber: string;
  };
  source?: string;
  firebaseId?: string;
  createdAt?: any;
  progressStep?: number;
  isDispatched?: boolean; // ✅ NEW: true once the incident was really dispatched
  casualties?: {
    injured: number;
    fatalities: number;
    trapped: number;
  };
}

interface Unit {
  id: string;
  name: string;
  code: string;
  type: string;
  capability: string;
  eta: string;
  available: boolean;
  userId?: string;
  role?: string;
  specialization?: string;
  station?: string;
  profile?: string;
  phone?: string;
}

interface DispatchRespondersProps {
  onDispatchComplete?: (incident: Incident) => void;
  onNavigateToDashboard?: () => void;
}

const getUnitTypeFromRole = (role: string): string => {
  const roleMap: { [key: string]: string } = {
    'Fire Responder': 'Fire Truck',
    'Police Officer': 'Patrol Unit',
    'Medical Staff': 'Ambulance',
    'Rescue Team': 'Rescue Unit',
    'Paramedic': 'Ambulance',
    'Volunteer': 'Rescue Unit',
    'EOC Personnel': 'EOC Unit',
    'EOC Dispatcher': 'EOC Unit',
    'EOC Manager': 'EOC Unit',
    'EOC Supervisor': 'EOC Unit',
    'EOC Coordinator': 'EOC Unit',
    'Emergency Responder': 'Response Unit',
    'Driver / Operator': 'Response Unit',
    'Team Leader': 'Response Unit',
    'Rescue Officer': 'Rescue Unit',
    'Search & Rescue Specialist': 'Rescue Unit',
    'Medical Responder': 'Ambulance',
    'Communications Officer': 'EOC Unit',
    'Disaster Operations Officer': 'EOC Unit',
  };
  return roleMap[role] || 'Response Unit';
};

const getCapabilityFromRole = (role: string): string => {
  const capabilityMap: { [key: string]: string } = {
    'Fire Responder': 'Fire Suppression',
    'Police Officer': 'Traffic Control & Security',
    'Medical Staff': 'Medical Support',
    'Rescue Team': 'Search & Rescue',
    'Paramedic': 'Emergency Medical Response',
    'Volunteer': 'General Response',
    'EOC Personnel': 'Emergency Coordination',
    'EOC Dispatcher': 'Emergency Dispatch',
    'EOC Manager': 'Emergency Management',
    'EOC Supervisor': 'Emergency Supervision',
    'EOC Coordinator': 'Emergency Coordination',
    'Emergency Responder': 'Emergency Response',
    'Driver / Operator': 'Vehicle Operation',
    'Team Leader': 'Team Leadership',
    'Rescue Officer': 'Search & Rescue',
    'Search & Rescue Specialist': 'Search & Rescue',
    'Medical Responder': 'Emergency Medical Response',
    'Communications Officer': 'Communications',
    'Disaster Operations Officer': 'Disaster Operations',
  };
  return capabilityMap[role] || 'Emergency Response';
};

const getUnitCode = (_name: string, role: string): string => {
  const prefixMap: { [key: string]: string } = {
    'Fire Responder': 'BFP',
    'Police Officer': 'PNP',
    'Medical Staff': 'MED',
    'Rescue Team': 'RSC',
    'Paramedic': 'PAR',
    'Volunteer': 'VOL',
    'EOC Personnel': 'EOC',
    'EOC Dispatcher': 'DSP',
    'EOC Manager': 'MGR',
    'EOC Supervisor': 'SUP',
    'EOC Coordinator': 'COR',
    'Emergency Responder': 'ERS',
    'Driver / Operator': 'DRV',
    'Team Leader': 'TLD',
    'Rescue Officer': 'ROF',
    'Search & Rescue Specialist': 'SRS',
    'Medical Responder': 'MRS',
    'Communications Officer': 'COM',
    'Disaster Operations Officer': 'DOO',
  };
  const prefix = prefixMap[role] || 'RES';
  const randomNum = Math.floor(Math.random() * 100).toString().padStart(3, '0');
  return `${prefix}-${randomNum}`;
};

const getETA = (role: string): string => {
  const etaMap: { [key: string]: string } = {
    'Fire Responder': '6 mins',
    'Police Officer': '8 mins',
    'Medical Staff': '5 mins',
    'Rescue Team': '8 mins',
    'Paramedic': '5 mins',
    'Volunteer': '10 mins',
    'EOC Personnel': '5 mins',
    'EOC Dispatcher': '5 mins',
    'EOC Manager': '5 mins',
    'EOC Supervisor': '5 mins',
    'EOC Coordinator': '5 mins',
  };
  return etaMap[role] || '8 mins';
};

const getSeverity = (type: string): string => {
  const typeLower = type.toLowerCase();
  if (typeLower.includes('fire') || typeLower.includes('emergency')) return 'emergency';
  if (typeLower.includes('accident') || typeLower.includes('vehicle')) return 'high';
  if (typeLower.includes('medical')) return 'high';
  if (typeLower.includes('flood') || typeLower.includes('tree')) return 'medium';
  return 'medium';
};

// ============================================================
// ✅ UNIT FILTER CONFIG
//    - All Units
//    - Category Specific  → roles based on the incident type
//    - Specific Response Unit → roles based on a dropdown choice
// ============================================================
type UnitFilterMode = 'all' | 'specific';

// Specific Response Unit → roles based on the incident type of the selected incident

// ✅ Vehicle Type → responder roles (used ONLY when the incident came from a LoRa Device)
const VEHICLE_TYPE_ROLES: Record<string, string[]> = {
  Ambulance: ['Medical Responder', 'Driver / Operator', 'Team Leader'],
  Firetruck: ['Emergency Responder', 'Driver / Operator', 'Team Leader'],
  'Flood Rescue': ['Rescue Officer', 'Search & Rescue Specialist', 'Driver / Operator', 'Team Leader'],
  Police: ['Emergency Responder', 'Team Leader', 'Driver / Operator', 'Communications Officer'],
  'Road Assistance': ['Emergency Responder', 'Team Leader', 'Rescue Officer', 'Driver / Operator'],
};

// Map the incident's type to a key in INCIDENT_TYPE_ROLES.
// For "Other", the specific type the reporter typed is used to find the match;
// if nothing matches it stays "Other".
const getIncidentTypeKey = (type?: string, specific?: string | null): string => {
  const s = `${type || ''} ${specific || ''}`.toLowerCase();
  // more specific names first (Flood Rescue before Flood, Firetruck before Fire)
  if (s.includes('flood rescue')) return 'Flood Rescue';
  if (s.includes('firetruck') || s.includes('fire truck')) return 'Firetruck';
  if (s.includes('road assistance') || s.includes('road')) return 'Road Assistance';
  if (s.includes('ambulance')) return 'Ambulance';
  if (s.includes('police')) return 'Police';
  if (s.includes('fire')) return 'Fire';
  if (s.includes('flood')) return 'Flood';
  if (s.includes('crime') || s.includes('theft') || s.includes('robber') || s.includes('holdap')) return 'Crime';
  if (s.includes('medic') || s.includes('health') || s.includes('injur') || s.includes('sakit')) return 'Medical';
  if (s.includes('accident') || s.includes('vehic') || s.includes('colli') || s.includes('bangga')) return 'Accident';
  return 'Other';
};

// True when the unit's role (or specialization) is in the list of wanted roles
const unitMatchesRoles = (unit: Unit, roles: string[]): boolean => {
  const wanted = roles.map((r) => r.toLowerCase().trim());
  const role = (unit.role || '').toLowerCase().trim();
  const spec = (unit.specialization || '').toLowerCase().trim();
  return wanted.includes(role) || (spec !== '' && wanted.includes(spec));
};

// ============================================================
// ✅ Incident Type → Assigned Unit Mapping (info popup only)
//    Shown when "Specific Response Unit" is selected.
// ============================================================
interface UnitInfo {
  title: string;
  assignedUnit: string;
  teams: string[];
  roles: string[];
  capabilities: string[];
}

const INCIDENT_UNIT_INFO: Record<string, UnitInfo> = {
  Fire: {
    title: 'Fire Emergency',
    assignedUnit: 'Response Unit',
    teams: ['Fire / Rescue Team'],
    roles: ['Emergency Responder', 'Team Leader', 'Driver / Operator', 'Rescue Officer'],
    capabilities: ['Fire Response', 'Search and Rescue', 'First Aid', 'Disaster Assessment'],
  },
  Medical: {
    title: 'Medical Emergency',
    assignedUnit: 'Ambulance Unit',
    teams: ['Medical Team'],
    roles: ['Medical Responder', 'Team Leader', 'Driver / Operator'],
    capabilities: ['First Aid', 'Medical Response', 'Emergency Transport'],
  },
  Flood: {
    title: 'Flood Emergency',
    assignedUnit: 'Rescue Unit',
    teams: ['Search & Rescue Team'],
    roles: ['Rescue Officer', 'Search & Rescue Specialist', 'Driver / Operator', 'Team Leader'],
    capabilities: ['Water Rescue', 'Search and Rescue', 'First Aid', 'Evacuation'],
  },
  Crime: {
    title: 'Security Emergency',
    assignedUnit: 'Patrol Unit',
    teams: ['Communications Team (for coordination)'],
    roles: ['Emergency Responder', 'Team Leader', 'Driver / Operator', 'Communications Officer'],
    capabilities: ['Communications', 'Disaster Assessment'],
  },
  Accident: {
    title: 'Road Accident',
    assignedUnit: 'Ambulance Unit / Rescue Unit / Patrol Unit',
    teams: ['Medical Team', 'Rescue Team', 'Communications Team'],
    roles: ['Emergency Responder', 'Medical Responder', 'Rescue Officer', 'Driver / Operator', 'Team Leader'],
    capabilities: [
      'First Aid',
      'Medical Response',
      'Emergency Transport',
      'Search and Rescue',
      'Traffic coordination through the Patrol Unit',
    ],
  },
  Other: {
    title: 'General Emergency',
    assignedUnit: 'Based on incident assessment',
    teams: ['Rescue Team', 'Medical Team', 'Evacuation Team', 'Logistics Team', 'Communications Team'],
    roles: ['Emergency Responder', 'Team Leader', 'Rescue Officer', 'Disaster Operations Officer'],
    capabilities: ['Search and Rescue', 'First Aid', 'Evacuation', 'Disaster Assessment', 'Communications'],
  },
};

// Map existing keys (Police, Ambulance, Firetruck...) to the 6 categories
const getUnitInfoKey = (key: string): string => {
  switch (key) {
    case 'Firetruck': return 'Fire';
    case 'Ambulance': return 'Medical';
    case 'Flood Rescue': return 'Flood';
    case 'Police': return 'Crime';
    case 'Road Assistance': return 'Accident';
    default: return INCIDENT_UNIT_INFO[key] ? key : 'Other';
  }
};

// Unit types (Unit.type) that count as the "Assigned Unit" for each incident type
const ASSIGNED_UNIT_TYPES: Record<string, string[]> = {
  Fire: ['Response Unit'],
  Medical: ['Ambulance'],
  Flood: ['Rescue Unit'],
  Crime: ['Patrol Unit'],
  Accident: ['Ambulance', 'Rescue Unit', 'Patrol Unit'],
  Other: [],
};

// ✅ A unit is listed when its role matches the Responder Roles of the
//    incident type OR it is the Assigned Unit type (e.g. Crime → Patrol Unit)
const unitMatchesIncidentMapping = (unit: Unit, incidentTypeKey: string): boolean => {
  const infoKey = getUnitInfoKey(incidentTypeKey);
  const info = INCIDENT_UNIT_INFO[infoKey];
  if (!info) return false;
  const assignedTypes = (ASSIGNED_UNIT_TYPES[infoKey] || []).map((t) => t.toLowerCase());
  return (
    unitMatchesRoles(unit, info.roles) ||
    assignedTypes.includes((unit.type || '').toLowerCase())
  );
};

// ============================================================
// ✅ HELPER: Fetch IDs of responders who are currently busy.
//    Busy = dispatched / enroute / on_scene on an incident that
//    does NOT yet have a final report. Once the responder submits
//    the final report for THAT incident, they are free again.
//    Returns null if the lookup failed (so the UI keeps its
//    previous state instead of wrongly showing everyone).
// ============================================================
const getBusyResponderIds = async (): Promise<Set<string> | null> => {
  const busyIds = new Set<string>();
  const db = firestore;

  try {
    // 1️⃣ Incidents that already have a final report (= finished)
    const finishedIncidents = new Set<string>();
    const finalSnap = await getDocs(collection(db, 'final_reports'));
    finalSnap.forEach((d) => {
      finishedIncidents.add(d.id);
      const data = d.data();
      if (data.incidentId) finishedIncidents.add(String(data.incidentId));
    });

    // 2️⃣ responder_notifications with an active status
    const notificationsRef = collection(db, 'responder_notifications');
    for (const status of ['dispatched', 'enroute', 'on_scene']) {
      const snap = await getDocs(query(notificationsRef, where('status', '==', status)));
      snap.forEach((d) => {
        const data = d.data();
        const uid = data.userId || data.responderUid;
        const incidentId = data.incidentId ? String(data.incidentId) : '';
        if (uid && !finishedIncidents.has(incidentId)) busyIds.add(uid);
      });
    }

    // 3️⃣ responder_tracking with an active status
    const trackingRef = collection(db, 'responder_tracking');
    for (const status of ['enroute', 'on_scene']) {
      const snap = await getDocs(query(trackingRef, where('status', '==', status)));
      snap.forEach((d) => {
        const data = d.data();
        const uid = data.responderId;
        const incidentId = String(data.incidentId || d.id);
        if (uid && !finishedIncidents.has(incidentId)) busyIds.add(uid);
      });
    }

    console.log('🔒 Busy responder IDs (excluded from available):', Array.from(busyIds));
    return busyIds;
  } catch (err) {
    console.error('Error fetching busy responders:', err);
    return null;
  }
};

const sendNotificationToResponder = async (incident: Incident, unit: Unit) => {
  try {
    console.log(`🔔 Sending notification to ${unit.name} (${unit.userId})`);
    
    const db = firestore;
    const notificationRef = collection(db, 'responder_notifications');
    
    const reporterName =
      incident.reporter?.fullName ||
      (incident as any).reporterName ||
      (incident as any).name ||
      null;

    const reporterPhone =
      incident.reporter?.phoneNumber ||
      (incident as any).reporterPhone ||
      (incident as any).phone ||
      null;
    
    const notificationData = {
      userId: unit.userId,
      incidentId: incident.id,
      type: incident.type || 'Unknown Incident',
      specificType: incident.specificType || null,
      location: incident.location || 'Unknown location',
      description: incident.description || 'No description',
      date: incident.date || new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      time: incident.time || new Date().toLocaleTimeString(),
      status: 'dispatched',
      severity: getSeverity(incident.type),
      photoUrl: incident.photoUrl || null,
      lat: incident.lat || 0,
      lng: incident.lng || 0,
      casualties: incident.casualties || {
        injured: 0,
        fatalities: 0,
        trapped: 0
      },

      reporterName: reporterName,
      reporterPhone: reporterPhone,
      reporter: incident.reporter || null,
      phone: reporterPhone,

      assignedBy: 'EOC Dispatch',
      dispatchedAt: new Date().toISOString(),
      createdAt: serverTimestamp(),
      read: false,
      isAssignedToUser: true,
      unitName: unit.name,
      unitCode: unit.code,
      unitType: unit.type,
      eta: unit.eta,
      responderUid: unit.userId
    };
    
    await setDoc(doc(notificationRef), notificationData);
    
    console.log(`✅ Notification sent to ${unit.name} (${unit.userId}) in responder_notifications`);
    return true;
  } catch (error) {
    console.error(`❌ Error sending notification to ${unit.name}:`, error);
    return false;
  }
};

const DispatchResponders: React.FC<DispatchRespondersProps> = ({ 
  onDispatchComplete,
  onNavigateToDashboard 
}) => {
  const [selectedIncident, setSelectedIncident] = useState<string>('');
  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);
  const [allIncidents, setAllIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isDispatching, setIsDispatching] = useState<boolean>(false);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loadingUnits, setLoadingUnits] = useState<boolean>(true);

  const [progressStep, setProgressStep] = useState<number>(1);

  // ✅ IDs of responders currently busy (dispatched / enroute / on_scene)
  const [busyResponderIds, setBusyResponderIds] = useState<Set<string>>(new Set());

  // ✅ NEW: Unit filter (All Units / Specific Response Unit)
  const [unitFilterMode, setUnitFilterMode] = useState<UnitFilterMode>('all');

  // ✅ NEW: Incidents dispatched during this session (instant UI update)
  const [dispatchedIds, setDispatchedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const loadUnits = async () => {
      setLoadingUnits(true);
      try {
        const db = firestore;
        const unitsList: Unit[] = [];
        
        const manageUsersRef = collection(db, 'manage_users');
        const manageUsersSnapshot = await getDocs(manageUsersRef);
        
        console.log(`📋 Found ${manageUsersSnapshot.size} users in manage_users`);
        
        manageUsersSnapshot.forEach((doc) => {
          const data = doc.data();
          
          if (data.status === 'active' && data.userType !== 'eoc') {
            const role = data.role || 'Responder';
            const name = data.name || 'Unknown Responder';
            
            unitsList.push({
              id: doc.id,
              name: name,
              code: getUnitCode(name, role),
              type: getUnitTypeFromRole(role),
              capability: getCapabilityFromRole(role),
              eta: getETA(role),
              available: true,
              userId: doc.id,
              role: role,
              specialization: data.specialization || '',
              station: data.station || data.department || '',
              profile: data.profile || '',
              phone: data.phone || '',
            });
          }
        });
        
        console.log(`✅ Loaded ${unitsList.length} active responders from manage_users`);
        setUnits(unitsList);
        
        if (unitsList.length === 0) {
          console.log('ℹ️ No active responders found in manage_users');
        }
        
      } catch (error) {
        console.error('❌ Error loading units from manage_users:', error);
        setUnits([]);
      } finally {
        setLoadingUnits(false);
      }
    };
    
    loadUnits();
  }, []);

  // ============================================================
  // ✅ Poll for busy responders so Available Units stays accurate
  //    - A responder disappears when dispatched
  //    - A responder reappears after submitting final report
  //      for the incident they were dispatched to
  // ============================================================
  useEffect(() => {
    let cancelled = false;

    const refreshBusy = async () => {
      const ids = await getBusyResponderIds();
      if (ids && !cancelled) {
        setBusyResponderIds(ids);
      }
    };

    refreshBusy();
    const interval = setInterval(refreshBusy, 15000); // every 15s

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const saveProgressToStorage = (incidentId: string, step: number) => {
    try {
      const progressData = localStorage.getItem('incidentProgress');
      let progressMap: Record<string, number> = {};
      if (progressData) {
        progressMap = JSON.parse(progressData);
      }
      progressMap[incidentId] = step;
      localStorage.setItem('incidentProgress', JSON.stringify(progressMap));
    } catch (e) {
      console.error('Error saving progress:', e);
    }
  };

  const loadProgressFromStorage = (incidentId: string): number => {
    try {
      const progressData = localStorage.getItem('incidentProgress');
      if (progressData) {
        const progressMap = JSON.parse(progressData);
        const savedStep = progressMap[incidentId];
        if (savedStep) {
          return savedStep;
        }
      }
    } catch (e) {
      console.error('Error loading progress:', e);
    }
    return 1;
  };

  const getStatusFromProgress = (step: number): string => {
    switch(step) {
      case 1: return 'Verified';
      case 2: return 'Units Selected';
      case 3: return 'Dispatched';
      case 4: return 'En Route';
      case 5: return 'Arrived';
      default: return 'Waiting';
    }
  };

  const updateProgress = (step: number) => {
    setProgressStep(step);
    if (selectedIncident) {
      saveProgressToStorage(selectedIncident, step);
      
      const newStatus = getStatusFromProgress(step);
      setAllIncidents(prev => {
        const updated = prev.map(incident => 
          incident.id === selectedIncident 
            ? { ...incident, status: newStatus, progressStep: step }
            : incident
        );
        return updated;
      });
    }
  };

  const getCasualtiesText = (casualties: any) => {
    if (!casualties) return 'No casualties reported';
    const parts = [];
    if (casualties.injured > 0) parts.push(`👨‍⚕️ ${casualties.injured} Injured`);
    if (casualties.fatalities > 0) parts.push(`💀 ${casualties.fatalities} Fatalities`);
    if (casualties.trapped > 0) parts.push(`🚧 ${casualties.trapped} Trapped`);
    return parts.length > 0 ? parts.join(' • ') : 'No casualties reported';
  };

  const getCasualtiesTotal = (casualties: any) => {
    if (!casualties) return 0;
    return (casualties.injured || 0) + (casualties.fatalities || 0) + (casualties.trapped || 0);
  };

  const updateIncidentReportsStatus = async (incidentId: string) => {
    try {
      console.log(`🔍 Updating incident_reports to 'dispatched' for: ${incidentId}`);
      
      const reportsRef = collection(firestore, 'incident_reports');
      const q = query(reportsRef, where('incidentId', '==', incidentId));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        const docRef = doc(firestore, 'incident_reports', querySnapshot.docs[0].id);
        await updateDoc(docRef, {
          status: 'dispatched',
          updatedAt: serverTimestamp(),
        });
        console.log(`✅ Updated incident_reports status to 'dispatched' for: ${incidentId}`);
        return true;
      } else {
        console.log(`⚠️ No incident_reports found for: ${incidentId}, creating one...`);
        
        const incident = allIncidents.find(i => i.id === incidentId);
        if (incident) {
          const newReportRef = doc(collection(firestore, 'incident_reports'));
          await setDoc(newReportRef, {
            incidentId: incidentId,
            incidentType: incident.type || 'Unknown',
            specificType: incident.specificType || null,
            location: {
              address: incident.address || incident.location || 'Unknown location',
              coordinates: {
                latitude: incident.lat || 14.5995,
                longitude: incident.lng || 120.9842,
              }
            },
            description: incident.description || 'No description provided',
            reporter: incident.reporter || { fullName: 'Unknown', phoneNumber: 'N/A' },
            casualties: incident.casualties || {
              injured: 0,
              fatalities: 0,
              trapped: 0
            },
            status: 'dispatched',
            submittedAt: incident.time || new Date().toISOString(),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            photoUrl: incident.photoUrl || null,
            hasPhoto: incident.hasPhoto || false,
            userId: 'eoc-user',
            isAnonymous: false,
            eta: '10-15 minutes',
            responder: 'BFP Response Team',
          });
          console.log(`✅ Created incident_reports with status 'dispatched' for: ${incidentId}`);
          return true;
        }
        return false;
      }
    } catch (error) {
      console.error('Error updating incident_reports:', error);
      return false;
    }
  };

  const updateIncidentQueueStatus = async (incidentId: string) => {
    try {
      console.log(`🔍 Updating incident_queue to 'dispatched' for: ${incidentId}`);
      
      const queueRef = collection(firestore, 'incident_queue');
      const q = query(queueRef, where('incidentId', '==', incidentId));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        const docRef = doc(firestore, 'incident_queue', querySnapshot.docs[0].id);
        await updateDoc(docRef, {
          status: 'dispatched',
          updatedAt: serverTimestamp(),
        });
        console.log(`✅ Updated incident_queue status to 'dispatched' for: ${incidentId}`);
        return true;
      } else {
        console.log(`⚠️ No incident_queue found for: ${incidentId}`);
        return false;
      }
    } catch (error) {
      console.error('Error updating incident_queue:', error);
      return false;
    }
  };

  const updateForwardedIncidentStatus = async (incidentId: string) => {
    try {
      console.log(`🔍 Updating forwarded_incidents status for: ${incidentId}`);
      
      const forwardedRef = collection(firestore, 'forwarded_incidents');
      const q = query(forwardedRef, where('id', '==', incidentId));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        const docRef = doc(firestore, 'forwarded_incidents', querySnapshot.docs[0].id);
        await updateDoc(docRef, {
          status: 'Dispatched',
          progressStep: 3,
          updatedAt: serverTimestamp(),
        });
        console.log(`✅ Updated forwarded_incidents status to 'Dispatched' with progressStep 3 for: ${incidentId}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error updating forwarded_incidents:', error);
      return false;
    }
  };

  const createMonitoringStatus = async (incident: Incident, selectedUnits: Unit[]) => {
    try {
      console.log(`🔍 Creating monitoring status for: ${incident.id}`);
      
      const monitoringRef = collection(firestore, 'monitoring_status');
      const docRef = doc(monitoringRef);
      
      const monitorStatus = 'dispatched';
      
      const getSeverityForMonitor = (type: string): string => {
        const typeLower = type.toLowerCase();
        if (typeLower.includes('fire') || typeLower.includes('emergency')) return 'emergency';
        if (typeLower.includes('accident') || typeLower.includes('vehicle')) return 'high';
        if (typeLower.includes('medical')) return 'high';
        if (typeLower.includes('flood') || typeLower.includes('tree')) return 'medium';
        return 'medium';
      };
      
      await setDoc(docRef, {
        id: incident.id,
        type: incident.type || 'Unknown',
        specificType: incident.specificType || null,
        title: incident.type || 'Incident',
        barangay: incident.location || 'Unknown location',
        responder: selectedUnits.map(u => u.name).join(', ') || 'Unassigned',
        status: monitorStatus,
        time: incident.time || new Date().toLocaleTimeString(),
        progress: 3,
        severity: getSeverityForMonitor(incident.type),
        awaitingReport: false,
        needsBackup: false,
        backupDispatched: false,
        date: incident.date || new Date().toLocaleDateString(),
        location: incident.location || 'Unknown location',
        fullDate: incident.date || new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        lat: incident.lat || 14.5995,
        lng: incident.lng || 120.9842,
        description: incident.description || 'No description',
        dispatchedUnits: selectedUnits.map(u => u.name).join(', '),
        dispatchTime: new Date().toLocaleString(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      
      console.log(`✅ Created monitoring status for: ${incident.id} with status 'dispatched'`);
      return true;
    } catch (error) {
      console.error('Error creating monitoring status:', error);
      return false;
    }
  };

  useEffect(() => {
    try {
      const forwardedRef = collection(firestore, 'forwarded_incidents');
      const q = query(forwardedRef, orderBy('createdAt', 'desc'));

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const incidents: Incident[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          let progressStep = data.progressStep || 1;
          const savedStep = loadProgressFromStorage(data.id || doc.id);
          if (savedStep > progressStep) {
            progressStep = savedStep;
          }
          
          incidents.push({
            id: data.id || doc.id,
            type: data.type || 'Unknown',
            specificType: data.specificType || null,
            location: data.location || 'Unknown location',
            date: data.date || new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
            time: data.time || new Date().toLocaleTimeString(),
            status: getStatusFromProgress(progressStep),
            description: data.description || 'No description',
            verifiedBy: data.verifiedBy || 'EOC Intake Officer',
            forwardedBy: data.forwardedBy || 'EOC Intake Officer',
            forwardedTime: data.forwardedTime || new Date().toLocaleString(),
            photos: data.photos || [],
            photoUrl: data.photoUrl || null,
            hasPhoto: data.hasPhoto || false,
            lat: data.lat || 0,
            lng: data.lng || 0,
            address: data.address || '',
            reporter: data.reporter || { fullName: 'Unknown', phoneNumber: 'N/A' },
            source: data.source || 'Mobile App',
            firebaseId: doc.id,
            createdAt: data.createdAt,
            progressStep: progressStep,
            // ✅ Only true when Firestore status says it was really dispatched
            isDispatched: ['dispatched', 'en route', 'arrived'].includes(
              String(data.status || '').toLowerCase()
            ),
            casualties: data.casualties || {
              injured: 0,
              fatalities: 0,
              trapped: 0
            },
          });
        });
        
        console.log('📥 Loaded incidents from Firebase:', incidents.length);
        
        setAllIncidents(incidents);
        setLoading(false);
        if (incidents.length > 0 && !selectedIncident) {
          setSelectedIncident(incidents[0].id);
          const savedProgress = loadProgressFromStorage(incidents[0].id);
          setProgressStep(savedProgress);
        }
      }, (error) => {
        console.error('❌ Error listening to forwarded incidents:', error);
        setLoading(false);
      });

      return () => unsubscribe();
    } catch (error) {
      console.error('❌ Firebase not available:', error);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedIncident) {
      const savedProgress = loadProgressFromStorage(selectedIncident);
      setProgressStep(savedProgress);
      
      setAllIncidents(prev => 
        prev.map(incident => 
          incident.id === selectedIncident 
            ? { ...incident, status: getStatusFromProgress(savedProgress), progressStep: savedProgress }
            : incident
        )
      );
      
      const unitsKey = `selectedUnits_${selectedIncident}`;
      const savedUnits = localStorage.getItem(unitsKey);
      if (savedUnits) {
        try {
          const parsedUnits = JSON.parse(savedUnits);
          setSelectedUnits(parsedUnits);
        } catch (e) {
          console.error('Error loading saved units:', e);
        }
      } else {
        setSelectedUnits([]);
      }
      
      console.log(`📥 Loaded progress for incident ${selectedIncident}: step ${savedProgress}`);
    }
  }, [selectedIncident]);

  useEffect(() => {
    if (selectedIncident) {
      const unitsKey = `selectedUnits_${selectedIncident}`;
      localStorage.setItem(unitsKey, JSON.stringify(selectedUnits));
    }
  }, [selectedUnits, selectedIncident]);

  const selectedIncidentData = allIncidents.find(i => i.id === selectedIncident);

  // ✅ True when this incident was already dispatched (locks units + button)
  const isAlreadyDispatched =
    !!selectedIncidentData &&
    (!!selectedIncidentData.isDispatched || dispatchedIds.has(selectedIncidentData.id));

  const handleUnitToggle = (unitId: string) => {
    // ✅ Can't pick responders once the incident is dispatched
    if (isAlreadyDispatched) return;

    setSelectedUnits(prev => {
      const newUnits = prev.includes(unitId) ? prev.filter(id => id !== unitId) : [...prev, unitId];
      
      const currentIncident = allIncidents.find(i => i.id === selectedIncident);
      const currentStep = currentIncident?.progressStep || progressStep;
      
      if (newUnits.length > 0 && currentStep < 3) {
        updateProgress(3);
      } else if (newUnits.length === 0 && currentStep < 3) {
        updateProgress(2);
      }
      return newUnits;
    });
  };

  const selectedUnitsData = units.filter(u => selectedUnits.includes(u.id));
  const fastestETA = selectedUnitsData.length > 0 ? Math.min(...selectedUnitsData.map(u => parseInt(u.eta))) : 0;

  // ✅ Only show responders who are NOT currently busy
  const availableUnits = units.filter(
    (u) => !u.userId || !busyResponderIds.has(u.userId)
  );

  // ✅ Roles allowed for the selected incident's type
  const incidentTypeKey = getIncidentTypeKey(
    selectedIncidentData?.type,
    selectedIncidentData?.specificType
  );

  // ✅ Apply the All Units / Specific Response Unit filter
  const filteredUnits = availableUnits.filter((u) => {
    if (unitFilterMode === 'specific') {
      // ✅ LoRa Device incidents use the Vehicle Type roles list
      if (selectedIncidentData?.source === 'LoRa Device' && VEHICLE_TYPE_ROLES[incidentTypeKey]) {
        return unitMatchesRoles(u, VEHICLE_TYPE_ROLES[incidentTypeKey]);
      }
      // ✅ Incident Type mapping: Assigned Unit + Responder Roles
      return unitMatchesIncidentMapping(u, incidentTypeKey);
    }
    return true;
  });

  // ✅ Crime + Specific Response Unit → priority order:
  //    1. Patrol Unit
  //    2. Responders assigned to the Patrol Unit (patrol / police / PNP station or specialization)
  //    3. Other available responders with appropriate roles and capabilities
  const getCrimePriority = (u: Unit): number => {
    if ((u.type || '').toLowerCase() === 'patrol unit') return 1;

    const assignment = `${u.station || ''} ${u.specialization || ''}`.toLowerCase();
    if (
      assignment.includes('patrol') ||
      assignment.includes('police') ||
      assignment.includes('pnp')
    ) {
      return 2;
    }
    return 3;
  };

  // ✅ Crime → ONLY police: Patrol Unit + responders assigned to the Patrol Unit.
  //    Fire / Rescue / other responders are removed from the list.
  const displayUnits =
    unitFilterMode === 'specific' &&
    getUnitInfoKey(incidentTypeKey) === 'Crime' &&
    selectedIncidentData?.source !== 'LoRa Device'
      ? [...filteredUnits]
          .filter((u) => getCrimePriority(u) <= 2)
          .sort((a, b) => getCrimePriority(a) - getCrimePriority(b))
      : filteredUnits;

  const handleDispatchAndNotify = async () => {
    if (isAlreadyDispatched) return; // ✅ safety guard

    if (!selectedIncidentData) {
      alert('⚠️ Please select an incident to dispatch.');
      return;
    }

    if (selectedUnitsData.length === 0) {
      alert('⚠️ Please select at least one unit to dispatch.');
      return;
    }

    setIsDispatching(true);
    updateProgress(3);

    // ✅ Instantly hide dispatched responders from Available Units
    setBusyResponderIds((prev) => {
      const next = new Set(prev);
      selectedUnitsData.forEach((u) => {
        if (u.userId) next.add(u.userId);
      });
      return next;
    });

    try {
      await updateIncidentReportsStatus(selectedIncidentData.id);
      await updateIncidentQueueStatus(selectedIncidentData.id);
      await updateForwardedIncidentStatus(selectedIncidentData.id);
      await createMonitoringStatus(selectedIncidentData, selectedUnitsData);

      // ✅ Mark this incident as dispatched → button becomes "Dispatched ✓" and units lock
      setDispatchedIds((prev) => new Set(prev).add(selectedIncidentData.id));

      const notificationPromises = selectedUnitsData.map(unit => 
        sendNotificationToResponder(selectedIncidentData, unit)
      );
      
      const notificationResults = await Promise.all(notificationPromises);
      const successfulNotifications = notificationResults.filter(result => result === true).length;
      
      console.log(`✅ Sent ${successfulNotifications}/${selectedUnitsData.length} notifications to responder_notifications`);

      // ✅ Send "Dispatched" notification to the reporter (NagaReady app)
      try {
        const assignedResponderNames = selectedUnitsData.map(u => u.name).join(', ') || 'CDRRMO Response Team';

        const reportsRef = collection(firestore, 'incident_reports');
        const allReports = await getDocs(reportsRef);
        let reporterUserId: string | null = null;

        allReports.forEach((d) => {
          const data = d.data();
          const matchesId =
            d.id === selectedIncidentData.id ||
            data.incidentId === selectedIncidentData.id ||
            data.reportId === selectedIncidentData.id;

          if (matchesId) {
            if (data.userId && data.userId !== 'eoc-user') {
              reporterUserId = data.userId;
            }
          }
        });

        if (reporterUserId) {
          const userNotificationsRef = collection(firestore, 'user_notifications');
          await setDoc(doc(userNotificationsRef), {
            userId: reporterUserId,
            reportId: selectedIncidentData.id,
            title: '🚑 Report Dispatched',
            message: `Your emergency report has been dispatched and assigned by ${assignedResponderNames}. Please wait for a responder to accept your request.`,
            incidentType: selectedIncidentData.type || 'Unknown',
            assignedResponders: selectedUnitsData.map(u => ({
              name: u.name,
              role: u.role || '',
              type: u.type || '',
              eta: u.eta || '',
            })),
            read: false,
            createdAt: serverTimestamp(),
            type: 'dispatch',
          });
          console.log('✅ Dispatched notification sent to reporter userId:', reporterUserId);

          await sendPushToUser(
            reporterUserId,
            '🚑 Report Dispatched',
            `Your emergency report has been dispatched and assigned by ${assignedResponderNames}. Please wait for a responder to accept your request.`,
            { reportId: selectedIncidentData.id, type: 'dispatch' }
          );
        } else {
          console.warn(
            '⚠️ No real reporter userId found (all matches were "eoc-user") for:',
            selectedIncidentData.id
          );
        }
      } catch (notifError) {
        console.error('Error sending dispatched notification to reporter:', notifError);
      }

      // ============================================================
      // ✅ LOG TO DASHBOARD ACTIVITY FEED
      // "Responder dispatched to incident"
      // ============================================================
      try {
        const type = normalizeIncidentType(selectedIncidentData.type, selectedIncidentData.specificType);
        const responderNames = selectedUnitsData.map(u => u.name).join(', ');
        const location = selectedIncidentData.address || selectedIncidentData.location || 'unknown location';

        await logActivity({
          icon: 'send',
          tone: 'gold',
          title: 'Responder dispatched',
          meta: `${responderNames} ${selectedUnitsData.length > 1 ? 'were' : 'was'} dispatched to the ${type} incident at ${location}`,
        });
        console.log('✅ Activity logged: Responder dispatched');
      } catch (logErr) {
        console.error('Failed to log dispatch activity:', logErr);
      }

      const dispatchedIncident = {
        ...selectedIncidentData,
        status: 'Dispatched',
        dispatchedUnits: selectedUnitsData.map(u => u.name).join(', '),
        dispatchTime: new Date().toLocaleString(),
        dispatched: true,
        isDispatched: true,
        progressStep: 3
      };

      localStorage.setItem('dispatchedIncident', JSON.stringify(dispatchedIncident));
      
      sessionStorage.setItem('selectedIncidentForMap', JSON.stringify({
        id: selectedIncidentData.id,
        lat: selectedIncidentData.lat || 10.3157,
        lng: selectedIncidentData.lng || 123.8854,
        title: selectedIncidentData.type,
        description: selectedIncidentData.description,
        location: selectedIncidentData.location,
        severity: 'high'
      }));

      console.log('✅ Dispatched incident with status Dispatched:', dispatchedIncident);
      
      alert(`✅ Incident ${selectedIncidentData.id} has been dispatched!\n\nUnits: ${selectedUnitsData.map(u => u.name).join(', ')}\nETA: ${fastestETA} mins\n\n📱 Notifications sent to ${successfulNotifications} responder(s)`);

      if (onDispatchComplete) {
        console.log('📤 Calling onDispatchComplete...');
        onDispatchComplete(dispatchedIncident);
      }

      if (onNavigateToDashboard) {
        console.log('📤 Calling onNavigateToDashboard...');
        onNavigateToDashboard();
      } else {
        console.log('⚠️ onNavigateToDashboard not provided, using window.location');
        window.location.href = '/dashboard';
      }
      
    } catch (error) {
      console.error('❌ Error during dispatch:', error);
      alert('❌ Failed to dispatch incident. Please try again.');
      updateProgress(2);
    } finally {
      setIsDispatching(false);
    }
  };

  const getStatusColor = (status: string) => {
    const statusLower = status.toLowerCase();
    switch(statusLower) {
      case 'waiting': return 'status-waiting';
      case 'verified': return 'status-verified';
      case 'units selected': return 'status-verified';
      case 'dispatched': return 'status-dispatched';
      case 'en route': return 'status-enroute';
      case 'arrived': return 'status-arrived';
      default: return 'status-pending';
    }
  };

  const getTypeIcon = (type: string) => {
    if (type.includes('Fire') || type.includes('Garage')) return '🔥';
    if (type.includes('Vehicle') || type.includes('Accident')) return '🚗';
    if (type.includes('Medical')) return '🚑';
    if (type.includes('Flood')) return '🌊';
    if (type.includes('Tree')) return '🌳';
    return '⚠️';
  };

  const getDisplayType = (incident: Incident | undefined) => {
    if (!incident) return 'Unknown';
    if (
      incident.type === 'Other' &&
      incident.specificType &&
      String(incident.specificType).trim().length > 0
    ) {
      return `Others – ${incident.specificType}`;
    }
    return incident.type;
  };

  if (loading || loadingUnits) {
    return (
      <div className="dispatch-responders-page">
        <div className="loading-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
          <div className="loading-spinner"></div>
          <p style={{ marginLeft: '16px', color: '#6B7280' }}>Loading incidents and units...</p>
        </div>
      </div>
    );
  }

  const filterSelectStyle: React.CSSProperties = {
    alignSelf: 'flex-start',   // stops it stretching to the column width
    width: '160px',
    padding: '2px 8px',
    borderRadius: '8px',
    border: '1px solid #FFFFFF',
    fontSize: '11px',
    background: '#0F1B38',
    color: '#FFFFFF',
    cursor: 'pointer',
    height: '24px',
  };

  return (
    <div className="dispatch-responders-page">
      <div className="dispatch-responders-grid">
        <div className="incidents-details-row">
          <div className="details-column" style={{ width: '100%' }}>
            {selectedIncidentData ? (
              <>
                <div className="details-card">
                  <div className="details-header">
                    <div className="details-title-group">
                      <div className="details-icon-wrapper">
                        <span>{getTypeIcon(selectedIncidentData.type)}</span>
                      </div>
                      <h3>Incident Details</h3>
                    </div>
                    <span className={`status-badge ${getStatusColor(selectedIncidentData.status)}`}>
                      {selectedIncidentData.status}
                    </span>
                  </div>
                  
                  <div className="details-main-layout">
                    <div className="details-info-section">

                      <div className="detail-row row-top">
                        <div className="detail-item">
                          <span className="detail-label">
                            {selectedIncidentData.source === 'LoRa Device' ? 'Vehicle Type' : 'Incident Type'}
                          </span>
                          <span className="detail-value">{getDisplayType(selectedIncidentData)}</span>
                        </div>

                        {/* ✅ Unit filter – beside the Incident Type column */}
                        <div className="detail-item">
                          <span className="detail-label">Unit Filter</span>
                          <select
                            style={filterSelectStyle}
                            value={unitFilterMode}
                            onChange={(e) => setUnitFilterMode(e.target.value as UnitFilterMode)}
                          >
                            <option value="all">All Units</option>
                            <option value="specific">Specific Response Unit</option>
                          </select>
                        </div>

                        <div className="detail-item">
                          <span className="detail-label">Incident ID</span>
                          <span className="detail-value">{selectedIncidentData.id}</span>
                        </div>
                      </div>

                      <div className="detail-row">
                        <div className="detail-item">
                          <span className="detail-label">Reporter</span>
                          <span className="detail-value">
                            {selectedIncidentData.reporter?.fullName || 'None'}
                          </span>
                        </div>
                        <div className="detail-item">
                          <span className="detail-label">Contact Number</span>
                          <span className="detail-value">
                            {selectedIncidentData.reporter?.phoneNumber || 'None'}
                          </span>
                        </div>
                        <div className="detail-item">
                          <span className="detail-label">Location</span>
                          <span className="detail-value location-text">
                            <i className="fa fa-map-marker-alt"></i> {selectedIncidentData.location}
                          </span>
                        </div>
                        <div className="detail-item">
                          <span className="detail-label">Reported</span>
                          <span className="detail-value">
                            {selectedIncidentData.date} • {selectedIncidentData.time}
                          </span>
                        </div>
                      </div>

                      <div className="detail-row row-casualties">
                        <div className="detail-item">
                          <span className="detail-label">Casualties</span>
                          <span className="detail-value" style={{ fontWeight: 600 }}>
                            {getCasualtiesTotal(selectedIncidentData.casualties) > 0
                              ? `${getCasualtiesTotal(selectedIncidentData.casualties)} reported`
                              : 'None reported'}
                          </span>
                        </div>
                        <div className="detail-item">
                          <span className="detail-label">Casualty Information</span>
                          <span className="detail-value">
                            {getCasualtiesText(selectedIncidentData.casualties)}
                          </span>
                        </div>
                      </div>

                      <div className="detail-row row-bottom">
                        <div className="detail-item">
                          <span className="detail-label">Description</span>
                          <span className="description-text">
                            {selectedIncidentData.description || 'No description provided'}
                          </span>
                        </div>
                        <div className="detail-item verified-by-block">
                          <span className="detail-label">Verified By</span>
                          <span className="detail-value">
                            <i className="fa fa-shield-halved"></i>{' '}
                            {selectedIncidentData.verifiedBy}
                          </span>
                        </div>
                      </div>

                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="no-incident-selected-card">
                <div className="no-incident-content">
                  <i className="fa fa-hand-pointer" style={{ fontSize: '48px', color: '#D1D5DB', marginBottom: '16px' }}></i>
                  <h3 style={{ color: '#1F2937', margin: '0 0 8px 0' }}>No Incident Selected</h3>
                  <p style={{ color: '#6B7280', margin: 0, fontSize: '0.9rem' }}>Select an incident from History to view details</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {selectedIncidentData && (
          <>
            <div className="units-card">
              <div className="units-header">
                <h3>Recommended Available Units</h3>
                <span className="units-count">{displayUnits.length} available</span>
              </div>

              <div className="units-grid">
                {displayUnits.length === 0 ? (
                  <div className="empty-units" style={{ 
                    gridColumn: '1 / -1', 
                    textAlign: 'center', 
                    padding: '40px 20px',
                    color: '#6B7280'
                  }}>
                    <i className="fa fa-users" style={{ fontSize: '36px', color: '#D1D5DB', marginBottom: '12px', display: 'block' }}></i>
                    <p style={{ margin: 0, fontSize: '14px' }}>No responders available</p>
                    <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#9CA3AF' }}>
                      {unitFilterMode === 'all'
                        ? 'All responders are currently on active dispatch'
                        : 'No available responder matches this filter'}
                    </p>
                  </div>
                ) : (
                  displayUnits.map((unit) => (
                    <div 
                      key={unit.id} 
                      className={`unit-card ${selectedUnits.includes(unit.id) ? 'selected' : ''}`}
                      onClick={() => handleUnitToggle(unit.id)}
                      style={isAlreadyDispatched ? { cursor: 'not-allowed', pointerEvents: 'none' } : undefined}
                    >
                      <div className="unit-checkbox">
                        <input 
                          type="checkbox" 
                          checked={selectedUnits.includes(unit.id)}
                          disabled={isAlreadyDispatched}
                          onChange={() => {}}
                        />
                      </div>
                      <div className="unit-icon">
                        {unit.profile ? (
                          <img src={unit.profile} alt={unit.name} style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }} />
                        ) : (
                          <i className="fa fa-user-circle" style={{ fontSize: '28px' }}></i>
                        )}
                      </div>
                      <div className="unit-info">
                        <div className="unit-name">{unit.name}</div>
                        <div className="unit-code-type">
                          <span className="unit-type">{unit.type}</span>
                        </div>
                        <span className="unit-capability">{unit.capability}</span>
                        {unit.role && (
                          <span className="unit-role" style={{ fontSize: '10px', color: '#6B7280', marginTop: '2px' }}>
                            {unit.role} {unit.station && `• ${unit.station}`}
                          </span>
                        )}
                      </div>
                      <div className="unit-meta">
                        <span className="unit-availability available"><i className="fa fa-check-circle"></i> Available</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {(availableUnits.length > 0 || isAlreadyDispatched) && (
              <>
                <button 
                  className="dispatch-btn"
                  onClick={handleDispatchAndNotify}
                  disabled={isAlreadyDispatched || isDispatching || selectedUnitsData.length === 0}
                  style={{
                    opacity: (!isAlreadyDispatched && (isDispatching || selectedUnitsData.length === 0)) ? 0.6 : 1,
                    cursor: (isAlreadyDispatched || isDispatching || selectedUnitsData.length === 0) ? 'not-allowed' : 'pointer',
                    ...(isAlreadyDispatched ? { background: '#16A34A', color: '#FFFFFF' } : {}),
                  }}
                >
                  {isAlreadyDispatched ? (
                    <>Dispatched ✓</>
                  ) : (
                    <>
                      <i className="fa fa-rocket"></i> 
                      {isDispatching ? 'Dispatching...' : 'Dispatch & Notify'}
                    </>
                  )}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default DispatchResponders;