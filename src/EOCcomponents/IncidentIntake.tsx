// web/src/EOCcomponents/IncidentIntake.tsx
/// <reference types="google.maps" />

import React, { useEffect, useRef, useState } from 'react';
import '../css/IncidentIntake.css';
import { firestore } from '../firebase';
import {
  collection,
  addDoc,
  serverTimestamp,
  query,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  where,
  getDocs,
  setDoc,
} from 'firebase/firestore';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
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

// ============================================================
// ✅ HELPER: Parse coordinates from SMS text
// Supports:
//   - COORDS:10.258847,123.711452            (new structured)
//   - MAP:https://maps.google.com/?q=lat,lon (new structured)
//   - Lat:10.258847,Long:123.711452          (current app format)
//   - Latitude 10.258847, Longitude 123.711452
//   - 10.258847, 123.711452                  (plain pair)
// Returns null if nothing valid found. NEVER returns a hardcoded default.
// ============================================================
function parseSMSCoordinates(text: string): { lat: number; lng: number } | null {
  if (!text || typeof text !== 'string') return null;

  const tryReturn = (lat: number, lng: number) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90) return null;
    if (lng < -180 || lng > 180) return null;
    if (lat === 0 && lng === 0) return null;
    return { lat, lng };
  };

  // 1. Structured tag: COORDS:lat,lon
  const coordsTag = text.match(
    /COORDS:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i
  );
  if (coordsTag) {
    const r = tryReturn(parseFloat(coordsTag[1]), parseFloat(coordsTag[2]));
    if (r) return r;
  }

  // 2. Google Maps link: maps.google.com/?q=lat,lon  (or similar)
  const mapLink = text.match(
    /maps\.google\.com\/\?q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i
  );
  if (mapLink) {
    const r = tryReturn(parseFloat(mapLink[1]), parseFloat(mapLink[2]));
    if (r) return r;
  }

  // 3. App's current format: Lat:X,Long:Y  (comma, no space)
  const currentFormat = text.match(
    /Lat:\s*(-?\d+(?:\.\d+)?)\s*,\s*Long:\s*(-?\d+(?:\.\d+)?)/i
  );
  if (currentFormat) {
    const r = tryReturn(
      parseFloat(currentFormat[1]),
      parseFloat(currentFormat[2])
    );
    if (r) return r;
  }

  // 4. App's variant: Lat:X Long:Y  (space-separated)
  const spaceFormat = text.match(
    /Lat:\s*(-?\d+(?:\.\d+)?)\s+Long:\s*(-?\d+(?:\.\d+)?)/i
  );
  if (spaceFormat) {
    const r = tryReturn(
      parseFloat(spaceFormat[1]),
      parseFloat(spaceFormat[2])
    );
    if (r) return r;
  }

  // 5. Legacy: Latitude X, Longitude Y
  const legacyFormat = text.match(
    /Latitude\s*:?\s*(-?\d+(?:\.\d+)?)[,\s]+Longitude\s*:?\s*(-?\d+(?:\.\d+)?)/i
  );
  if (legacyFormat) {
    const r = tryReturn(
      parseFloat(legacyFormat[1]),
      parseFloat(legacyFormat[2])
    );
    if (r) return r;
  }

  // 6. Plain pair somewhere in text: "10.258847, 123.711452" with 5-8 decimals
  const plainPair = text.match(
    /(-?\d{1,2}\.\d{4,10})\s*,\s*(-?\d{1,3}\.\d{4,10})/
  );
  if (plainPair) {
    const r = tryReturn(parseFloat(plainPair[1]), parseFloat(plainPair[2]));
    if (r) return r;
  }

  return null;
}

// ============================================================
// ✅ HELPER: Extract address from SMS text
// ============================================================
function parseSMSAddress(text: string): string | null {
  if (!text) return null;

  // 1. Structured tag: ADDRESS:...
  const addrTag = text.match(/ADDRESS:\s*(.+?)(?:\n|ACCURACY:|MAP:|COORDS:|$)/i);
  if (addrTag) {
    const a = addrTag[1].trim();
    if (a && a.toLowerCase() !== 'not resolved' && a.length > 2) {
      return a;
    }
  }

  // 2. Legacy: "📍 Address: ..."
  const addrLegacy = text.match(/📍\s*Address:\s*(.+?)(?:\n|$)/i);
  if (addrLegacy) {
    const a = addrLegacy[1].trim();
    // Guard against coordinate-looking strings
    if (a && a.length > 2 && !/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(a)) {
      return a;
    }
  }

  return null;
}

