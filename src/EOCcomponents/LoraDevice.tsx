// web/src/EOCcomponents/LoraDevice.tsx

import React, { useState, useEffect, useRef } from 'react';
import '../css/LoraDevice.css';
import LiveMap from './LiveMap';
import { firestore } from '../firebase';
import {
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc,
  updateDoc,
  query,
  orderBy,
  serverTimestamp
} from 'firebase/firestore';

interface Incident {
  id: number;
  deviceId: string;
  type: string;
  coordinates: string;
  latitude: number;
  longitude: number;
  signal: string;
  gpsStatus: string;
  snr: string;
  receivedAt: string;
  status: string;
  incident_type: string;
  message?: string;
  rssi?: number;
  source?: string;
  timestamp?: string;
  title?: string;
  severity?: string;
  description?: string;
  time?: string;
  location?: string;
  firebaseId?: string;
  // ✅ ID of the LoRa alert (from LoraAlert) that created this incident.
  // Used to tell "same alert clicked twice" apart from "a NEW alert from the same node".
  alertId?: string;
}

interface LoraDeviceProps {
  onForwardToDispatch?: () => void;
}

// ✅ Unique key for an incident / alert payload
const incidentKey = (i: {
  alertId?: string;
  deviceId?: string;
  coordinates?: string;
  type?: string;
}) =>
  i.alertId
    ? `alert:${i.alertId}`
    : `${i.deviceId}|${i.coordinates}|${i.type}`;