// ✅ Normalize incident type for clean dashboard display
function normalizeIncidentType(raw?: string, specific?: string | null): string {
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

// ✅ Fix for default marker icons in Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const PIN_COLOR = '#ef4444';

// ✅ Red map pin (white outline + ring).
// Created ONCE so the spawn animation only plays when a marker first
// appears, not every time the map re-renders.
const PIN_ICON = L.divIcon({
  className: 'custom-pin-marker',
  html: `
    <div class="pin-wrap">
      <svg class="pin-svg" viewBox="0 0 32 44" width="32" height="44" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 2C8.8 2 3 7.8 3 15c0 9.5 13 27 13 27s13-17.5 13-27C29 7.8 23.2 2 16 2z"
              fill="${PIN_COLOR}" stroke="#ffffff" stroke-width="2.5"/>
        <circle cx="16" cy="15" r="5" fill="${PIN_COLOR}" stroke="#ffffff" stroke-width="2.5"/>
      </svg>
    </div>
  `,
  iconSize: [32, 44],
  iconAnchor: [16, 44], // tip of the pin sits exactly on the coordinate
  popupAnchor: [0, -40],
});

// ✅ Pin styles (injected once so no CSS file edit is required)
const PIN_STYLE_ID = 'incident-intake-pin-styles';
const ensurePinStyles = () => {
  if (typeof document === 'undefined') return;
  if (document.getElementById(PIN_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PIN_STYLE_ID;
  style.textContent = `
    .custom-pin-marker { background: none !important; border: none !important; }

    .pin-wrap { position: relative; width: 32px; height: 44px; }

    /* Spawn: pin drops in and bounces (plays once when the marker appears) */
    .pin-svg {
      display: block;
      transform-origin: 50% 100%;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.35));
      transition: transform 0.2s ease;
      animation: pinSpawn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
    }
    .custom-pin-marker:hover .pin-svg { transform: scale(1.2); }

    @keyframes pinSpawn {
      0%   { transform: translateY(-40px) scale(0.6); opacity: 0; }
      60%  { opacity: 1; }
      100% { transform: translateY(0) scale(1); opacity: 1; }
    }
  `;
  document.head.appendChild(style);
};

// ✅ Water drop pulse ring overlay
const createPulseRing = (color: string) => {
  return L.divIcon({
    className: 'pulse-ring-marker',
    html: `
      <div class="pulse-ring-container">
        <div class="pulse-ring wave-1" style="border-color: ${color};"></div>
        <div class="pulse-ring wave-2" style="border-color: ${color};"></div>
        <div class="pulse-ring wave-3" style="border-color: ${color};"></div>
      </div>
    `,
    iconSize: [60, 60],
    iconAnchor: [30, 30],
  });
};

interface IncidentMarker {
  id: number;
  lat: number;
  lng: number;
  title: string;
  type: string;
  severity: 'high' | 'medium' | 'low';
  description?: string;
  time?: string;
}

interface NearbyPlace {
  name: string;
  lat: number;
  lng: number;
  type: string;
  vicinity?: string;
}

interface IncidentQueueItem {
  id: string;
  incidentId: string;
  type: string;
  specificType?: string | null;
  location: string;
  reportedAt: string;
  priority: 'high' | 'medium' | 'low';
  source: string;
  status: 'review' | 'verified' | 'dispatched' | 'resolved' | 'duplicate';
  reporter: {
    fullName: string;
    phoneNumber: string;
  };
  description: string;
  lat: number;
  lng: number;
  address: string;
  photoUrl?: string | null;
  hasPhoto?: boolean;
  firebaseId?: string;
  duplicateOf?: string;
  isDeleted?: boolean;
  casualties?: {
    injured: number;
    fatalities: number;
    trapped: number;
  };
}

// ✅ Convert a Firestore incident_queue document into a queue item
const mapQueueDoc = (docId: string, data: any): IncidentQueueItem => ({
  id: docId,
  incidentId: data.incidentId || docId,
  type: data.type || 'Unknown',
  specificType: data.specificType || null,
  location: data.location || 'Unknown location',
  reportedAt: data.reportedAt || new Date().toLocaleString(),
  priority: data.priority || 'medium',
  source: data.source || 'Mobile App',
  status: data.status || 'review',
  reporter: data.reporter || { fullName: 'Unknown', phoneNumber: 'N/A' },
  description: data.description || 'No description provided',
  lat: typeof data.lat === 'number' ? data.lat : (null as any),
  lng: typeof data.lng === 'number' ? data.lng : (null as any),
  address: data.address || data.location || 'Unknown location',
  photoUrl: data.photoUrl || null,
  hasPhoto: data.hasPhoto || false,
  firebaseId: docId,
  duplicateOf: data.duplicateOf || '',
  isDeleted: data.isDeleted || false,
  casualties: data.casualties || {
    injured: 0,
    fatalities: 0,
    trapped: 0,
  },
});

interface GoogleMapProps {
  incidents?: IncidentMarker[];
  center?: { lat: number; lng: number };
  zoom?: number;
  nearbyPlaces?: NearbyPlace[];
}

// ✅ Leaflet Map Component
const GoogleMap: React.FC<GoogleMapProps> = ({
  incidents = [],
  center = { lat: 14.5995, lng: 120.9842 },
  zoom = 13,
  nearbyPlaces = [],
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const pulseMarkersRef = useRef<L.Marker[]>([]);
  const nearbyMarkersRef = useRef<(L.Marker | L.CircleMarker)[]>([]);
  const [, setCurrentLayer] = useState<string>('street');

  // Make sure the pin styles exist
  useEffect(() => {
    ensurePinStyles();
  }, []);

  const defaultIncidents: IncidentMarker[] = [
    {
      id: 1,
      lat: 14.5995,
      lng: 120.9842,
      title: '🔥 Fire Incident',
      type: 'Fire',
      severity: 'high',
      description: 'Structural fire at residential building - evacuation in progress',
      time: '10:30 AM',
    },
    {
      id: 2,
      lat: 14.6012,
      lng: 120.9825,
      title: '🚗 Traffic Accident',
      type: 'Accident',
      severity: 'medium',
      description: 'Multi-vehicle collision on main highway',
      time: '11:15 AM',
    },
    {
      id: 3,
      lat: 14.5978,
      lng: 120.9856,
      title: '🏥 Medical Emergency',
      type: 'Medical',
      severity: 'high',
      description: 'Mass casualty event at shopping mall',
      time: '9:45 AM',
    },
  ];

  const [allIncidents, setAllIncidents] = useState<IncidentMarker[]>(defaultIncidents);
  const [mapCenter, setMapCenter] = useState(center);
  const [allNearbyPlaces, setAllNearbyPlaces] = useState<NearbyPlace[]>(nearbyPlaces);

  useEffect(() => {
    if (incidents.length > 0) {
      setAllIncidents(incidents);
      if (incidents[0].lat && incidents[0].lng) {
        setMapCenter({ lat: incidents[0].lat, lng: incidents[0].lng });
      }
    } else {
      setAllIncidents(defaultIncidents);
      setMapCenter(center);
    }
  }, [incidents]);

  useEffect(() => {
    if (nearbyPlaces.length > 0) {
      setAllNearbyPlaces(nearbyPlaces);
    }
  }, [nearbyPlaces]);

  const displayIncidents = allIncidents;
  const displayNearbyPlaces = allNearbyPlaces;

  const getPlaceIcon = (type: string): string => {
    const iconMap: { [key: string]: string } = {
      'school': '🏫',
      'store': '🏪',
      'restaurant': '🍽️',
      'hospital': '🏥',
      'church': '⛪',
      'bank': '🏦',
      'gas_station': '⛽',
      'park': '🌳',
      'mall': '🏬',
      'hotel': '🏨',
      'pharmacy': '💊',
      'police': '👮',
      'fire_station': '🚒',
      'default': '📍'
    };
    return iconMap[type] || iconMap['default'];
  };

  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;

    leafletMap.current = L.map(mapRef.current, {
      center: [mapCenter.lat, mapCenter.lng],
      zoom: zoom,
      zoomControl: true,
      fadeAnimation: true,
      zoomAnimation: true,
    });

    const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    });

    const satelliteLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: '© ESRI',
        maxZoom: 19,
      }
    );

    streetLayer.addTo(leafletMap.current);

    const baseLayers = {
      'Street Map': streetLayer,
      'Satellite': satelliteLayer,
    };

    L.control.layers(baseLayers).addTo(leafletMap.current);

    L.control.zoom({ position: 'topright' }).addTo(leafletMap.current);

    leafletMap.current.on('baselayerchange', (e) => {
      setCurrentLayer(e.name === 'Satellite' ? 'satellite' : 'street');
    });

    return () => {
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (leafletMap.current) {
      leafletMap.current.setView([mapCenter.lat, mapCenter.lng], zoom);
    }
  }, [mapCenter]);

  useEffect(() => {
    if (!leafletMap.current) return;

    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];
    pulseMarkersRef.current.forEach(marker => marker.remove());
    pulseMarkersRef.current = [];
    nearbyMarkersRef.current.forEach(marker => marker.remove());
    nearbyMarkersRef.current = [];

    displayIncidents.forEach((incident) => {
      // ✅ Red map pin (hover grow handled by CSS)
      const marker = L.marker([incident.lat, incident.lng], {
        icon: PIN_ICON,
        riseOnHover: true,
      })
        .addTo(leafletMap.current!)
        .bindPopup(`
          <div style="min-width:220px; max-width:320px; padding: 8px;">
            <h4 style="margin:0 0 8px 0; color:#EF4444;">${incident.title}</h4>
            <p style="margin:4px 0;"><b>Type:</b> ${incident.type}</p>
            <p style="margin:4px 0;"><b>Severity:</b> ${incident.severity.toUpperCase()}</p>
            <p style="margin:4px 0;"><b>Time:</b> ${incident.time || 'Just now'}</p>
            <p style="margin:4px 0; color:#666; font-size:12px;">${incident.description || ''}</p>

            <div class="popup-location-details">
              <div class="detail-row">
                <i class="fa fa-road"></i>
                <span class="label">Street:</span>
                <span class="value">${incident.type === 'Fire' ? 'Rizal Street' : incident.type === 'Accident' ? 'Main Highway' : '5th Avenue'}</span>
              </div>
              <div class="detail-row">
                <i class="fa fa-map-pin"></i>
                <span class="label">Barangay:</span>
                <span class="value">San Roque</span>
              </div>
              <div class="detail-row">
                <i class="fa fa-building"></i>
                <span class="label">Landmark:</span>
                <span class="value">${incident.type === 'Fire' ? 'Near City Hall' : incident.type === 'Accident' ? 'Near Shopping Mall' : 'Near Hospital'}</span>
              </div>
              <div class="popup-road">
                <i class="fa fa-location-dot"></i> ${incident.lat.toFixed(6)}, ${incident.lng.toFixed(6)}
              </div>
            </div>

            ${displayNearbyPlaces.length > 0 ? `
              <div class="popup-nearby">
                <div class="nearby-title">📍 Nearby Landmarks:</div>
                ${displayNearbyPlaces.slice(0, 5).map(place => `
                  <div class="nearby-item">
                    <span>${getPlaceIcon(place.type)}</span>
                    <span>${place.name}</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        `);

      markersRef.current.push(marker);

      // ✅ Red pulse ring at the pin tip
      const pulseIcon = createPulseRing(PIN_COLOR);
      const pulseMarker = L.marker([incident.lat, incident.lng], {
        icon: pulseIcon,
        zIndexOffset: -100,
        interactive: false,
      }).addTo(leafletMap.current!);

      pulseMarkersRef.current.push(pulseMarker);
    });

    displayNearbyPlaces.forEach((place) => {
      const marker = L.circleMarker([place.lat, place.lng], {
        radius: 5,
        fillColor: '#6B7280',
        color: '#9CA3AF',
        weight: 1,
        fillOpacity: 0.7,
      })
        .addTo(leafletMap.current!)
        .bindPopup(`
          <div style="padding:8px; min-width:150px;">
            <p style="margin:0; font-weight:600; font-size:13px; color:#1F2937;">
              ${getPlaceIcon(place.type)} ${place.name}
            </p>
            <p style="margin:2px 0; font-size:11px; color:#6B7280;">
              ${place.type.charAt(0).toUpperCase() + place.type.slice(1)}
            </p>
            ${place.vicinity ? `<p style="margin:2px 0; font-size:10px; color:#9CA3AF;">${place.vicinity}</p>` : ''}
          </div>
        `);

      nearbyMarkersRef.current.push(marker);
    });

    if (markersRef.current.length > 0) {
      const bounds = L.latLngBounds(
        markersRef.current.map(m => m.getLatLng())
      );
      leafletMap.current.fitBounds(bounds, { padding: [50, 50] });
    }

  }, [displayIncidents, displayNearbyPlaces]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        ref={mapRef}
        style={{
          width: '100%',
          height: '100%',
          borderRadius: '0',
          position: 'relative',
          zIndex: 1,
        }}
      />
    </div>
  );
};

// ============================================
// INCIDENT INTAKE COMPONENT
// ============================================

interface IncidentIntakeProps {
  onNavigateToDispatch?: () => void;
}

const IncidentIntake: React.FC<IncidentIntakeProps> = ({ onNavigateToDispatch }) => {
  const [selectedIncident, setSelectedIncident] = useState<any>(null);
  const [mapIncidents, setMapIncidents] = useState<IncidentMarker[]>([]);
  const [mapCenter, setMapCenter] = useState({ lat: 14.5995, lng: 120.9842 });
  const [nearbyPlaces, setNearbyPlaces] = useState<NearbyPlace[]>([]);

  const [incidentQueue, setIncidentQueue] = useState<IncidentQueueItem[]>([]);
  const [selectedQueueItem, setSelectedQueueItem] = useState<IncidentQueueItem | null>(null);

  const [notificationTick, setNotificationTick] = useState(0);

  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);

  const processedNotifications = useRef<Set<string>>(new Set());
  const pendingNotifications = useRef<Set<string>>(new Set());
  const processedSmsIds = useRef<Set<string>>(new Set());

  // ✅ Always-current copy of the queue (readable from async code / old closures)
  const incidentQueueRef = useRef<IncidentQueueItem[]>([]);
  incidentQueueRef.current = incidentQueue;

  // ✅ Track already-logged queue items so we don't spam the dashboard
  const loggedQueueIdsRef = useRef<Set<string>>(new Set());
  const isFirstQueueSnapshotRef = useRef(true);

  const closePhotoViewer = () => {
    setSelectedPhoto(null);
  };

  const updateResponderStatus = async (incidentId: string, status: 'submitted' | 'dispatched' | 'enroute' | 'arrived' | 'resolved') => {
    try {
      console.log(`🔍 Looking for incident_reports with incidentId: ${incidentId}`);

      const reportsRef = collection(firestore, 'incident_reports');
      const q = query(reportsRef, where('incidentId', '==', incidentId));
      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        const docRef = doc(firestore, 'incident_reports', querySnapshot.docs[0].id);
        const updateData: any = {
          status: status,
          updatedAt: serverTimestamp(),
        };

        if (status === 'dispatched') {
          updateData.dispatchedAt = serverTimestamp();
        } else if (status === 'enroute') {
          updateData.enRouteAt = serverTimestamp();
        } else if (status === 'arrived') {
          updateData.arrivedAt = serverTimestamp();
        } else if (status === 'resolved') {
          updateData.resolvedAt = serverTimestamp();
        }

        await updateDoc(docRef, updateData);
        console.log(`✅ Updated incident_reports status to ${status} for:`, incidentId);
        return true;
      } else {
        console.log(`⚠️ No incident_reports found for incidentId: ${incidentId}`);

        const queueItem = incidentQueue.find(item => item.incidentId === incidentId);
        if (queueItem) {
          console.log(`🔄 Creating incident_reports from queue data for:`, incidentId);

          const newReportRef = doc(collection(firestore, 'incident_reports'));
          const reportData = {
            incidentId: incidentId,
            incidentType: queueItem.type || 'Unknown',
            specificType: queueItem.specificType || null,
            location: {
              address: queueItem.address || queueItem.location || 'Unknown location',
              coordinates: {
                latitude: queueItem.lat ?? null,
                longitude: queueItem.lng ?? null,
              }
            },
            description: queueItem.description || 'No description provided',
            reporter: queueItem.reporter || { fullName: 'Unknown', phoneNumber: 'N/A' },
            casualties: queueItem.casualties || {
              injured: 0,
              fatalities: 0,
              trapped: 0
            },
            status: status,
            submittedAt: queueItem.reportedAt || new Date().toISOString(),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            dispatchedAt: status === 'dispatched' ? serverTimestamp() : null,
            enRouteAt: status === 'enroute' ? serverTimestamp() : null,
            photoUrl: queueItem.photoUrl || null,
            hasPhoto: queueItem.hasPhoto || false,
            userId: 'eoc-user',
            isAnonymous: false,
            eta: '10-15 minutes',
            responder: queueItem.type === 'Fire' ? 'Bureau of Fire Protection' :
                       queueItem.type === 'Medical' ? 'Emergency Medical Services' :
                       queueItem.type === 'Flood' ? 'Disaster Response Team' :
                       queueItem.type === 'Crime' ? 'Philippine National Police' :
                       queueItem.type === 'Accident' ? 'Emergency Medical Services' :
                       'CDRRMO Response Team',
          };

          await setDoc(newReportRef, reportData);
          console.log(`✅ Created new incident_reports with status ${status} for:`, incidentId);
          return true;
        }
        return false;
      }
    } catch (error) {
      console.error('Error updating responder status:', error);
      return false;
    }
  };

  // ✅ Send "forwarded to dispatch" notification to the reporter
  const sendForwardedNotification = async (
    userId: string,
    reportId: string,
    incidentType: string
  ) => {
    try {
      const userNotificationsRef = collection(firestore, 'user_notifications');
      await addDoc(userNotificationsRef, {
        userId: userId,
        reportId: reportId,
        title: '🚑 Report Forwarded to Dispatch',
        message: `Your emergency report #${reportId} has been forwarded to dispatch.`,
        incidentType: incidentType,
        read: false,
        createdAt: serverTimestamp(),
        type: 'dispatch',
      });
      console.log('✅ Forwarded-to-dispatch notification sent to user:', userId);
    } catch (error) {
      console.error('Error sending forwarded notification:', error);
    }
  };

  useEffect(() => {
    const incidentsRef = collection(firestore, 'incident_queue');
    const q = query(incidentsRef, orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const firebaseIncidents: IncidentQueueItem[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.isDeleted === true) {
          return;
        }

        firebaseIncidents.push({
          id: doc.id,
          incidentId: data.incidentId || doc.id,
          type: data.type || 'Unknown',
          specificType: data.specificType || null,
          location: data.location || 'Unknown location',
          reportedAt: data.reportedAt || new Date().toLocaleString(),
          priority: data.priority || 'medium',
          source: data.source || 'Mobile App',
          status: data.status || 'review',
          reporter: data.reporter || { fullName: 'Unknown', phoneNumber: 'N/A' },
          description: data.description || 'No description provided',
          lat: typeof data.lat === 'number' ? data.lat : null,
          lng: typeof data.lng === 'number' ? data.lng : null,
          address: data.address || data.location || 'Unknown location',
          photoUrl: data.photoUrl || null,
          hasPhoto: data.hasPhoto || false,
          firebaseId: doc.id,
          duplicateOf: data.duplicateOf || '',
          isDeleted: data.isDeleted || false,
          casualties: data.casualties || {
            injured: 0,
            fatalities: 0,
            trapped: 0
          },
        } as any);
      });

      setIncidentQueue(firebaseIncidents);

      // ✅ Log NEW queue items to the Dashboard activity feed
      if (isFirstQueueSnapshotRef.current) {
        firebaseIncidents.forEach((r) => loggedQueueIdsRef.current.add(r.id));
        isFirstQueueSnapshotRef.current = false;
      } else {
        firebaseIncidents.forEach((r) => {
          if (!loggedQueueIdsRef.current.has(r.id)) {
            loggedQueueIdsRef.current.add(r.id);
            const type = normalizeIncidentType(r.type, r.specificType);
            logActivity({
              icon: 'alert-triangle',
              tone: r.priority === 'high' ? 'clay' : 'gold',
              title: `${type} Incident Report`,
              meta: `Type: ${type} at ${r.address || r.location} — reported by ${r.reporter?.fullName || 'Unknown'}`,
            });
          }
        });
      }

      if (firebaseIncidents.length > 0) {
        const savedSelectedId = localStorage.getItem('selectedIncidentId');
        let selectedItem = null;

        if (savedSelectedId) {
          selectedItem = firebaseIncidents.find(item => item.id === savedSelectedId);
        }

        if (!selectedItem) {
          selectedItem = firebaseIncidents[0];
          if (selectedItem) {
            localStorage.setItem('selectedIncidentId', selectedItem.id);
          }
        }

        if (selectedItem && selectedItem.id !== selectedQueueItem?.id) {
          setSelectedQueueItem(selectedItem);
          loadIncidentToDetails(selectedItem);
        }
      } else {
        setSelectedQueueItem(null);
        setSelectedIncident(null);
        localStorage.removeItem('selectedIncidentId');
      }

    }, (error) => {
      console.error('Error listening to incident queue:', error);
    });

    return () => unsubscribe();
  }, []);

  const extractCoordinatesFromAddress = (address: string): { lat: number; lng: number } | null => {
    const coordPattern = /(\d+\.\d+)\s*[°\s]*[NnSs]?\s*[,，]\s*(\d+\.\d+)\s*[°\s]*[EeWw]?/;
    const match = address.match(coordPattern);
    if (match) {
      return {
        lat: parseFloat(match[1]),
        lng: parseFloat(match[2])
      };
    }

    const decimalPattern = /(\d+\.\d+)\s*[,，]\s*(\d+\.\d+)/;
    const decimalMatch = address.match(decimalPattern);
    if (decimalMatch) {
      return {
        lat: parseFloat(decimalMatch[1]),
        lng: parseFloat(decimalMatch[2])
      };
    }

    return null;
  };

  const geocodeAddress = (address: string): Promise<{ lat: number; lng: number } | null> => {
    return new Promise((resolve) => {
      if (!address) {
        resolve(null);
        return;
      }

      const fullAddress = encodeURIComponent(address);
      fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${fullAddress}&limit=1`)
        .then(response => response.json())
        .then(data => {
          if (data && data.length > 0) {
            resolve({
              lat: parseFloat(data[0].lat),
              lng: parseFloat(data[0].lon)
            });
          } else {
            resolve(null);
          }
        })
        .catch(error => {
          console.error('Geocoding error:', error);
          resolve(null);
        });
    });
  };

  const searchNearbyPlaces = (lat: number, lng: number): Promise<NearbyPlace[]> => {
    return new Promise((resolve) => {
      const query = `
        [out:json];
        (
          node["amenity"](around:500,${lat},${lng});
          node["shop"](around:500,${lat},${lng});
          node["tourism"](around:500,${lat},${lng});
          node["leisure"](around:500,${lat},${lng});
          node["historic"](around:500,${lat},${lng});
          node["highway"](around:500,${lat},${lng});
          node["place"](around:500,${lat},${lng});
        );
        out body;
      `;

      fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: query,
      })
        .then(response => response.json())
        .then(data => {
          const places: NearbyPlace[] = [];
          if (data.elements) {
            data.elements.slice(0, 15).forEach((element: any) => {
              const tags = element.tags || {};
              const name = tags.name || 'Unnamed';
              let type = tags.amenity || tags.shop || tags.tourism || tags.leisure || tags.historic || tags.highway || tags.place || 'default';

              if (type === 'school' || tags.amenity === 'school') type = 'school';
              else if (type === 'hospital' || tags.amenity === 'hospital' || tags.amenity === 'clinic') type = 'hospital';
              else if (type === 'police' || tags.amenity === 'police') type = 'police';
              else if (type === 'fire_station' || tags.amenity === 'fire_station') type = 'fire_station';
              else if (type === 'restaurant' || tags.amenity === 'restaurant' || tags.amenity === 'cafe') type = 'restaurant';
              else if (type === 'bank' || tags.amenity === 'bank') type = 'bank';
              else if (type === 'pharmacy' || tags.amenity === 'pharmacy') type = 'pharmacy';
              else if (type === 'park' || tags.leisure === 'park') type = 'park';
              else if (type === 'church' || tags.amenity === 'place_of_worship') type = 'church';
              else if (type === 'mall' || tags.shop === 'mall') type = 'mall';
              else if (type === 'hotel' || tags.tourism === 'hotel') type = 'hotel';
              else if (type === 'gas_station' || tags.amenity === 'fuel') type = 'gas_station';
              else if (type === 'store' || tags.shop) type = 'store';

              places.push({
                name: name,
                lat: element.lat,
                lng: element.lon,
                type: type,
                vicinity: `${tags.city || ''} ${tags.street || ''} ${tags.barangay || ''}`.trim() || 'Nearby',
              });
            });
          }
          resolve(places);
        })
        .catch(error => {
          console.error('Error searching nearby places:', error);
          resolve([]);
        });
    });
  };

  const getIncidentCoordinates = async (incident: any): Promise<{ lat: number; lng: number } | null> => {
    if (incident.latitude && incident.longitude) {
      return { lat: incident.latitude, lng: incident.longitude };
    }

    if (incident.location?.coordinates) {
      const lat = incident.location.coordinates.latitude ?? incident.location.coordinates.lat;
      const lng = incident.location.coordinates.longitude ?? incident.location.coordinates.lng;
      if (lat != null && lng != null) return { lat, lng };
    }

    let addressString = '';
    if (incident.location?.address) {
      addressString = incident.location.address;
    } else if (incident.location) {
      addressString = typeof incident.location === 'string' ? incident.location : JSON.stringify(incident.location);
    }

    if (addressString) {
      const extractedCoords = extractCoordinatesFromAddress(addressString);
      if (extractedCoords) {
        return extractedCoords;
      }

      try {
        const geocoded = await geocodeAddress(addressString);
        if (geocoded) {
          return geocoded;
        }
      } catch (error) {
        console.error('Geocoding error:', error);
      }
    }

    return null;
  };

  const saveIncidentToFirebase = async (incidentData: any) => {
    try {
      const incidentsRef = collection(firestore, 'incident_queue');
      const docRef = await addDoc(incidentsRef, {
        ...incidentData,
        isDeleted: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return docRef.id;
    } catch (error) {
      console.error('Error saving incident to Firebase:', error);
      return null;
    }
  };

  const updateIncidentStatusInFirebase = async (firebaseId: string, status: 'review' | 'verified' | 'dispatched' | 'resolved' | 'duplicate', duplicateOf?: string) => {
    try {
      const incidentRef = doc(firestore, 'incident_queue', firebaseId);
      const updateData: any = {
        status: status,
        updatedAt: serverTimestamp(),
      };
      if (duplicateOf) {
        updateData.duplicateOf = duplicateOf;
      }
      await updateDoc(incidentRef, updateData);
      console.log(`✅ Updated incident_queue status to ${status} for:`, firebaseId);
    } catch (error) {
      console.error('Error updating incident status:', error);
    }
  };

  const addToIncidentQueue = async (incidentData: any) => {
    const incidentId = incidentData.id;

    const existingInQueue = incidentQueue.some(item => item.incidentId === incidentId && !item.isDeleted);

    if (existingInQueue) {
      console.log('⚠️ Incident already exists in queue:', incidentId);
      const existingItem = incidentQueue.find(item => item.incidentId === incidentId && !item.isDeleted);
      if (existingItem) {
        setSelectedQueueItem(existingItem);
        loadIncidentToDetails(existingItem);
        localStorage.setItem('selectedIncidentId', existingItem.id);
      }
      return;
    }

    try {
      const queueRef = collection(firestore, 'incident_queue');
      const q = query(queueRef, where('incidentId', '==', incidentId), where('isDeleted', '==', false));
      const snapshot = await getDocs(q);

      if (!snapshot.empty) {
        console.log('⚠️ Incident already exists in Firestore queue:', incidentId);
        const existingData = snapshot.docs[0].data();
        const existingItem: IncidentQueueItem = {
          id: snapshot.docs[0].id,
          incidentId: existingData.incidentId || incidentId,
          type: existingData.type || 'Unknown',
          specificType: existingData.specificType || null,
          location: existingData.location || 'Unknown location',
          reportedAt: existingData.reportedAt || new Date().toLocaleString(),
          priority: existingData.priority || 'medium',
          source: existingData.source || 'Mobile App',
          status: existingData.status || 'review',
          reporter: existingData.reporter || { fullName: 'Unknown', phoneNumber: 'N/A' },
          description: existingData.description || 'No description provided',
          lat: typeof existingData.lat === 'number' ? existingData.lat : null,
          lng: typeof existingData.lng === 'number' ? existingData.lng : null,
          address: existingData.address || existingData.location || 'Unknown location',
          photoUrl: existingData.photoUrl || null,
          hasPhoto: existingData.hasPhoto || false,
          firebaseId: snapshot.docs[0].id,
          duplicateOf: existingData.duplicateOf || '',
          isDeleted: existingData.isDeleted || false,
          casualties: existingData.casualties || {
            injured: 0,
            fatalities: 0,
            trapped: 0
          },
        } as any;
        setSelectedQueueItem(existingItem);
        loadIncidentToDetails(existingItem);
        localStorage.setItem('selectedIncidentId', existingItem.id);
        return;
      }
    } catch (error) {
      console.error('Error checking Firestore for duplicate:', error);
    }

    const newQueueItem: any = {
      incidentId: incidentData.id || `INC-${Date.now()}`,
      type: incidentData.type || 'Unknown',
      specificType: incidentData.specificType || null,
      location: incidentData.location?.address || incidentData.location || 'Unknown location',
      reportedAt: incidentData.time || new Date().toLocaleString(),
      priority: incidentData.severity || 'medium',
      source: incidentData.source || 'Mobile App',
      status: 'verified',
      reporter: incidentData.reporter || { fullName: 'Unknown', phoneNumber: 'N/A' },
      description: incidentData.description || 'No description provided',
      lat: incidentData.lat ?? null,
      lng: incidentData.lng ?? null,
      address: incidentData.location?.address || incidentData.location || 'Unknown location',
      photoUrl: incidentData.photoUrl || null,
      hasPhoto: incidentData.hasPhoto || false,
      casualties: incidentData.casualties || {
        injured: 0,
        fatalities: 0,
        trapped: 0
      },
      isDeleted: false,
    };

    const firebaseId = await saveIncidentToFirebase(newQueueItem);
    if (firebaseId) {
      newQueueItem.firebaseId = firebaseId;
      newQueueItem.id = firebaseId;
    }

    // ✅ Select the new incident RIGHT AWAY (before the slower incident_reports
    // write below) so the page switches to it immediately.
    setSelectedQueueItem(newQueueItem);
    loadIncidentToDetails(newQueueItem);
    localStorage.setItem('selectedIncidentId', newQueueItem.id);

    try {
      const reportsRef = collection(firestore, 'incident_reports');
      const newReportRef = doc(reportsRef);
      const reportData = {
        incidentId: newQueueItem.incidentId,
        incidentType: newQueueItem.type || 'Unknown',
        specificType: newQueueItem.specificType || null,
        location: {
          address: newQueueItem.address || newQueueItem.location || 'Unknown location',
          coordinates: {
            latitude: newQueueItem.lat ?? null,
            longitude: newQueueItem.lng ?? null,
          }
        },
        description: newQueueItem.description || 'No description provided',
        reporter: newQueueItem.reporter || { fullName: 'Unknown', phoneNumber: 'N/A' },
        casualties: newQueueItem.casualties || {
          injured: 0,
          fatalities: 0,
          trapped: 0
        },
        status: 'verified',
        submittedAt: newQueueItem.reportedAt || new Date().toISOString(),
        verifiedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        photoUrl: newQueueItem.photoUrl || null,
        hasPhoto: newQueueItem.hasPhoto || false,
        userId: 'eoc-user',
        isAnonymous: false,
        eta: '10-15 minutes',
        responder: newQueueItem.type === 'Fire' ? 'Bureau of Fire Protection' :
                   newQueueItem.type === 'Medical' ? 'Emergency Medical Services' :
                   newQueueItem.type === 'Flood' ? 'Disaster Response Team' :
                   newQueueItem.type === 'Crime' ? 'Philippine National Police' :
                   newQueueItem.type === 'Accident' ? 'Emergency Medical Services' :
                   'CDRRMO Response Team',
      };
      await setDoc(newReportRef, reportData);
      console.log(`✅ Created incident_reports (verified) for: ${newQueueItem.incidentId}`);

      // ✅ Log to activity feed: report verified
      const type = normalizeIncidentType(newQueueItem.type, newQueueItem.specificType);
      logActivity({
        icon: 'check-circle-2',
        tone: 'forest',
        title: 'Incident report verified',
        meta: `${type} at ${newQueueItem.address || newQueueItem.location} — verified by EOC`,
      });
    } catch (error) {
      console.error('Error creating incident_reports:', error);
    }
  };

  const handleStatusUpdate = async (itemId: string, newStatus: 'review' | 'verified' | 'dispatched' | 'resolved' | 'duplicate', duplicateOf?: string) => {
    const item = incidentQueue.find(i => i.id === itemId);
    if (item && item.firebaseId) {
      await updateIncidentStatusInFirebase(item.firebaseId, newStatus, duplicateOf);
    }

    setIncidentQueue(prev => {
      const updated = prev.map(item =>
        item.id === itemId ? { ...item, status: newStatus, duplicateOf: duplicateOf || item.duplicateOf } : item
      );
      return updated;
    });

    if (selectedQueueItem && selectedQueueItem.id === itemId) {
      const updatedItem = { ...selectedQueueItem, status: newStatus, duplicateOf: duplicateOf || selectedQueueItem.duplicateOf };
      setSelectedQueueItem(updatedItem);
      setSelectedIncident((prev: any) => ({
        ...prev,
        status: newStatus,
        duplicateOf: duplicateOf || prev.duplicateOf,
      }));
    }
  };

  const loadIncidentToDetails = (item: IncidentQueueItem) => {
    setSelectedQueueItem(item);

    const isSms = item.source === 'SMS';
    let smsDisplay: any = undefined;

    if (isSms) {
      const getEmojiForType = (t: string) => {
        switch (t) {
          case 'Flood': return '🌊';
          case 'Fire': return '🔥';
          case 'Medical': return '🚑';
          case 'Crime': return '🚨';
          case 'Accident': return '🚗';
          default: return '⚠️';
        }
      };

      smsDisplay = {
        sender: item.reporter?.fullName || 'Unknown',
        phoneNumber: item.reporter?.phoneNumber || 'N/A',
        emergencyType: item.type || 'Emergency',
        emergencyEmoji: getEmojiForType(item.type || 'Emergency'),
        messageText: item.description || 'No description provided',
        locationText: item.location || 'Unknown location',
        address: item.address || item.location || 'Unknown location',
        receivedTime: item.reportedAt || new Date().toLocaleString(),
        statusText: item.status === 'review' ? 'UNREAD' : 'READ',
        source: 'SMS',
      };
    }

    setSelectedIncident({
      id: item.incidentId,
      type: item.type,
      specificType: item.specificType || null,
      title: `${item.type} Incident Report`,
      reporter: item.reporter,
      location: { address: item.address },
      description: item.description,
      time: item.reportedAt,
      severity: item.priority,
      status: item.status,
      hasPhoto: item.hasPhoto,
      photoUrl: item.photoUrl,
      lat: item.lat,
      lng: item.lng,
      duplicateOf: item.duplicateOf,
      source: item.source,
      smsDisplay,
      casualties: item.casualties || {
        injured: 0,
        fatalities: 0,
        trapped: 0
      },
    });

    setMapIncidents([{
      id: 1,
      lat: item.lat,
      lng: item.lng,
      title: `${item.type} Incident`,
      type: item.type,
      severity: item.priority,
      description: item.description,
      time: item.reportedAt,
    }]);
    setMapCenter({ lat: item.lat, lng: item.lng });
  };

  // ✅ Select an incident that was ALREADY handled earlier (found by its incidentId).
  // This is what makes clicking a notification / SMS work while you are already
  // on this page: before, an already-processed one was silently ignored.
  const selectExistingIncident = async (incidentId: string): Promise<boolean> => {
    let item: IncidentQueueItem | undefined = incidentQueueRef.current.find(
      (i) => i.incidentId === incidentId && !i.isDeleted
    );

    // Not in the local list yet (snapshot may still be on its way) → ask Firestore
    if (!item) {
      try {
        const queueRef = collection(firestore, 'incident_queue');
        const q = query(
          queueRef,
          where('incidentId', '==', incidentId),
          where('isDeleted', '==', false)
        );
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
          item = mapQueueDoc(snapshot.docs[0].id, snapshot.docs[0].data());
        }
      } catch (error) {
        console.error('Error looking up existing incident:', error);
      }
    }

    if (!item) return false;

    console.log('↩️ Selecting already-processed incident:', incidentId);
    setSelectedQueueItem(item);
    loadIncidentToDetails(item);
    localStorage.setItem('selectedIncidentId', item.id);

    // Refresh the nearby landmarks so they match THIS incident
    if (typeof item.lat === 'number' && typeof item.lng === 'number') {
      searchNearbyPlaces(item.lat, item.lng)
        .then((places) => setNearbyPlaces(places))
        .catch(() => setNearbyPlaces([]));
    } else {
      setNearbyPlaces([]);
    }

    return true;
  };

  const handleForwardToDispatch = async () => {
    if (!selectedQueueItem) {
      alert('No incident selected.');
      return;
    }

    if (selectedQueueItem.status === 'resolved') {
      alert('This incident is already resolved.');
      return;
    }
    if (selectedQueueItem.status === 'duplicate') {
      alert('This incident is marked as duplicate.');
      return;
    }
    if (selectedQueueItem.status === 'dispatched') {
      alert('This incident is already dispatched.');
      return;
    }

    if (selectedQueueItem.status !== 'verified') {
      alert('⚠️ Please verify the incident first before forwarding to dispatch.');
      return;
    }

    try {
      console.log(`🔍 Forwarding incident: ${selectedQueueItem.incidentId}`);

      await handleStatusUpdate(selectedQueueItem.id, 'dispatched');

      const updated = await updateResponderStatus(selectedQueueItem.incidentId, 'dispatched');

      if (!updated) {
        console.warn(`⚠️ Failed to update responder status for: ${selectedQueueItem.incidentId}`);
      } else {
        console.log(`✅ Incident ${selectedQueueItem.incidentId} forwarded and responder status set to dispatched`);
      }

      const updatedItem = incidentQueue.find(i => i.id === selectedQueueItem.id) || selectedQueueItem;

      const forwardedData = {
        id: updatedItem.incidentId,
        type: updatedItem.type,
        specificType: updatedItem.specificType || null,
        location: updatedItem.location,
        date: new Date().toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        }),
        time: updatedItem.reportedAt,
        status: 'Waiting',
        description: updatedItem.description,
        verifiedBy: 'EOC Intake Officer',
        forwardedBy: 'EOC Intake Officer',
        forwardedTime: new Date().toLocaleString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        }),
        photos: updatedItem.photoUrl ? [updatedItem.photoUrl] : [],
        lat: updatedItem.lat ?? null,
        lng: updatedItem.lng ?? null,
        address: updatedItem.address || updatedItem.location || 'Unknown location',
        reporter: updatedItem.reporter || { fullName: 'Unknown', phoneNumber: 'N/A' },
        source: updatedItem.source || 'Mobile App',
        photoUrl: updatedItem.photoUrl || null,
        hasPhoto: updatedItem.hasPhoto || false,
        casualties: updatedItem.casualties || {
          injured: 0,
          fatalities: 0,
          trapped: 0
        },
      };

      console.log('📤 Forwarding incident data:', forwardedData);

      const forwardedRef = collection(firestore, 'forwarded_incidents');
      const docRef = await addDoc(forwardedRef, {
        ...forwardedData,
        createdAt: serverTimestamp(),
      });

      console.log('✅ Successfully forwarded to Firebase with ID:', docRef.id);

      // ✅ Log to activity feed: report forwarded to dispatch
      const type = normalizeIncidentType(updatedItem.type, updatedItem.specificType);
      logActivity({
        icon: 'send',
        tone: 'gold',
        title: 'Report forwarded to dispatch',
        meta: `${type} at ${forwardedData.address} — forwarded by EOC`,
      });

      alert(`✅ Incident ${forwardedData.id} has been forwarded to Dispatch.`);

      // ✅ Send "forwarded to dispatch" notification to the REAL reporter
      try {
        const reportsRef = collection(firestore, 'incident_reports');
        const allReports = await getDocs(reportsRef);
        let userId: string | null = null;

        allReports.forEach((d) => {
          const data = d.data();
          const matchesId =
            d.id === forwardedData.id ||
            data.incidentId === forwardedData.id ||
            data.reportId === forwardedData.id;

          if (matchesId) {
            if (data.userId && data.userId !== 'eoc-user') {
              userId = data.userId;
            }
          }
        });

        if (userId) {
          await sendForwardedNotification(
            userId,
            forwardedData.id,
            forwardedData.type
          );
          console.log('✅ Notification sent to reporter userId:', userId);

          await sendPushToUser(
            userId,
            '🚑 Report Forwarded to Dispatch',
            `Your emergency report #${forwardedData.id} has been forwarded to dispatch.`,
            { reportId: forwardedData.id, type: 'dispatch' }
          );
        } else {
          console.warn(
            '⚠️ No real reporter userId found (all matches were "eoc-user") for:',
            forwardedData.id
          );
        }
      } catch (notifError) {
        console.error('Error sending forwarded notification:', notifError);
      }

      if (onNavigateToDispatch) {
        console.log('🔄 Navigating to Dispatch Responder...');
        onNavigateToDispatch();
      } else {
        console.warn('⚠️ No navigation callback provided. Using fallback.');
        window.location.href = '/dispatch-responder';
      }

    } catch (error: any) {
      console.error('❌ Error forwarding incident:', error);

      let errorMessage = '❌ Failed to forward incident. ';

      if (error.code === 'permission-denied') {
        errorMessage += 'Permission denied. Please check your Firebase security rules.';
      } else if (error.code === 'not-found') {
        errorMessage += 'Collection not found. It will be created automatically when you save.';
      } else if (error.message) {
        errorMessage += error.message;
      } else {
        errorMessage += 'Please check your Firebase configuration and try again.';
      }

      alert(errorMessage);
    }
  };

  // (kept for internal use, button removed from UI)
  const handleMarkAsDuplicate = async () => {
    if (!selectedQueueItem) return;

    if (selectedQueueItem.status === 'resolved') {
      alert('This incident is already resolved.');
      return;
    }

    if (selectedQueueItem.status === 'duplicate') {
      alert('This incident is already marked as duplicate.');
      return;
    }

    if (selectedQueueItem.status === 'verified' || selectedQueueItem.status === 'dispatched') {
      alert('⚠️ Cannot mark as duplicate. This incident has already been verified or dispatched.');
      return;
    }

    const otherIncidents = incidentQueue.filter(
      item => item.id !== selectedQueueItem.id && item.status !== 'duplicate'
    );

    if (otherIncidents.length === 0) {
      alert('No other incidents available to mark as duplicate.');
      return;
    }

    const incidentOptions = otherIncidents.map((item, index) =>
      `${index + 1}. ${item.incidentId} - ${item.type} (${item.status})`
    ).join('\n');

    const selectedIndex = prompt(
      `Select which incident this is a duplicate of:\n\n${incidentOptions}\n\nEnter the number:`,
      '1'
    );

    if (selectedIndex !== null) {
      const index = parseInt(selectedIndex) - 1;
      if (index >= 0 && index < otherIncidents.length) {
        const duplicateOf = otherIncidents[index].incidentId;
        await handleStatusUpdate(selectedQueueItem.id, 'duplicate', duplicateOf);

        // ✅ Log to activity feed: marked as duplicate
        const type = normalizeIncidentType(selectedQueueItem.type, selectedQueueItem.specificType);
        logActivity({
          icon: 'copy',
          tone: 'clay',
          title: 'Incident marked as duplicate',
          meta: `${type} at ${selectedQueueItem.address || selectedQueueItem.location} — duplicate of ${duplicateOf}`,
        });
      } else {
        alert('Invalid selection.');
      }
    }
  };

  // Kept for internal use — not exposed in UI.
  void handleMarkAsDuplicate;

  useEffect(() => {
    const handler = () => setNotificationTick((t) => t + 1);
    window.addEventListener('newIncidentNotification', handler);
    return () => {
      window.removeEventListener('newIncidentNotification', handler);
    };
  }, []);

  useEffect(() => {
    const loadIncidentData = async () => {
      const smsDataRaw = sessionStorage.getItem('smsIncidentData');
      if (smsDataRaw) {
        sessionStorage.removeItem('smsIncidentData');

        try {
          const sms = JSON.parse(smsDataRaw);
          console.log('📱 Loading SMS incident data:', sms);

          const smsKey = `SMS-${(sms.phoneNumber || 'UNKNOWN').replace(/\s+/g, '')}-${sms.receivedTime || Date.now()}`;

          // ✅ FIX: this SMS was already handled earlier in this visit → don't just
          // ignore the click, SELECT its incident so the page switches to it.
          if (processedSmsIds.current.has(smsKey)) {
            console.log('🔁 SMS already processed in-session — selecting it:', smsKey);
            await selectExistingIncident(smsKey);
            return;
          }
          processedSmsIds.current.add(smsKey);

          let existingFirestoreItem: IncidentQueueItem | null = null;
          try {
            const queueRef = collection(firestore, 'incident_queue');
            const q = query(
              queueRef,
              where('incidentId', '==', smsKey),
              where('isDeleted', '==', false)
            );
            const snapshot = await getDocs(q);
            if (!snapshot.empty) {
              const data = snapshot.docs[0].data();
              existingFirestoreItem = {
                id: snapshot.docs[0].id,
                incidentId: data.incidentId || smsKey,
                type: data.type || 'Emergency',
                specificType: data.specificType || null,
                location: data.location || 'Unknown location',
                reportedAt: data.reportedAt || new Date().toLocaleString(),
                priority: data.priority || 'medium',
                source: data.source || 'SMS',
                status: data.status || 'review',
                reporter: data.reporter || {
                  fullName: sms.sender || 'Unknown',
                  phoneNumber: sms.phoneNumber || 'N/A',
                },
                description: data.description || 'No description provided',
                lat: typeof data.lat === 'number' ? data.lat : null,
                lng: typeof data.lng === 'number' ? data.lng : null,
                address: data.address || 'Unknown location',
                photoUrl: data.photoUrl || null,
                hasPhoto: data.hasPhoto || false,
                firebaseId: snapshot.docs[0].id,
                duplicateOf: data.duplicateOf || '',
                isDeleted: data.isDeleted || false,
                casualties: data.casualties || {
                  injured: 0,
                  fatalities: 0,
                  trapped: 0,
                },
              } as any;
            }
          } catch (err) {
            console.error('Error checking Firestore for existing SMS incident:', err);
          }

          if (existingFirestoreItem && existingFirestoreItem.status === 'review') {
            try {
              const docRef = doc(firestore, 'incident_queue', existingFirestoreItem.id);
              await updateDoc(docRef, {
                status: 'verified',
                updatedAt: serverTimestamp(),
              });
              existingFirestoreItem.status = 'verified';
              console.log('✅ Upgraded legacy SMS queue item to verified:', smsKey);
            } catch (err) {
              console.warn('Could not upgrade legacy SMS status:', err);
            }
          }

          if (existingFirestoreItem) {
            console.log('✅ SMS incident already exists in Firestore:', smsKey);
            setSelectedQueueItem(existingFirestoreItem);
            loadIncidentToDetails(existingFirestoreItem);
            localStorage.setItem('selectedIncidentId', existingFirestoreItem.id);
            return;
          }

          const existingLocal = incidentQueue.find(
            (item) => item.incidentId === smsKey && !item.isDeleted
          );
          if (existingLocal) {
            console.log('✅ SMS incident already in local queue:', smsKey);
            setSelectedQueueItem(existingLocal);
            loadIncidentToDetails(existingLocal);
            localStorage.setItem('selectedIncidentId', existingLocal.id);
            return;
          }

          // ✅ FIXED: Parse coordinates from SMS text with robust parser
          // Search across all the fields where the coords might live.
          const combinedText = [
            sms.locationText,
            sms.location,
            sms.address,
            sms.messageText,
            sms.description,
          ]
            .filter((s) => typeof s === 'string' && s.length > 0)
            .join('\n');

          const parsedCoords = parseSMSCoordinates(combinedText);
          const lat = parsedCoords?.lat ?? null;
          const lng = parsedCoords?.lng ?? null;

          // ✅ FIXED: Extract a real address (not coordinates) from the SMS
          const parsedAddress = parseSMSAddress(combinedText);
          const finalAddress =
            parsedAddress ||
            sms.address ||
            'Unknown location';

          const priorityMap: { [key: string]: 'high' | 'medium' | 'low' } = {
            HIGH: 'high',
            NORMAL: 'medium',
            LOW: 'low',
          };
          const mappedPriority =
            priorityMap[sms.priorityLabel] ||
            (sms.priority === 'high'
              ? 'high'
              : sms.priority === 'low'
              ? 'low'
              : 'medium');

          const smsQueueItem: any = {
            incidentId: smsKey,
            type: sms.emergencyType || sms.type || 'Emergency',
            specificType: sms.specificType || null,
            location: sms.locationText || sms.location || finalAddress,
            reportedAt: sms.receivedTime || new Date().toLocaleString(),
            priority: mappedPriority,
            source: 'SMS',
            status: 'verified',
            reporter: {
              fullName: sms.sender || sms.reporter?.fullName || 'Unknown',
              phoneNumber:
                sms.phoneNumber || sms.reporter?.phoneNumber || 'N/A',
            },
            description:
              sms.messageText || sms.description || 'No description provided',
            lat,   // ← may be null if SMS had no coords; that's intentional
            lng,   // ← may be null if SMS had no coords; that's intentional
            address: finalAddress,
            photoUrl: null,
            hasPhoto: false,
            casualties: { injured: 0, fatalities: 0, trapped: 0 },
            isDeleted: false,
          };

          const firebaseId = await saveIncidentToFirebase(smsQueueItem);

          if (firebaseId) {
            smsQueueItem.firebaseId = firebaseId;
            smsQueueItem.id = firebaseId;

            setSelectedQueueItem(smsQueueItem);
            loadIncidentToDetails(smsQueueItem);
            localStorage.setItem('selectedIncidentId', firebaseId);
          } else {
            smsQueueItem.id = `local-${Date.now()}`;
            setSelectedQueueItem(smsQueueItem);
            loadIncidentToDetails(smsQueueItem);
            localStorage.setItem('selectedIncidentId', smsQueueItem.id);
          }

          // ✅ Log SMS incident to dashboard
          const type = normalizeIncidentType(smsQueueItem.type, smsQueueItem.specificType);
          logActivity({
            icon: 'message-square',
            tone: 'gold',
            title: `${type} Incident Report`,
            meta: `Type: ${type} at ${smsQueueItem.address || smsQueueItem.location} — received via SMS from ${smsQueueItem.reporter.fullName}`,
          });

          try {
            const reportsRef = collection(firestore, 'incident_reports');
            const newReportRef = doc(reportsRef);
            const reportData = {
              incidentId: smsQueueItem.incidentId,
              incidentType: smsQueueItem.type || 'Emergency',
              specificType: smsQueueItem.specificType || null,
              location: {
                address: smsQueueItem.address || smsQueueItem.location || 'Unknown location',
                coordinates: {
                  latitude: smsQueueItem.lat ?? null,
                  longitude: smsQueueItem.lng ?? null,
                }
              },
              description: smsQueueItem.description || 'No description provided',
              reporter: smsQueueItem.reporter || { fullName: 'Unknown', phoneNumber: 'N/A' },
              casualties: smsQueueItem.casualties || {
                injured: 0,
                fatalities: 0,
                trapped: 0
              },
              status: 'verified',
              submittedAt: smsQueueItem.reportedAt || new Date().toISOString(),
              verifiedAt: serverTimestamp(),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              photoUrl: null,
              hasPhoto: false,
              userId: 'eoc-user',
              isAnonymous: false,
              eta: '10-15 minutes',
              responder: smsQueueItem.type === 'Fire' ? 'Bureau of Fire Protection' :
                         smsQueueItem.type === 'Medical' ? 'Emergency Medical Services' :
                         smsQueueItem.type === 'Flood' ? 'Disaster Response Team' :
                         smsQueueItem.type === 'Crime' ? 'Philippine National Police' :
                         smsQueueItem.type === 'Accident' ? 'Emergency Medical Services' :
                         'CDRRMO Response Team',
            };
            await setDoc(newReportRef, reportData);
            console.log(`✅ Created incident_reports (verified) for SMS: ${smsQueueItem.incidentId}`);
          } catch (error) {
            console.error('Error creating incident_reports for SMS:', error);
          }

          // ✅ Only search nearby places if we have valid coordinates
          if (lat != null && lng != null) {
            try {
              const places = await searchNearbyPlaces(lat, lng);
              setNearbyPlaces(places);
            } catch (err) {
              console.error('Error searching nearby places:', err);
            }
          } else {
            console.warn('⚠️ SMS had no valid coordinates — skipping nearby search');
            setNearbyPlaces([]);
          }

          return;
        } catch (error) {
          console.error('Error parsing SMS incident data:', error);
        }
      }

      const storedData = sessionStorage.getItem('selectedNotification');
      if (storedData) {
        try {
          const notification = JSON.parse(storedData);
          const notificationId =
            notification.reportId || notification.id || `notif-${Date.now()}`;

          // ✅ FIX: this notification was already handled earlier in this visit →
          // don't just ignore the click, SELECT its incident so the page switches to it.
          if (processedNotifications.current.has(notificationId)) {
            console.log('🔁 Notification already processed — selecting it:', notificationId);
            sessionStorage.removeItem('selectedNotification');
            await selectExistingIncident(notificationId);
            return;
          }

          if (pendingNotifications.current.has(notificationId)) {
            console.log(
              '⏳ Notification is currently being processed:',
              notificationId
            );
            return;
          }

          pendingNotifications.current.add(notificationId);

          const existingIncident = incidentQueue.find(
            (item) => item.incidentId === notificationId && !item.isDeleted
          );

          if (existingIncident) {
            console.log('⚠️ Incident already exists in queue:', notificationId);
            processedNotifications.current.add(notificationId);
            pendingNotifications.current.delete(notificationId);
            setSelectedQueueItem(existingIncident);
            loadIncidentToDetails(existingIncident);
            localStorage.setItem('selectedIncidentId', existingIncident.id);
            sessionStorage.removeItem('selectedNotification');
            return;
          }

          try {
            const queueRef = collection(firestore, 'incident_queue');
            const q = query(
              queueRef,
              where('incidentId', '==', notificationId),
              where('isDeleted', '==', false)
            );
            const snapshot = await getDocs(q);

            if (!snapshot.empty) {
              console.log(
                '⚠️ Incident already exists in Firestore queue:',
                notificationId
              );
              const existingData = snapshot.docs[0].data();
              const existingItem: IncidentQueueItem = {
                id: snapshot.docs[0].id,
                incidentId: existingData.incidentId || notificationId,
                type: existingData.type || 'Unknown',
                specificType: existingData.specificType || null,
                location: existingData.location || 'Unknown location',
                reportedAt:
                  existingData.reportedAt || new Date().toLocaleString(),
                priority: existingData.priority || 'medium',
                source: existingData.source || 'Mobile App',
                status: existingData.status || 'review',
                reporter: existingData.reporter || {
                  fullName: 'Unknown',
                  phoneNumber: 'N/A',
                },
                description:
                  existingData.description || 'No description provided',
                lat: typeof existingData.lat === 'number' ? existingData.lat : null,
                lng: typeof existingData.lng === 'number' ? existingData.lng : null,
                address:
                  existingData.address ||
                  existingData.location ||
                  'Unknown location',
                photoUrl: existingData.photoUrl || null,
                hasPhoto: existingData.hasPhoto || false,
                firebaseId: snapshot.docs[0].id,
                duplicateOf: existingData.duplicateOf || '',
                isDeleted: existingData.isDeleted || false,
                casualties: existingData.casualties || {
                  injured: 0,
                  fatalities: 0,
                  trapped: 0,
                },
              } as any;
              processedNotifications.current.add(notificationId);
              pendingNotifications.current.delete(notificationId);
              setSelectedQueueItem(existingItem);
              loadIncidentToDetails(existingItem);
              localStorage.setItem('selectedIncidentId', existingItem.id);
              sessionStorage.removeItem('selectedNotification');
              return;
            }
          } catch (error) {
            console.error(
              'Error checking Firestore for existing incident:',
              error
            );
          }

          const locationAddress =
            notification.location?.address ||
            notification.location ||
            'Unknown location';

          // ✅ FIXED: no more 14.5995, 120.9842 default
          let lat: number | null = null;
          let lng: number | null = null;

          const coords = await getIncidentCoordinates(notification);
          if (coords) {
            lat = coords.lat;
            lng = coords.lng;
          }

          // If still null, try parsing from raw text fields
          if (lat == null || lng == null) {
            const rawText = [
              locationAddress,
              notification.description,
              notification.messageText,
              notification.address,
            ]
              .filter((s) => typeof s === 'string' && s.length > 0)
              .join('\n');
            const parsed = parseSMSCoordinates(rawText);
            if (parsed) {
              lat = parsed.lat;
              lng = parsed.lng;
            }
          }

          const incidentData = {
            id: notificationId,
            type: notification.incidentType || 'Unknown',
            specificType: notification.specificType || null,
            title: `${notification.incidentType || 'Unknown'} Incident Report`,
            reporter: notification.reporter || {
              fullName: 'Unknown',
              phoneNumber: 'N/A',
            },
            location: notification.location || { address: locationAddress },
            description: notification.description || 'No description provided',
            time:
              notification.timestamp?.toDate?.().toLocaleString() ||
              new Date().toLocaleString(),
            severity:
              notification.priority === 'critical'
                ? 'high'
                : notification.priority === 'high'
                ? 'medium'
                : 'low',
            status: notification.status || 'pending',
            hasPhoto: notification.hasPhoto || false,
            photoUrl: notification.photoUrl || null,
            lat,  // ← may be null
            lng,  // ← may be null
            casualties: notification.casualties || {
              injured: 0,
              fatalities: 0,
              trapped: 0,
            },
          };

          processedNotifications.current.add(notificationId);
          await addToIncidentQueue(incidentData);
          pendingNotifications.current.delete(notificationId);

          if (lat != null && lng != null) {
            try {
              const places = await searchNearbyPlaces(lat, lng);
              setNearbyPlaces(places);
            } catch (error) {
              console.error('Error searching nearby places:', error);
            }
          } else {
            setNearbyPlaces([]);
          }

          sessionStorage.removeItem('selectedNotification');

          setTimeout(() => {
            const detailsCard = document.querySelector('.details-card');
            if (detailsCard) {
              detailsCard.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
              });
            }
          }, 500);
        } catch (error) {
          console.error('Error parsing notification data:', error);
          sessionStorage.removeItem('selectedNotification');
          try {
            const storedData = sessionStorage.getItem('selectedNotification');
            if (storedData) {
              const notification = JSON.parse(storedData);
              const notificationId =
                notification.reportId ||
                notification.id ||
                `notif-${Date.now()}`;
              pendingNotifications.current.delete(notificationId);
            }
          } catch (e) {
            // Ignore
          }
        }
      }
    };

    loadIncidentData();
  }, [incidentQueue, notificationTick]);

  const getCasualtiesText = (casualties: any) => {
    if (!casualties) return 'No casualties reported';
    const parts = [];
    if (casualties.injured > 0) parts.push(`👨‍⚕️ ${casualties.injured} Injured`);
    if (casualties.fatalities > 0) parts.push(`💀 ${casualties.fatalities} Fatalities`);
    if (casualties.trapped > 0) parts.push(`🚧 ${casualties.trapped} Trapped`);
    return parts.length > 0 ? parts.join(' • ') : 'No casualties reported';
  };

  const getDisplayTitle = (incident: any) => {
    if (
      incident?.type === 'Other' &&
      incident?.specificType &&
      String(incident.specificType).trim().length > 0
    ) {
      return `Others – ${incident.specificType} Incident Report`;
    }
    return incident?.title || `${incident?.type} Incident Report`;
  };

  const renderIncidentDetails = () => {
    const incident = selectedIncident || {
      id: 'No Incident Selected',
      type: 'N/A',
      specificType: null,
      title: 'No Incident Selected',
      reporter: { fullName: 'N/A', phoneNumber: 'N/A' },
      location: { address: 'No location available' },
      description: 'Click on a notification or select an incident from the queue to view details.',
      time: 'N/A',
      severity: 'low',
      status: 'review',
      hasPhoto: false,
      photoUrl: null,
      lat: null,
      lng: null,
      casualties: { injured: 0, fatalities: 0, trapped: 0 },
    };

    const getStatusBadge = (status: string) => {
      switch(status) {
        case 'review': return 'badge-orange';
        case 'verified': return 'badge-blue';
        case 'dispatched': return 'badge-indigo';
        case 'resolved': return 'badge-green';
        case 'duplicate': return 'badge-purple';
        default: return 'badge-gray';
      }
    };

    const getStatusLabel = (status: string) => {
      switch(status) {
        case 'review': return 'For Review';
        case 'verified': return 'Verified';
        case 'dispatched': return 'Dispatched';
        case 'resolved': return 'Resolved';
        case 'duplicate': return 'Duplicate';
        default: return 'For Review';
      }
    };

    const isSmsIncident = incident.source === 'SMS' && incident.smsDisplay;
    const isOtherType = incident.type === 'Other';

    const nearbyPlacesDisplay = nearbyPlaces.length > 0 ? (
      <div className="nearby-places-section">
        <div className="nearby-places-label">
          <i className="fa fa-location-dot"></i> Nearby Landmarks & Streets
        </div>
        <div className="nearby-places-list">
          {nearbyPlaces.slice(0, 8).map((place, index) => (
            <span key={`${place.name}-${index}`} className="nearby-place-tag">
              {place.name}
            </span>
          ))}
          {nearbyPlaces.length > 8 && (
            <span key="more-places" className="nearby-place-tag more">+{nearbyPlaces.length - 8} more</span>
          )}
        </div>
      </div>
    ) : null;

    return (
      <div className="details-card">
        <div className="card-header">
          <h5>Incident Information</h5>
        </div>

        <div className="incident-content">
          <div className="incident-type-header">
            <h4>{getDisplayTitle(incident)}</h4>
            <span className={`badge ${getStatusBadge(incident.status)}`}>
              {getStatusLabel(incident.status)}
            </span>
          </div>

          {(isSmsIncident || incident.duplicateOf) && (
            <div className="badges-row">
              {isSmsIncident && (
                <span className="badge" style={{
                  background: '#1E3A8A',
                  color: '#93C5FD',
                }}>
                  <i className="fa fa-mobile-alt"></i> SMS
                </span>
              )}
              {incident.duplicateOf && (
                <span className="badge badge-purple">
                  <i className="fa fa-copy"></i> Duplicate of {incident.duplicateOf}
                </span>
              )}
            </div>
          )}

          {isSmsIncident ? (
            <div
              className="sms-incident-details"
              style={{
                background: '#0F172A',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '12px',
                border: '1px solid #334155',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ color: '#94A3B8', fontSize: '0.75rem', fontWeight: 600, minWidth: '130px' }}>Sender:</span>
                  <span style={{ color: '#F8FAFC', fontSize: '0.85rem', fontWeight: 500 }}>
                    {incident.smsDisplay.sender}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ color: '#94A3B8', fontSize: '0.75rem', fontWeight: 600, minWidth: '130px' }}>Emergency Type:</span>
                  <span style={{ color: '#F8FAFC', fontSize: '0.85rem', fontWeight: 500 }}>
                    {incident.smsDisplay.emergencyEmoji} {incident.smsDisplay.emergencyType}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                  <span style={{ color: '#94A3B8', fontSize: '0.75rem', fontWeight: 600, minWidth: '130px' }}>Message:</span>
                  <span style={{ color: '#F8FAFC', fontSize: '0.85rem', fontWeight: 500, flex: 1 }}>
                    {incident.smsDisplay.messageText}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ color: '#94A3B8', fontSize: '0.75rem', fontWeight: 600, minWidth: '130px' }}>Location:</span>
                  <span style={{ color: '#93C5FD', fontSize: '0.85rem', fontWeight: 500 }}>
                    {incident.smsDisplay.locationText}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ color: '#94A3B8', fontSize: '0.75rem', fontWeight: 600, minWidth: '130px' }}>Address:</span>
                  <span style={{ color: '#F8FAFC', fontSize: '0.85rem', fontWeight: 500 }}>
                    {incident.smsDisplay.address}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ color: '#94A3B8', fontSize: '0.75rem', fontWeight: 600, minWidth: '130px' }}>Received:</span>
                  <span style={{ color: '#F8FAFC', fontSize: '0.85rem', fontWeight: 500 }}>
                    {incident.smsDisplay.receivedTime}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ color: '#94A3B8', fontSize: '0.75rem', fontWeight: 600, minWidth: '130px' }}>Status:</span>
                  <span style={{
                    color: incident.smsDisplay.statusText === 'READ' ? '#10B981' : '#F59E0B',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                  }}>
                    {incident.smsDisplay.statusText}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ color: '#94A3B8', fontSize: '0.75rem', fontWeight: 600, minWidth: '130px' }}>Source:</span>
                  <span style={{ color: '#F8FAFC', fontSize: '0.85rem', fontWeight: 500 }}>
                    <i className="fa fa-mobile-alt" style={{ marginRight: '4px', color: '#3B82F6' }}></i>
                    {incident.smsDisplay.source}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="info-grid">
              <div className="info-item">
                <span className="label">Reporter Name</span>
                <span className="value">{incident.reporter?.fullName || 'Unknown'}</span>
              </div>
              <div className="info-item">
                <span className="label">Contact Number</span>
                <span className="value">{incident.reporter?.phoneNumber || 'N/A'}</span>
              </div>
              <div className="info-item">
                <span className="label">Date & Time</span>
                <span className="value">{incident.time || 'Just now'}</span>
              </div>
              <div className="info-item">
                <span className="label">Source</span>
                <span className="value"><i className="fa fa-mobile-alt"></i> Mobile App</span>
              </div>
              <div className="info-item full-width">
                <span className="label">👥 Casualties</span>
                <span className="value" style={{ fontSize: '0.85rem' }}>
                  {getCasualtiesText(incident.casualties)}
                </span>
              </div>
              <div className="info-item full-width">
                <span className="label">Location</span>
                <span className="value">{incident.location?.address || 'Unknown location'}</span>
              </div>

              {isOtherType && incident.specificType && (
                <div className="info-item full-width">
                  <span className="label">🏷️ Specific Type</span>
                  <span className="value" style={{ color: '#F59E0B', fontWeight: 600 }}>
                    {incident.specificType}
                  </span>
                </div>
              )}
            </div>
          )}

          {incident.lat != null && incident.lng != null && incident.id !== 'No Incident Selected' && (
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
                  <span className="value">{incident.lat.toFixed(6)}, {incident.lng.toFixed(6)}</span>
                </div>
              </div>
            </div>
          )}

          {nearbyPlacesDisplay}
        </div>
      </div>
    );
  };

  return (
    <div className="incident-page">
      <div className="incident-grid">
        {renderIncidentDetails()}

        <div className="right-column">
          <div className="map-card">
            <div className="leaflet-map-container">
              <GoogleMap
                incidents={mapIncidents}
                center={mapCenter}
                zoom={13}
                nearbyPlaces={nearbyPlaces}
              />
            </div>
            <div className="map-address">
              <i className="fa fa-map-pin"></i>
              <span>{selectedIncident?.location?.address || 'No location selected'}</span>
            </div>
            {selectedIncident?.lat != null && selectedIncident?.lng != null && selectedIncident?.id !== 'No Incident Selected' && (
              <div className="map-coords">
                <span>
                  <i className="fa fa-location-dot"></i>
                  {selectedIncident.lat.toFixed(6)}° N, {selectedIncident.lng.toFixed(6)}° E
                </span>
              </div>
            )}
            {nearbyPlaces.length > 0 && (
              <div className="nearby-count">
                <i className="fa fa-location-dot"></i>
                {nearbyPlaces.length} nearby landmarks found
              </div>
            )}
          </div>

          <div className="actions-card">
            <div className="action-buttons-horizontal">
              <button
                className={`btn-dispatch ${selectedQueueItem?.status === 'dispatched' ? 'btn-dispatched' : ''}`}
                onClick={handleForwardToDispatch}
                disabled={!selectedQueueItem ||
                  selectedQueueItem.status === 'resolved' ||
                  selectedQueueItem.status === 'duplicate' ||
                  selectedQueueItem.status === 'dispatched' ||
                  selectedQueueItem.status !== 'verified'}
                style={{
                  gridColumn: '1 / -1',
                  backgroundColor: selectedQueueItem?.status === 'dispatched' ? '#6B7280' :
                                  selectedQueueItem?.status === 'verified' ? '#2563EB' :
                                  '#94A3B8',
                  cursor: selectedQueueItem?.status === 'dispatched' ? 'default' :
                          selectedQueueItem?.status === 'verified' ? 'pointer' :
                          'not-allowed',
                  opacity: selectedQueueItem?.status === 'verified' ? 1 : 0.6,
                }}
              >
                <i className="fa fa-paper-plane"></i>
                {selectedQueueItem?.status === 'dispatched' ? 'Dispatched ✓' : 'Forward to Dispatch'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {selectedPhoto && (
        <div className="photo-modal-overlay" onClick={closePhotoViewer}>
          <div className="photo-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="photo-modal-close" onClick={closePhotoViewer}>
              <i className="fa fa-times"></i>
            </button>
            <img src={selectedPhoto} alt="Incident photo full view" />
            <div className="photo-modal-info">
              <i className="fa fa-image"></i> Click anywhere outside to close
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default IncidentIntake;