const LoraDevice: React.FC<LoraDeviceProps> = ({ onForwardToDispatch }) => {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [alertTick, setAlertTick] = useState(0);

  // ✅ Always-current copy of the incidents list (readable synchronously,
  // unlike state updater functions which React runs later).
  const incidentsRef = useRef<Incident[]>([]);
  incidentsRef.current = incidents;

  // ✅ Alerts already turned into incidents this session: key -> incident.
  // Stops the event + localStorage backup from adding the same alert twice,
  // and lets a repeat click on the same alert just re-select its incident.
  const alertIncidentMapRef = useRef<Map<string, Incident>>(new Map());

  // Mock data for display (fallback)
  const mockIncidents: Incident[] = [
    {
      id: 1,
      deviceId: 'NODE-001',
      type: 'RESCUEME',
      coordinates: '10.221599, 123.731262',
      latitude: 10.221599,
      longitude: 123.731262,
      signal: 'Good',
      gpsStatus: 'Locked',
      snr: '12.75 dB',
      receivedAt: '1 day ago',
      status: 'new',
      incident_type: 'RESCUEME',
    },
    {
      id: 2,
      deviceId: 'NODE-002',
      type: 'RESCUEME',
      coordinates: '10.219884, 123.729123',
      latitude: 10.219884,
      longitude: 123.729123,
      signal: 'Fair',
      gpsStatus: 'Locked',
      snr: '10.25 dB',
      receivedAt: '2 hours ago',
      status: 'for_review',
      incident_type: 'RESCUEME',
    },
    {
      id: 3,
      deviceId: 'NODE-003',
      type: 'RESCUEME',
      coordinates: '10.218221, 123.728002',
      latitude: 10.218221,
      longitude: 123.728002,
      signal: 'Good',
      gpsStatus: 'Locked',
      snr: '14.50 dB',
      receivedAt: '4 hours ago',
      status: 'verified',
      incident_type: 'RESCUEME',
    },
    {
      id: 4,
      deviceId: 'NODE-004',
      type: 'RESCUEME',
      coordinates: '10.217759, 123.726881',
      latitude: 10.217759,
      longitude: 123.726881,
      signal: 'Excellent',
      gpsStatus: 'Locked',
      snr: '16.20 dB',
      receivedAt: '6 hours ago',
      status: 'dispatched',
      incident_type: 'RESCUEME',
    },
    {
      id: 5,
      deviceId: 'NODE-005',
      type: 'RESCUEME',
      coordinates: '10.216445, 123.725991',
      latitude: 10.216445,
      longitude: 123.725991,
      signal: 'Good',
      gpsStatus: 'Locked',
      snr: '13.10 dB',
      receivedAt: '12 hours ago',
      status: 'resolved',
      incident_type: 'RESCUEME',
    },
  ];

  // =================================
  // LOAD INCIDENTS FROM FIREBASE
  // =================================

  const loadIncidentsFromFirebase = async () => {
    try {
      setLoading(true);
      console.log('🔄 Loading incidents from Firebase...');

      const q = query(
        collection(firestore, 'lora_incidents'),
        orderBy('timestamp', 'desc')
      );

      const snapshot = await getDocs(q);
      const loadedIncidents: Incident[] = [];

      if (snapshot.empty) {
        console.log('📭 No incidents found in Firebase, using mock data');
        const mockData = [...mockIncidents];
        setIncidents(mockData);
        await saveMultipleIncidentsToFirebase(mockData);
        setLoading(false);
        return;
      }

      snapshot.forEach((doc) => {
        const data = doc.data();
        loadedIncidents.push({
          id: data.id || Date.now(),
          firebaseId: doc.id,
          deviceId: data.deviceId || 'UNKNOWN',
          type: data.type || 'RESCUEME',
          coordinates: data.coordinates || '0, 0',
          latitude: data.latitude || 0,
          longitude: data.longitude || 0,
          signal: data.signal || 'Good',
          gpsStatus: data.gpsStatus || 'Locked',
          snr: data.snr || '0 dB',
          receivedAt: data.receivedAt || new Date().toLocaleString(),
          status: data.status || 'new',
          incident_type: data.incident_type || 'RESCUEME',
          message: data.message || '',
          rssi: data.rssi || 0,
          source: data.source || 'LoRa',
          timestamp: data.timestamp || new Date().toISOString(),
          alertId: data.alertId || undefined,
        });
      });

      console.log(`✅ Loaded ${loadedIncidents.length} incidents from Firebase`);

      // ✅ Merge — don't clobber incidents that were just added from
      // LoraAlert while this async load was in flight.
      setIncidents(prev => {
        const existingKeys = new Set(loadedIncidents.map(i => incidentKey(i)));
        const extras = prev.filter(p => !existingKeys.has(incidentKey(p)));
        return [...extras, ...loadedIncidents];
      });

      if (loadedIncidents.length > 0) {
        setSelectedIncident(prev => prev || loadedIncidents[0]);
        setSelectedId(prev => prev ?? loadedIncidents[0].id);
      }

    } catch (error) {
      console.error('❌ Error loading incidents from Firebase:', error);
      setIncidents(mockIncidents);
      if (mockIncidents.length > 0) {
        setSelectedIncident(mockIncidents[0]);
        setSelectedId(mockIncidents[0].id);
      }
    } finally {
      setLoading(false);
    }
  };

  // =================================
  // SAVE MULTIPLE INCIDENTS TO FIREBASE
  // =================================

  const saveMultipleIncidentsToFirebase = async (incidentsToSave: Incident[]) => {
    try {
      const incidentsRef = collection(firestore, 'lora_incidents');

      for (const incident of incidentsToSave) {
        await addDoc(incidentsRef, {
          id: incident.id,
          deviceId: incident.deviceId,
          type: incident.type,
          coordinates: incident.coordinates,
          latitude: incident.latitude,
          longitude: incident.longitude,
          signal: incident.signal,
          gpsStatus: incident.gpsStatus,
          snr: incident.snr,
          receivedAt: incident.receivedAt,
          status: incident.status,
          incident_type: incident.incident_type,
          message: incident.message || '',
          rssi: incident.rssi || 0,
          source: incident.source || 'LoRa',
          timestamp: incident.timestamp || new Date().toISOString(),
          alertId: incident.alertId || '',
          createdAt: serverTimestamp(),
        });
      }
      console.log(`✅ Saved ${incidentsToSave.length} incidents to Firebase`);
    } catch (error) {
      console.error('❌ Error saving incidents to Firebase:', error);
    }
  };

  // =================================
  // SAVE SINGLE INCIDENT TO FIREBASE
  // =================================

  const saveIncidentToFirebase = async (incident: Incident) => {
    try {
      setSyncing(true);
      const incidentsRef = collection(firestore, 'lora_incidents');

      const docRef = await addDoc(incidentsRef, {
        id: incident.id,
        deviceId: incident.deviceId,
        type: incident.type,
        coordinates: incident.coordinates,
        latitude: incident.latitude,
        longitude: incident.longitude,
        signal: incident.signal,
        gpsStatus: incident.gpsStatus,
        snr: incident.snr,
        receivedAt: incident.receivedAt,
        status: incident.status,
        incident_type: incident.incident_type,
        message: incident.message || '',
        rssi: incident.rssi || 0,
        source: incident.source || 'LoRa',
        timestamp: incident.timestamp || new Date().toISOString(),
        alertId: incident.alertId || '',
        createdAt: serverTimestamp(),
      });

      console.log(`✅ Incident saved to Firebase with ID: ${docRef.id}`);

      setIncidents(prev =>
        prev.map(inc =>
          inc.id === incident.id ? { ...inc, firebaseId: docRef.id } : inc
        )
      );

      // ✅ Keep the selected incident in sync so "Forward to Dispatch"
      // updates this document instead of creating another one.
      setSelectedIncident(prev =>
        prev && prev.id === incident.id ? { ...prev, firebaseId: docRef.id } : prev
      );

      return docRef.id;
    } catch (error) {
      console.error('❌ Error saving incident to Firebase:', error);
      alert('Failed to save incident to database. Please try again.');
      return null;
    } finally {
      setSyncing(false);
    }
  };

  // =================================
  // UPDATE INCIDENT IN FIREBASE
  // =================================

  const updateIncidentInFirebase = async (incident: Incident) => {
    if (!incident.firebaseId) {
      return await saveIncidentToFirebase(incident);
    }

    try {
      setSyncing(true);
      const incidentRef = doc(firestore, 'lora_incidents', incident.firebaseId);

      await updateDoc(incidentRef, {
        status: incident.status,
        updatedAt: serverTimestamp(),
      });

      console.log(`✅ Incident ${incident.id} updated in Firebase`);
      return incident.firebaseId;
    } catch (error) {
      console.error('❌ Error updating incident in Firebase:', error);
      return null;
    } finally {
      setSyncing(false);
    }
  };

  // =================================
  // DELETE INCIDENT FROM FIREBASE
  // (kept for internal use, not exposed in UI)
  // =================================

  const deleteIncidentFromFirebase = async (firebaseId: string) => {
    try {
      setSyncing(true);
      const incidentRef = doc(firestore, 'lora_incidents', firebaseId);
      await deleteDoc(incidentRef);
      console.log(`✅ Incident ${firebaseId} deleted from Firebase`);
      return true;
    } catch (error) {
      console.error('❌ Error deleting incident from Firebase:', error);
      return false;
    } finally {
      setSyncing(false);
    }
  };

  // =================================
  // ✅ HELPER: Add an incident object directly (used by the event handler
  // and by the localStorage fallback). Single source of truth for
  // "add a LoRa alert to the queue".
  //
  // ✅ FIX: works even when the LoRa Device page is ALREADY open.
  //   - No more `let added` flag set inside a setState updater (React runs
  //     updaters later, so the flag was still false → the new incident was
  //     never selected or saved).
  //   - Duplicates are detected with refs (synchronously) using the alert's
  //     own ID, so a NEW alert from the same node is no longer dropped.
  //   - Clicking the same alert again just re-selects its incident.
  // =================================

  const addIncidentFromAlertData = React.useCallback((alertData: any) => {
    if (!alertData) return;

    const alertId = alertData.alertId ? String(alertData.alertId) : undefined;
    const dedupeKey = incidentKey({
      alertId,
      deviceId: alertData.deviceId || 'UNKNOWN',
      coordinates: alertData.coordinates || '0, 0',
      type: alertData.type || 'RESCUEME',
    });

    const selectIncident = (inc: Incident) => {
      // Prefer the latest copy from the list (it may have its firebaseId by now)
      const latest = incidentsRef.current.find(i => i.id === inc.id) || inc;
      setSelectedIncident(latest);
      setSelectedId(latest.id);
    };

    // 1. Already handled in this session (event + localStorage backup, or a repeat click)
    const handled = alertIncidentMapRef.current.get(dedupeKey);
    if (handled) {
      console.log('↩️ Alert already added — selecting its incident:', dedupeKey);
      selectIncident(handled);
      return;
    }

    // 2. Already in the list (e.g. loaded from Firebase earlier)
    const existing = incidentsRef.current.find(inc => incidentKey(inc) === dedupeKey);
    if (existing) {
      console.log('↩️ Incident already in list — selecting it:', dedupeKey);
      alertIncidentMapRef.current.set(dedupeKey, existing);
      selectIncident(existing);
      return;
    }

    // 3. Brand-new alert → add, select, save
    const newIncident: Incident = {
      id: Date.now(),
      deviceId: alertData.deviceId || 'UNKNOWN',
      type: alertData.type || 'RESCUEME',
      coordinates: alertData.coordinates || '0, 0',
      latitude: alertData.latitude || 0,
      longitude: alertData.longitude || 0,
      signal: alertData.signal || 'Good',
      gpsStatus: alertData.gpsStatus || 'Locked',
      snr: alertData.snr || '0 dB',
      receivedAt: alertData.receivedAt || new Date().toLocaleString(),
      // ✅ Auto-verified: comes in as 'verified' (like NotificationBox / SMS)
      status: 'verified',
      incident_type: alertData.type || 'RESCUEME',
      message: alertData.message || '',
      rssi: alertData.rssi || 0,
      source: alertData.source || 'LoRa',
      timestamp: alertData.timestamp || new Date().toISOString(),
      alertId,
    };

    alertIncidentMapRef.current.set(dedupeKey, newIncident);

    setIncidents(prev => [newIncident, ...prev]);
    setSelectedIncident(newIncident);
    setSelectedId(newIncident.id);

    saveIncidentToFirebase(newIncident);

    console.log('✅ Added incident from LoraAlert (auto-verified) and saved to Firebase:', newIncident);
  }, []);

  // =================================
  // LOAD FROM LOCAL STORAGE (LoraAlert)
  // Backup path: reads localStorage and hands off to addIncidentFromAlertData.
  // =================================

  useEffect(() => {
    const storedIncident = localStorage.getItem('loraIncidentData');
    if (!storedIncident) return;

    try {
      const alertData = JSON.parse(storedIncident);
      addIncidentFromAlertData(alertData);
    } catch (error) {
      console.error('❌ Error parsing stored incident:', error);
    }

    // Always clear so a stale entry can't be re-read
    localStorage.removeItem('loraIncidentData');
    localStorage.removeItem('loraSelectedIncident');
  }, [alertTick, addIncidentFromAlertData]);

  // =================================
  // ✅ Listen for LoraAlert "Report" clicks
  // Processes the event detail DIRECTLY so it works even when
  // LoraDevice is ALREADY mounted (you're already on this page).
  // =================================

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      console.log('🔔 LoraDevice received newLoraIncident event:', detail);

      if (detail) {
        addIncidentFromAlertData(detail);
      }

      // Also bump alertTick so the localStorage effect runs as a backup
      // (harmless — duplicates are ignored).
      setAlertTick((t) => t + 1);
    };

    window.addEventListener('newLoraIncident', handler);
    return () => {
      window.removeEventListener('newLoraIncident', handler);
    };
  }, [addIncidentFromAlertData]);

  // =================================
  // LOAD INCIDENTS ON MOUNT
  // =================================

  useEffect(() => {
    loadIncidentsFromFirebase();
  }, []);

  // =================================
  // HANDLE DELETE INCIDENT
  // (kept for internal use, not exposed in UI anymore)
  // =================================

  const handleDeleteIncident = async (id: number) => {
    if (window.confirm(`⚠️ Are you sure you want to permanently delete this incident? This action cannot be undone.`)) {

      const incidentToDelete = incidents.find(inc => inc.id === id);

      if (incidentToDelete?.firebaseId) {
        const deleted = await deleteIncidentFromFirebase(incidentToDelete.firebaseId);
        if (!deleted) {
          alert('Failed to delete from database. Please try again.');
          return;
        }
      }

      setIncidents(prev => {
        const updated = prev.filter(inc => inc.id !== id);
        return updated;
      });

      if (selectedIncident?.id === id) {
        setSelectedIncident(null);
        setSelectedId(null);
      }

      console.log(`🗑️ Permanently deleted incident with ID: ${id}`);
    }
  };

  // Kept for internal cleanup/safety — not exposed in UI.
  void handleDeleteIncident;

  // =================================
  // HANDLE FORWARD TO DISPATCH
  // =================================

  const handleForwardToDispatch = async () => {
    if (!selectedIncident) {
      alert('⚠️ Please select an incident to forward.');
      return;
    }

    if (selectedIncident.status === 'dispatched' || selectedIncident.status === 'forwarded') {
      alert(`⚠️ Incident ${selectedIncident.deviceId} has already been forwarded.`);
      return;
    }

    if (window.confirm(`🚨 Are you sure you want to forward this incident from ${selectedIncident.deviceId} to Dispatch?`)) {
      try {
        setSyncing(true);

        const forwardedIncident = {
          id: `LORA-${Date.now()}`,
          type: selectedIncident.type || 'RESCUEME',
          location: selectedIncident.coordinates || 'Unknown location',
          date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
          time: new Date().toLocaleTimeString(),
          status: 'Verified',
          description: selectedIncident.message || `${selectedIncident.type} alert from LoRa device ${selectedIncident.deviceId}`,
          verifiedBy: 'EOC Intake Officer (LoRa)',
          forwardedBy: 'EOC Intake Officer (LoRa)',
          forwardedTime: new Date().toLocaleString(),
          lat: selectedIncident.latitude || 0,
          lng: selectedIncident.longitude || 0,
          address: selectedIncident.coordinates || 'Unknown location',
          source: 'LoRa Device',
          deviceId: selectedIncident.deviceId,
          coordinates: selectedIncident.coordinates,
          signal: selectedIncident.signal,
          snr: selectedIncident.snr,
          gpsStatus: selectedIncident.gpsStatus,
          originalId: selectedIncident.id,
          hasPhoto: false,
          photoUrl: null,
          reporter: {
            fullName: 'LoRa Device Alert',
            phoneNumber: 'N/A'
          },
          casualties: {
            injured: 0,
            fatalities: 0,
            trapped: 0
          },
          createdAt: new Date().toISOString(),
          progressStep: 1,
        };

        const updatedIncident = { ...selectedIncident, status: 'forwarded' };
        await updateIncidentInFirebase(updatedIncident);

        setSelectedIncident(updatedIncident);
        setIncidents(prev =>
          prev.map(inc => inc.id === updatedIncident.id ? updatedIncident : inc)
        );

        const forwardedRef = collection(firestore, 'forwarded_incidents');
        await addDoc(forwardedRef, {
          ...forwardedIncident,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        const existingForwarded = localStorage.getItem('forwardedIncidents');
        let forwardedList = [];
        if (existingForwarded) {
          try {
            forwardedList = JSON.parse(existingForwarded);
          } catch (e) {
            console.error('Error parsing forwarded incidents:', e);
          }
        }
        forwardedList.unshift(forwardedIncident);
        localStorage.setItem('forwardedIncidents', JSON.stringify(forwardedList));

        console.log('✅ Incident forwarded to dispatch:', forwardedIncident);

        alert(`✅ Incident ${selectedIncident.deviceId} has been forwarded to Dispatch!`);

        if (onForwardToDispatch) {
          onForwardToDispatch();
        } else {
          window.location.href = '/dispatch-responders';
        }

      } catch (error) {
        console.error('❌ Error forwarding incident to dispatch:', error);
        alert('❌ Failed to forward incident. Please try again.');
      } finally {
        setSyncing(false);
      }
    }
  };

  // =================================
  // HANDLE DUPLICATE REPORT
  // (kept for internal use, button removed from UI)
  // =================================

  const handleDuplicateReport = async () => {
    if (selectedIncident) {
      if (window.confirm(`📋 Are you sure you want to duplicate this incident from ${selectedIncident.deviceId}?`)) {
        const duplicatedIncident: Incident = {
          ...selectedIncident,
          id: Date.now() + 1,
          deviceId: selectedIncident.deviceId + '-COPY',
          status: 'new',
          receivedAt: new Date().toLocaleString(),
          timestamp: new Date().toISOString(),
          firebaseId: undefined,
          alertId: undefined, // a copy is not the original alert
        };

        setIncidents(prev => [duplicatedIncident, ...prev]);
        setSelectedIncident(duplicatedIncident);
        setSelectedId(duplicatedIncident.id);

        await saveIncidentToFirebase(duplicatedIncident);

        alert(`📋 Duplicate report created for ${selectedIncident.deviceId}`);
        console.log('📋 Duplicated incident:', duplicatedIncident);
      }
    }
  };

  // Kept for internal use — not exposed in UI.
  void handleDuplicateReport;

  // =================================
  // HELPERS
  // =================================

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'new': return 'badge-blue';
      case 'for_review': return 'badge-orange';
      case 'verified': return 'badge-green';
      case 'dispatched': return 'badge-indigo';
      case 'resolved': return 'badge-gray';
      case 'rejected': return 'badge-red';
      case 'forwarded': return 'badge-purple';
      default: return 'badge-gray';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'new': return 'NEW REPORT';
      case 'for_review': return 'FOR REVIEW';
      case 'verified': return 'VERIFIED';
      case 'dispatched': return 'DISPATCHED';
      case 'resolved': return 'RESOLVED';
      case 'rejected': return 'REJECTED';
      case 'forwarded': return 'FORWARDED';
      default: return 'UNKNOWN';
    }
  };

  const getSignalClass = (signal: string) => {
    switch (signal) {
      case 'Excellent': return 'signal-excellent';
      case 'Good': return 'signal-good';
      case 'Fair': return 'signal-fair';
      case 'Poor': return 'signal-poor';
      default: return 'signal-good';
    }
  };

  // ✅ Only the ACTIVE (selected) incident is pinned on the map.
  // Its pin location comes from the Incident Information shown on the left.
  const mapIncidents = incidents
    .filter((inc: Incident) => inc.id === selectedId)
    .map((inc: Incident) => ({
      ...inc,
      incident_type: inc.type,
      title: `🚨 ${inc.type}`,
      severity: inc.status === 'new' || inc.status === 'for_review' ? 'high' : 'medium',
      description: inc.type,
      time: inc.receivedAt,
      location: inc.coordinates,
    }));

  // ✅ Display title helper — like IncidentIntake
  const getDisplayTitle = (incident: Incident) => {
    if (incident?.type === 'Other' && incident?.message) {
      return `Others – ${incident.message} Incident Report`;
    }
    return `LoRa ${incident?.type || 'RESCUEME'} Alert`;
  };

  if (loading) {
    return (
      <div className="incident-page" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="loading-spinner"></div>
          <p style={{ marginTop: '20px', color: '#94A3B8' }}>Loading incidents from database...</p>
        </div>
      </div>
    );
  }

  // ✅ Render Details (mirrors IncidentIntake's renderIncidentDetails)
  const renderIncidentDetails = () => {
    const incident = selectedIncident;

    const nearbyPlacesDisplay = null; // LoRa doesn't use nearby places

    return (
      <div className="details-card">
        <div className="card-header">
          <h5>Incident Information</h5>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {syncing && (
              <span style={{ fontSize: '12px', color: '#3B82F6' }}>
                <i className="fa fa-spinner fa-spin"></i> Syncing...
              </span>
            )}
            <button className="edit-btn" onClick={loadIncidentsFromFirebase}>
              <i className="fa fa-refresh"></i> Refresh
            </button>
          </div>
        </div>

        <div className="incident-content">
          {incident ? (
            <>
              {/* ✅ Status badge inline on the LEFT next to icon + title */}
              <div className="incident-type-header">
                <span className="fire-icon">🚨</span>
                <h4>{getDisplayTitle(incident)}</h4>
                <span className={`badge ${getStatusBadge(incident.status)}`}>
                  {getStatusLabel(incident.status)}
                </span>
              </div>
              <div className="incident-id">{incident.deviceId}</div>

              {/* Badges row */}
              <div className="badges-row">
                <span className="badge" style={{
                  background: '#1E3A8A',
                  color: '#93C5FD',
                }}>
                  <i className="fa fa-wifi"></i> LoRa
                </span>
                {incident.source && (
                  <span className="badge badge-gray">
                    <i className="fa fa-tag"></i> {incident.source}
                  </span>
                )}
              </div>

              {/* ✅ INFO GRID — mirroring IncidentIntake */}
              <div className="info-grid">
                <div className="info-item">
                  <span className="label">Device ID</span>
                  <span className="value mono">{incident.deviceId}</span>
                </div>
                <div className="info-item">
                  <span className="label">Vehicle Type</span>
                  <span className="value">
                    <span className="lora-type-badge">{incident.type || 'RESCUEME'}</span>
                  </span>
                </div>
                <div className="info-item">
                  <span className="label">Signal Strength</span>
                  <span className={`value ${getSignalClass(incident.signal)}`}>
                    <span className="lora-signal-dot"></span>
                    {incident.signal}
                  </span>
                </div>
                <div className="info-item">
                  <span className="label">GPS Status</span>
                  <span className={`value ${incident.gpsStatus === 'Locked' ? 'signal-good' : 'signal-poor'}`}>
                    <span className="lora-signal-dot"></span>
                    {incident.gpsStatus}
                  </span>
                </div>
                <div className="info-item">
                  <span className="label">SNR</span>
                  <span className="value">{incident.snr}</span>
                </div>
                <div className="info-item">
                  <span className="label">Received</span>
                  <span className="value">{incident.receivedAt}</span>
                </div>
                {incident.message && (
                  <div className="info-item full-width">
                    <span className="label">Message</span>
                    <span className="value">{incident.message}</span>
                  </div>
                )}
                <div className="info-item full-width">
                  <span className="label">Location</span>
                  <span className="value mono">{incident.coordinates}</span>
                </div>
                {incident.firebaseId && (
                  <div className="info-item full-width">
                    <span className="label">Synced</span>
                    <span className="value" style={{ color: '#10B981' }}>
                      <i className="fa fa-check-circle"></i> Yes
                    </span>
                  </div>
                )}
              </div>

              {/* ✅ LOCATION DETAILS SECTION — mirroring IncidentIntake */}
              {incident.latitude && incident.longitude && (
                <div className="location-details-section">
                  <div className="location-details-title">
                    <i className="fa fa-map"></i> Location Details
                  </div>
                  <div className="location-details-grid">
                    <div className="location-detail-item">
                      <i className="fa fa-road"></i>
                      <span className="label">Street:</span>
                      <span className="value">
                        {incident.type === 'Fire' ? 'Rizal Street' :
                         incident.type === 'Accident' ? 'Main Highway' :
                         incident.type === 'Medical' ? '5th Avenue' :
                         incident.type === 'Flood' ? 'River Road' :
                         incident.type === 'Crime' ? 'Police Road' : 'Unknown Street'}
                      </span>
                    </div>
                    <div className="location-detail-item">
                      <i className="fa fa-map-pin"></i>
                      <span className="label">Barangay:</span>
                      <span className="value">San Roque</span>
                    </div>
                    <div className="location-detail-item">
                      <i className="fa fa-building"></i>
                      <span className="label">Landmark:</span>
                      <span className="value">
                        {incident.type === 'Fire' ? 'Near City Hall' :
                         incident.type === 'Accident' ? 'Near Shopping Mall' :
                         incident.type === 'Medical' ? 'Near Hospital' :
                         incident.type === 'Flood' ? 'Near River' :
                         incident.type === 'Crime' ? 'Near Police Station' : 'Near City Center'}
                      </span>
                    </div>
                    <div className="location-detail-item">
                      <i className="fa fa-location-dot"></i>
                      <span className="label">Coordinates:</span>
                      <span className="value">{incident.latitude.toFixed(6)}, {incident.longitude.toFixed(6)}</span>
                    </div>
                  </div>
                </div>
              )}

              {nearbyPlacesDisplay}

              {incident.latitude && incident.longitude && (
                <div className="location-coords">
                  <i className="fa fa-location-dot"></i>
                  <span>
                    Coordinates: {incident.latitude.toFixed(6)}° N, {incident.longitude.toFixed(6)}° E
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="info-item full-width" style={{ padding: '20px', textAlign: 'center' }}>
              <span className="value" style={{ color: '#64748B' }}>
                Select an incident from the queue to view details.
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="incident-page">
      <div className="incident-grid">
        {renderIncidentDetails()}

        <div className="right-column">
          {/* ✅ Map card — same as IncidentIntake */}
          <div className="map-card">
            <div className="leaflet-map-container">
              <LiveMap
                incidents={mapIncidents}
                selectedId={selectedId}
              />
            </div>
            <div className="map-address">
              <i className="fa fa-map-pin"></i>
              <span>{selectedIncident?.coordinates || 'No location selected'}</span>
            </div>
            {selectedIncident?.latitude && selectedIncident?.longitude && (
              <div className="map-coords">
                <span>
                  <i className="fa fa-location-dot"></i>
                  {selectedIncident.latitude}° N, {selectedIncident.longitude}° E
                </span>
              </div>
            )}
          </div>

          {/* ✅ Actions card — only Forward to Dispatch remains (full width). */}
          <div className="actions-card">
            <div className="action-buttons-horizontal">
              <button
                className={`btn-dispatch ${selectedIncident?.status === 'dispatched' || selectedIncident?.status === 'forwarded' ? 'btn-dispatched' : ''}`}
                onClick={handleForwardToDispatch}
                disabled={
                  !selectedIncident ||
                  selectedIncident.status === 'dispatched' ||
                  selectedIncident.status === 'forwarded' ||
                  selectedIncident.status === 'rejected' ||
                  syncing
                }
                style={{
                  gridColumn: '1 / -1',
                  backgroundColor:
                    selectedIncident?.status === 'dispatched' || selectedIncident?.status === 'forwarded' ? '#334155' :
                    '#2563EB',
                  cursor:
                    selectedIncident?.status === 'dispatched' || selectedIncident?.status === 'forwarded' ? 'default' :
                    'pointer',
                  opacity:
                    selectedIncident?.status === 'dispatched' || selectedIncident?.status === 'forwarded' ? 0.7 :
                    1,
                }}
              >
                <i className="fa fa-paper-plane"></i>
                {selectedIncident?.status === 'dispatched' || selectedIncident?.status === 'forwarded' ? 'Forwarded ✓' : 'Forward to Dispatch'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoraDevice;