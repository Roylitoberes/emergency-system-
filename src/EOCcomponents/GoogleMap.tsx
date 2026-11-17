// GoogleMap.tsx
// ✅ Responder pins are read directly from the responderLocations prop,
//    which is backed by a persistent module-level store in AppEOC.
// ✅ Pins are ONLY removed when the responder's status is 'resolved'
//    OR when the incident they are responding to no longer exists on the map.
// ✅ The map is NOT remounted when a live incident is clicked — we fly via
//    focusIncidentId + focusNonce.
// ✅ Popup shows "Others – [specificType]" as the Type when incident type is "Other"/"Others".
// ✅ Popup no longer shows a Description row.
// ✅ Map Type Toggle is now controlled by AppEOC via the mapType prop.
// ✅ Listens to `responder_routes` (published by Flutter MapPage) and
//    mirrors the EXACT route (polyline + distance + ETA) in real-time.
// ✅ NEW: Debug logging + incidentId-mismatch tolerance for responder_routes lookup.
// ✅ FIXED: Polyline now trims to stop exactly at the incident pin.
// ✅ FIXED: Polyline is PERMANENT — does not extend/change on status updates.
// ✅ FIXED: Previous/resolved incident polylines are automatically removed.
// ✅ NEW: When the responder taps "Navigate New Assigned Route" in the Flutter
//         app, the new polyline is drawn IMMEDIATELY on the EOC GoogleMap
//         without needing to click another navbar item. We detect this via a
//         content-signature comparison instead of a simple "route exists" guard.

import React, { useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  getFirestore,
  collection,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// =====================================================
// STATUS HELPERS
// =====================================================
const normalizeStatus = (status?: string) => {
  const s = (status || '').toLowerCase().trim();
  if (s === 'en_route' || s === 'enroute') return 'enroute';
  if (s === 'onscene' || s === 'on_scene') return 'on_scene';
  if (s === 'dispatched') return 'dispatched';
  if (s === 'backup') return 'backup';
  if (s === 'resolved' || s === 'completed') return 'resolved';
  return s || 'dispatched';
};

const statusLabel = (status?: string) => {
  switch (normalizeStatus(status)) {
    case 'enroute': return 'EN ROUTE';
    case 'on_scene': return 'ON SCENE';
    case 'backup': return 'BACKUP REQUESTED';
    case 'resolved': return 'RESOLVED';
    case 'dispatched': return 'DISPATCHED';
    default: return (status || 'DISPATCHED').toUpperCase();
  }
};

const statusBg = (status?: string) => {
  switch (normalizeStatus(status)) {
    case 'enroute': return '#DBEAFE';
    case 'on_scene': return '#E6F4EC';
    case 'backup': return '#FEF3E2';
    case 'resolved': return '#E5E7EB';
    default: return '#FEF2F2';
  }
};

const statusColor = (status?: string) => {
  switch (normalizeStatus(status)) {
    case 'enroute': return '#2563EB';
    case 'on_scene': return '#0B6B43';
    case 'backup': return '#F59E0B';
    case 'resolved': return '#4B5563';
    default: return '#EF4444';
  }
};

const isMissionActive = (status?: string) => {
  const s = normalizeStatus(status);
  return s !== 'resolved' && s !== '';
};

// =====================================================
// ✅ TYPE HELPERS
// =====================================================
const getDisplayIncidentType = (type?: string, specificType?: string | null): string => {
  const t = (type || 'Unknown').toString();
  const lower = t.toLowerCase().trim();
  if (
    lower === 'other' ||
    lower === 'others' ||
    lower === 'other incident' ||
    lower === 'others incident'
  ) {
    const specific = (specificType || '').toString().trim();
    if (specific.length > 0) return `Others – ${specific}`;
  }
  return t;
};

const RESPONDER_COLORS = [
  '#1479FF', '#F59E0B', '#8B5CF6', '#EC4899',
  '#06B6D4', '#10B981', '#EF4444', '#84CC16',
];

const colorForResponder = (id: string) => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return RESPONDER_COLORS[hash % RESPONDER_COLORS.length];
};

// =====================================================
// ICON FACTORIES
// =====================================================
const createPinIcon = (
  isDispatched: boolean = false,
  isSelected: boolean = false,
  isHovered: boolean = false
) => {
  const size = isSelected ? 48 : isHovered ? 42 : 36;
  const pinColor = '#EF4444';

  return L.divIcon({
    className: 'custom-pin-marker',
    html: `
      <div style="position:relative;display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.3));transition:transform 0.3s ease;${isSelected ? 'transform: scale(1.15);' : ''}">
        <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size * 1.4}" viewBox="0 0 36 50">
          <defs>
            <filter id="shadow-pin-red"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.3"/></filter>
            <linearGradient id="pinGrad-red" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" style="stop-color:${pinColor};stop-opacity:1" />
              <stop offset="100%" style="stop-color:${pinColor}cc;stop-opacity:0.9" />
            </linearGradient>
          </defs>
          <ellipse cx="18" cy="47" rx="12" ry="3" fill="rgba(0,0,0,0.2)" />
          <path d="M18 2 C8 2 2 10 2 20 C2 30 10 42 18 48 C26 42 34 30 34 20 C34 10 28 2 18 2 Z" fill="url(#pinGrad-red)" stroke="white" stroke-width="2" filter="url(#shadow-pin-red)" />
          <ellipse cx="12" cy="12" rx="6" ry="4" fill="white" opacity="0.3" transform="rotate(-20, 12, 12)" />
          <circle cx="18" cy="20" r="9" fill="white" opacity="0.9" />
          <circle cx="18" cy="20" r="6" fill="${pinColor}" />
          <circle cx="15" cy="17" r="2" fill="white" opacity="0.5" />
          ${isSelected || isDispatched ? `<circle cx="32" cy="6" r="8" fill="#2563EB" stroke="white" stroke-width="2"/><path d="M29 7 L32 10 L35 7" stroke="white" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
        </svg>
        ${isSelected || isDispatched ? `<div style="position:absolute;top:-12px;right:-12px;width:24px;height:24px;background:#2563EB;border-radius:50%;border:2px solid white;display:flex;align-items:center;justify-content:center;font-size:12px;color:white;box-shadow:0 2px 8px rgba(37,99,235,0.4);">✓</div>` : ''}
        ${isDispatched ? `<div style="position:absolute;bottom:-22px;font-size:8px;color:white;background:rgba(239,68,68,0.9);padding:2px 10px;border-radius:10px;white-space:nowrap;font-weight:600;letter-spacing:0.3px;text-transform:uppercase;">Dispatched</div>` : ''}
      </div>
    `,
    iconSize: [size, size * 1.4],
    iconAnchor: [size / 2, size * 1.3],
    popupAnchor: [0, -size * 1.2],
  });
};

const createPulseRing = () => L.divIcon({
  className: 'pulse-ring-marker',
  html: `<div class="pulse-ring-container"><div class="pulse-ring wave-1" style="border-color: #EF4444;"></div><div class="pulse-ring wave-2" style="border-color: #EF4444;"></div><div class="pulse-ring wave-3" style="border-color: #EF4444;"></div></div>`,
  iconSize: [60, 60],
  iconAnchor: [30, 30],
});

const createResponderIcon = (status: string, responderId: string = 'default') => {
  const normalized = normalizeStatus(status);
  const isOnScene = normalized === 'on_scene';
  const isBackup = normalized === 'backup';
  const isResolved = normalized === 'resolved';

  const baseColor = colorForResponder(responderId);
  const bgColor = isResolved ? '#4B5563' : isOnScene ? '#0B6B43' : isBackup ? '#F59E0B' : baseColor;
  const statusText = isResolved ? 'RESOLVED' : isOnScene ? 'ON SCENE' : isBackup ? 'BACKUP' : 'EN ROUTE';

  return L.divIcon({
    className: 'responder-marker',
    html: `
      <div style="position:relative;width:48px;height:60px;display:flex;align-items:flex-start;justify-content:center;pointer-events:auto;">
        <div style="position:absolute;top:0;left:0;width:48px;height:48px;border-radius:50%;background:${bgColor}30;animation:responderPulse 1.8s ease-out infinite;"></div>
        <div style="position:absolute;top:4px;left:4px;width:40px;height:40px;border-radius:50%;background:${bgColor}25;border:2px solid ${bgColor}66;"></div>
        <div style="position:absolute;top:8px;left:8px;width:32px;height:32px;border-radius:50%;background:${bgColor};border:2px solid white;box-shadow:0 3px 9px rgba(0,0,0,0.40),0 0 0 2px ${bgColor}88;display:flex;align-items:center;justify-content:center;color:white;font-size:16px;line-height:1;text-shadow:0 1px 2px rgba(0,0,0,0.55);"><i class="fa fa-ambulance"></i></div>
        <div style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);background:${bgColor};color:white;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:7px;font-weight:800;letter-spacing:0.4px;padding:2px 6px;border-radius:6px;white-space:nowrap;text-transform:uppercase;box-shadow:0 2px 4px rgba(0,0,0,0.35);border:1px solid white;">${statusText}</div>
      </div>
    `,
    iconSize: [48, 60],
    iconAnchor: [24, 24],
    popupAnchor: [0, -24],
  });
};

const createDistanceBubble = (distanceText: string, etaText: string, responderId: string = 'default') => {
  const color = colorForResponder(responderId);
  return L.divIcon({
    className: 'distance-bubble-marker',
    html: `<div style="display:inline-flex;flex-direction:column;align-items:center;justify-content:center;background:#172033;color:white;padding:8px 16px;min-width:88px;border-radius:12px;border:2px solid ${color}66;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,0.35);text-align:center;white-space:nowrap;box-sizing:border-box;transform:translate(-50%,-50%);"><div style="font-size:13px;font-weight:800;letter-spacing:0.3px;line-height:1.2;color:${color};">${distanceText}</div><div style="font-size:10.5px;font-weight:500;color:rgba(255,255,255,0.78);margin-top:2px;line-height:1.2;">${etaText} drive</div></div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
};

// =====================================================
// TYPES
// =====================================================
interface IncidentMarker {
  id: number | string;
  lat: number;
  lng: number;
  title: string;
  type: string;
  specificType?: string | null;
  severity: 'high' | 'medium' | 'low';
  description?: string;
  time?: string;
  dispatchedUnits?: string;
  location?: string;
  originalId?: string;
  incidentId?: string;
  status?: string;
}

interface ResponderLocation {
  lat: number;
  lng: number;
  status: string;
  responderName?: string;
  incidentId?: string;
}

interface RouteInfo {
  distanceText: string;
  etaText: string;
  distanceMeters?: number;
  durationSeconds?: number;
}

interface PublishedRoute {
  points: [number, number][];
  distanceText: string;
  etaText: string;
  distanceKm: number;
  etaMinutes: number;
  isAssigned: boolean;
  cleared: boolean;
  updatedAtMs?: number;   // ✅ used to detect a brand-new published route
}

interface GoogleMapProps {
  incidents?: IncidentMarker[];
  center?: { lat: number; lng: number };
  zoom?: number;
  responderLocations?: Record<string, ResponderLocation>;
  focusIncidentId?: string | null;
  focusNonce?: number;
  mapType?: 'street' | 'satellite';
}

const resolveCoords = (data: any): { lat: number; lng: number } | null => {
  const lat = data.lat ?? data.latitude ?? data.coordinates?.lat ?? data.location?.lat ?? data.geo?.lat;
  const lng = data.lng ?? data.longitude ?? data.lon ?? data.coordinates?.lng ?? data.location?.lng ?? data.geo?.lng;
  const nLat = Number(lat);
  const nLng = Number(lng);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) return null;
  if (nLat === 0 && nLng === 0) return null;
  return { lat: nLat, lng: nLng };
};

const haversineKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// =====================================================
// ✅ Route lookup helper — tolerant of key mismatch
// =====================================================
const findPublishedRouteForResponder = (
  responder: ResponderLocation,
  responderId: string,
  publishedRoutes: Record<string, PublishedRoute>,
): PublishedRoute | undefined => {
  // 1. Exact match on incidentId
  if (responder.incidentId && publishedRoutes[responder.incidentId]) {
    return publishedRoutes[responder.incidentId];
  }

  // 2. Try responderId itself as the route key (some setups use responderId as doc id)
  if (publishedRoutes[responderId]) {
    return publishedRoutes[responderId];
  }

  // 3. Fallback: find the route whose FIRST point is closest to the responder
  //    (only when the responder has no incidentId set).
  if (!responder.incidentId) {
    let best: PublishedRoute | undefined;
    let bestDist = Infinity;
    Object.values(publishedRoutes).forEach((route) => {
      if (route.cleared || route.points.length < 2) return;
      const [lat, lng] = route.points[0];
      const d = haversineKm(
        { lat: responder.lat, lng: responder.lng },
        { lat, lng },
      );
      if (d < bestDist) {
        bestDist = d;
        best = route;
      }
    });
    // Only accept fallback if the responder is within ~50m of the route start
    if (best && bestDist < 0.05) return best;
  }

  return undefined;
};

// =====================================================
// MAIN COMPONENT
// =====================================================
const GoogleMap: React.FC<GoogleMapProps> = ({
  incidents = [],
  center = { lat: 10.3157, lng: 123.8854 },
  zoom = 12,
  responderLocations = {},
  focusIncidentId = null,
  focusNonce = 0,
  mapType = 'street',
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  const pulseMarkersRef = useRef<Record<string, L.Marker>>({});
  const streetLayerRef = useRef<L.TileLayer | null>(null);
  const satelliteLayerRef = useRef<L.TileLayer | null>(null);
  const responderMarkersRef = useRef<Record<string, L.Marker>>({});

  const routeLayersRef = useRef<Record<string, L.Polyline>>({});
  const routeOutlinesRef = useRef<Record<string, L.Polyline>>({});
  const distanceBubblesRef = useRef<Record<string, L.Marker>>({});
  const lastRouteKeyRef = useRef<Record<string, string>>({});

  const userInteractedRef = useRef(false);
  const lastAutoFitIncidentRef = useRef<string>('');

  const routeInfoRef = useRef<Record<string, RouteInfo>>({});

  const [hoveredMarkerId, setHoveredMarkerId] = useState<number | string | null>(null);
  const [firebaseIncidents, setFirebaseIncidents] = useState<IncidentMarker[]>([]);

  // ✅ Published routes from Flutter MapPage
  const [publishedRoutes, setPublishedRoutes] = useState<Record<string, PublishedRoute>>({});

  // ✅ The authoritative responder map (ref + state).
  const respondersRef = useRef<Record<string, ResponderLocation>>({});
  const [respondersState, setRespondersState] = useState<Record<string, ResponderLocation>>({});

  useEffect(() => {
    const merged: Record<string, ResponderLocation> = { ...respondersRef.current };

    Object.entries(responderLocations).forEach(([id, loc]) => {
      if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return;
      merged[id] = loc;
    });

    Object.keys(merged).forEach((id) => {
      const propEntry = responderLocations[id];
      if (propEntry && !isMissionActive(propEntry.status)) {
        console.log(`[GoogleMap] 🧹 Removing resolved responder ${id}`);
        delete merged[id];
      }
    });

    respondersRef.current = merged;
    setRespondersState(merged);
  }, [responderLocations]);

  // =====================================================
  // FIREBASE: responder_notifications
  // =====================================================
  useEffect(() => {
    let unsub: (() => void) | undefined;
    try {
      const db = getFirestore();
      const notifRef = collection(db, 'responder_notifications');
      const q = query(notifRef, where('status', 'in', ['dispatched', 'enroute', 'on_scene', 'backup']));

      unsub = onSnapshot(
        q,
        (snap) => {
          const fetched: IncidentMarker[] = [];
          snap.docs.forEach((docSnap) => {
            const data: any = docSnap.data();
            const coords = resolveCoords(data);
            if (!coords) return;

            let displayTime = '';
            const rawTime = data.dispatchedAt || data.dispatchedTime || data.acceptedAt ||
              data.updatedAt || data.createdAt || data.timestamp || data.time;

            if (rawTime) {
              try {
                const date = rawTime?.toDate ? rawTime.toDate()
                  : typeof rawTime === 'object' && rawTime?.seconds ? new Date(rawTime.seconds * 1000)
                  : new Date(rawTime);
                if (!isNaN(date.getTime())) {
                  displayTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                }
              } catch {
                if (typeof rawTime === 'string') displayTime = rawTime.slice(0, 5);
              }
            }

            fetched.push({
              id: docSnap.id,
              originalId: docSnap.id,
              incidentId: data.incidentId || data.incident_id || docSnap.id,
              lat: coords.lat,
              lng: coords.lng,
              title: data.type || data.incidentType || 'Emergency Response',
              type: data.type || data.incidentType || 'Dispatched',
              specificType: data.specificType || null,
              severity: (data.severity as any) || 'high',
              description: data.description || '',
              time: displayTime || '--:--',
              dispatchedUnits: data.unitName || data.dispatchedUnits || data.units || data.assignedUnits || '',
              location: data.location || data.address || 'Unknown location',
              status: data.status || 'dispatched',
            });
          });
          setFirebaseIncidents(fetched);
        },
        (err) => console.error('❌ GoogleMap onSnapshot error:', err)
      );
    } catch (err) {
      console.error('❌ Failed to initialize Firebase listener:', err);
    }
    return () => { if (unsub) unsub(); };
  }, []);

  // =====================================================
  // ✅ FIREBASE: responder_routes (published by Flutter MapPage)
  // =====================================================
  useEffect(() => {
    let unsub: (() => void) | undefined;
    try {
      const db = getFirestore();
      const routesRef = collection(db, 'responder_routes');

      unsub = onSnapshot(
        routesRef,
        (snap) => {
          const next: Record<string, PublishedRoute> = {};
          snap.docs.forEach((docSnap) => {
            const data: any = docSnap.data();
            const incidentId = (data.incidentId || docSnap.id)?.toString();
            if (!incidentId) return;

            const cleared = data.cleared === true;
            const rawPoints = Array.isArray(data.points) ? data.points : [];
            const points: [number, number][] = rawPoints
              .map((p: any) => [Number(p.lat), Number(p.lng)] as [number, number])
              .filter(([a, b]) =>
                Number.isFinite(a) &&
                Number.isFinite(b) &&
                !(a === 0 && b === 0)
              );

            // ✅ Capture updatedAt so we can detect a NEW published route
            const rawUpdated = data.updatedAt;
            let updatedAtMs = 0;
            if (rawUpdated?.toMillis) updatedAtMs = rawUpdated.toMillis();
            else if (rawUpdated?.seconds) updatedAtMs = rawUpdated.seconds * 1000;
            else if (typeof rawUpdated === 'number') updatedAtMs = rawUpdated;

            next[incidentId] = {
              points,
              distanceText: (data.distanceText || '--').toString(),
              etaText: (data.etaText || '--').toString(),
              distanceKm: Number(data.distanceKm) || 0,
              etaMinutes: Number(data.etaMinutes) || 0,
              isAssigned: data.isAssigned === true,
              cleared,
              updatedAtMs,
            };
          });

          setPublishedRoutes(next);
          console.log(
            `[GoogleMap] 🛰️ responder_routes snapshot: ${Object.keys(next).length} routes`,
            Object.keys(next),
          );
        },
        (err) => console.error('❌ responder_routes onSnapshot error:', err),
      );
    } catch (err) {
      console.error('❌ Failed to init responder_routes listener:', err);
    }
    return () => { if (unsub) unsub(); };
  }, []);

  const finalIncidents: IncidentMarker[] = useMemo(() => {
    const merged: IncidentMarker[] = [...firebaseIncidents];
    incidents.forEach((incident) => {
      const exists = merged.some(
        (m) => m.originalId === incident.originalId || m.id === incident.id ||
               (m.lat === incident.lat && m.lng === incident.lng)
      );
      if (!exists) merged.push(incident);
    });
    return merged;
  }, [firebaseIncidents, incidents]);

  // =====================================================
  // INIT MAP
  // =====================================================
  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;

    leafletMap.current = L.map(mapRef.current, { zoomControl: false })
      .setView([center.lat, center.lng], zoom);

    streetLayerRef.current = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { attribution: '© OpenStreetMap contributors', maxZoom: 19 }
    ).addTo(leafletMap.current);

    satelliteLayerRef.current = L.tileLayer(
      'https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
      { attribution: '© Google Maps', maxZoom: 20, subdomains: ['mt0','mt1','mt2','mt3'], opacity: 0 }
    ).addTo(leafletMap.current);

    const map = leafletMap.current;
    const markInteracted = () => { userInteractedRef.current = true; };
    map.on('zoomstart', markInteracted);
    map.on('dragstart', markInteracted);
    map.on('mousedown', markInteracted);
    map.on('touchstart', markInteracted);
    map.on('wheel', markInteracted);

    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulseRing { 0% { transform: scale(0.5); opacity: 0.8; } 50% { opacity: 0.4; } 100% { transform: scale(1.8); opacity: 0; } }
      @keyframes responderPulse { 0% { transform: scale(0.7); opacity: 0.85; } 70% { transform: scale(1.35); opacity: 0; } 100% { transform: scale(1.35); opacity: 0; } }
      .custom-pin-marker { background: none !important; border: none !important; }
      .custom-pin-marker div { transition: transform 0.3s ease; }
      .custom-pin-marker div:hover { transform: scale(1.15) !important; }
      .pulse-ring-container { position: relative; width: 60px; height: 60px; display: flex; align-items: center; justify-content: center; pointer-events: none; }
      .pulse-ring { position: absolute; border-radius: 50%; border: 2px solid; opacity: 0; animation: pulseRing 2s ease-out infinite; }
      .pulse-ring.wave-1 { width: 20px; height: 20px; animation-delay: 0s; }
      .pulse-ring.wave-2 { width: 30px; height: 30px; animation-delay: 0.6s; }
      .pulse-ring.wave-3 { width: 40px; height: 40px; animation-delay: 1.2s; }
      .distance-bubble-marker { background: none !important; border: none !important; }
      .responder-marker { background: none !important; border: none !important; z-index: 99999 !important; }
      .responder-marker > div { pointer-events: auto; }
      .leaflet-popup-content-wrapper { border-radius: 10px !important; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18) !important; max-width: 260px !important; }
      .leaflet-popup-content { margin: 8px 10px !important; min-width: 200px !important; max-width: 240px !important; font-size: 11px !important; line-height: 1.35 !important; }
      .popup-container { padding: 2px 0; }
      .popup-title { margin: 0 0 5px 0; font-size: 12.5px; font-weight: 700; line-height: 1.2; }
      .popup-field { margin: 2px 0; font-size: 11px; line-height: 1.3; }
      .popup-field strong { font-weight: 600; }
      .popup-divider { margin-top: 6px; padding-top: 6px; border-top: 1px solid #e5e7eb; }
      .popup-location { display: flex; align-items: center; gap: 4px; font-size: 9.5px; color: #6B7280; }
      .popup-units { display: flex; align-items: center; gap: 4px; font-size: 10px; margin-top: 3px; padding: 3px 6px; background: #FEF2F2; border-radius: 5px; border: 1px solid #FECACA; }
      .popup-status { display: inline-block; padding: 1px 7px; border-radius: 8px; font-size: 9.5px; font-weight: 600; margin-top: 3px; }
      .leaflet-control-attribution { background: rgba(30, 41, 59, 0.85) !important; color: #94A3B8 !important; font-size: 10px !important; padding: 2px 8px !important; border-radius: 4px !important; }
      .leaflet-control-attribution a { color: #60A5FA !important; }
    `;
    document.head.appendChild(style);

    return () => {
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
      }
      if (style.parentNode) style.parentNode.removeChild(style);
    };
  }, []);

  useEffect(() => {
    if (!streetLayerRef.current || !satelliteLayerRef.current) return;
    if (mapType === 'street') {
      streetLayerRef.current.setOpacity(1);
      satelliteLayerRef.current.setOpacity(0);
    } else {
      streetLayerRef.current.setOpacity(0);
      satelliteLayerRef.current.setOpacity(1);
    }
  }, [mapType]);

  // =====================================================
  // RENDER INCIDENT MARKERS
  // =====================================================
  useEffect(() => {
    if (!leafletMap.current) return;
    const map = leafletMap.current;

    const currentIds = new Set(finalIncidents.map((i) => String(i.id)));
    Object.keys(markersRef.current).forEach((id) => {
      if (!currentIds.has(id)) {
        markersRef.current[id].remove();
        delete markersRef.current[id];
      }
    });
    Object.keys(pulseMarkersRef.current).forEach((id) => {
      if (!currentIds.has(id)) {
        pulseMarkersRef.current[id].remove();
        delete pulseMarkersRef.current[id];
      }
    });

    if (finalIncidents.length === 0) return;

    let selectedOriginalId: string | null = null;
    const stored = sessionStorage.getItem('selectedIncidentForMap');
    if (stored) {
      try { selectedOriginalId = JSON.parse(stored).id; } catch {}
    }

    finalIncidents.forEach((incident, index) => {
      const key = String(incident.id);
      const isHovered = hoveredMarkerId === incident.id;

      const isSelected = !!selectedOriginalId && (
        String(incident.id) === String(selectedOriginalId) ||
        String(incident.originalId) === String(selectedOriginalId) ||
        String(incident.incidentId) === String(selectedOriginalId)
      );

      const rawStatus = incident.status || 'dispatched';
      const liveStatus = normalizeStatus(rawStatus);
      const liveStatusLabel = statusLabel(rawStatus);
      const liveStatusBg = statusBg(rawStatus);
      const liveStatusText = statusColor(rawStatus);

      const routeInfo = routeInfoRef.current[key];
      const distanceText = routeInfo?.distanceText || '--';
      const etaText = routeInfo?.etaText || '--';

      const displayType = getDisplayIncidentType(incident.type, incident.specificType);

      const popupHtml = `
        <div class="popup-container">
          <h4 class="popup-title" style="color:${liveStatusText};">🚨 ${displayType}</h4>
          <div style="margin: 4px 0; padding: 5px 8px; background:${liveStatusBg}; border-radius: 6px; border-left: 3px solid ${liveStatusText};">
            <div style="display:flex;align-items:center;gap:5px;color:${liveStatusText};font-weight:600;font-size:10.5px;line-height:1.25;">
              <i class="fa fa-exclamation-triangle" style="color:${liveStatusText};"></i>
              ${liveStatus === 'enroute' ? 'Responder is en route to this location'
                : liveStatus === 'on_scene' ? 'Responder has arrived at the scene'
                : liveStatus === 'backup' ? 'Responder has requested backup for this incident'
                : 'Units have been dispatched to this location'}
            </div>
          </div>
          <div class="popup-field"><strong>Type:</strong> ${displayType}</div>
          <div class="popup-field"><strong>Status:</strong> <span style="background:${liveStatusBg};color:${liveStatusText};padding:1px 6px;border-radius:6px;font-weight:700;font-size:9.5px;margin-left:3px;">${liveStatusLabel}</span></div>
          ${(liveStatus === 'enroute' || liveStatus === 'backup') && distanceText !== '--' ? `<div style="margin:4px 0;padding:5px 8px;background:#EFF6FF;border-radius:6px;border-left:3px solid #2563EB;"><div style="display:flex;align-items:center;gap:5px;color:#1E40AF;font-weight:600;font-size:10px;margin-bottom:2px;"><i class="fa fa-route"></i> Live Route</div><div style="display:flex;justify-content:space-between;font-size:10px;color:#1E3A8A;font-weight:700;"><span>📏 ${distanceText}</span><span>⏱️ ${etaText}</span></div></div>` : ''}
          <div class="popup-field"><strong>Time:</strong> ${incident.time && incident.time !== '--:--' ? incident.time : 'Just now'}</div>
          ${incident.location ? `<div class="popup-field"><strong>Location:</strong> ${incident.location}</div>` : ''}
          <div class="popup-divider">
            <div class="popup-location"><i class="fa fa-location-dot"></i><span>${incident.lat.toFixed(6)}, ${incident.lng.toFixed(6)}</span></div>
            ${incident.dispatchedUnits && incident.dispatchedUnits !== 'N/A' ? `<div class="popup-units" style="background:${liveStatusBg};border-color:${liveStatusText}33;color:${liveStatusText};"><i class="fa fa-truck" style="color:${liveStatusText};"></i><span><span style="font-weight:600;color:${liveStatusText};">${incident.dispatchedUnits}</span> Dispatched</span></div>` : ''}
            <div style="margin-top: 4px;"><span class="popup-status" style="background:${liveStatusBg};color:${liveStatusText};"><i class="fa fa-circle" style="font-size: 5px; margin-right: 3px;"></i>${liveStatusLabel}</span></div>
          </div>
        </div>
      `;

      const existing = markersRef.current[key];
      if (existing) {
        existing.setLatLng([incident.lat, incident.lng]);
        existing.setIcon(createPinIcon(true, isSelected, isHovered));
        existing.bindPopup(popupHtml);
        if (existing.isPopupOpen()) existing.setPopupContent(popupHtml);
      } else {
        const marker = L.marker([incident.lat, incident.lng], {
          icon: createPinIcon(true, isSelected, isHovered),
          zIndexOffset: isHovered ? 1000 : 0,
        }).addTo(map).bindPopup(popupHtml);

        marker.on('mouseover', () => setHoveredMarkerId(incident.id));
        marker.on('mouseout', () => setHoveredMarkerId(null));

        markersRef.current[key] = marker;

        const pulseMarker = L.marker([incident.lat, incident.lng], {
          icon: createPulseRing(),
          zIndexOffset: -100,
          interactive: false,
        }).addTo(map);
        pulseMarkersRef.current[key] = pulseMarker;
      }

      if (isSelected && !markersRef.current[key].isPopupOpen()) {
        setTimeout(() => {
          markersRef.current[key]?.openPopup();
          if (!userInteractedRef.current) {
            leafletMap.current?.flyTo([incident.lat, incident.lng], 15, {
              duration: 1.2, easeLinearity: 0.25,
            });
          }
        }, 300);
      }

      if (!selectedOriginalId && index === 0) {
        setTimeout(() => {
          if (markersRef.current[key] && !markersRef.current[key].isPopupOpen()) {
            markersRef.current[key].openPopup();
          }
        }, 600);
      }
    });

    if (
      Object.keys(markersRef.current).length > 0 &&
      !userInteractedRef.current &&
      lastAutoFitIncidentRef.current === ''
    ) {
      const latLngs = Object.values(markersRef.current).map((m) => m.getLatLng());
      const bounds = L.latLngBounds(latLngs);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
      lastAutoFitIncidentRef.current = 'done';
    }
  }, [finalIncidents, hoveredMarkerId]);

  // =====================================================
  // FLY TO CLICKED INCIDENT'S PIN
  // =====================================================
  useEffect(() => {
    if (!leafletMap.current) return;
    if (!focusIncidentId) return;

    const map = leafletMap.current;

    const targetKey = Object.keys(markersRef.current).find((key) => {
      const inc = finalIncidents.find((i) => String(i.id) === key);
      if (!inc) return false;
      return (
        String(inc.id) === String(focusIncidentId) ||
        String(inc.originalId) === String(focusIncidentId) ||
        String(inc.incidentId) === String(focusIncidentId)
      );
    });

    if (!targetKey) return;
    const marker = markersRef.current[targetKey];
    if (!marker) return;

    const { lat, lng } = marker.getLatLng();
    userInteractedRef.current = true;

    map.flyTo([lat, lng], 16, { duration: 1.1, easeLinearity: 0.25 });

    setTimeout(() => {
      try { marker.openPopup(); } catch {}
    }, 450);
  }, [focusIncidentId, focusNonce, finalIncidents]);

  // =====================================================
  // ✅ RENDER RESPONDER MARKERS
  // =====================================================
  useEffect(() => {
    if (!leafletMap.current) return;
    const map = leafletMap.current;

    const visible: Record<string, ResponderLocation> = {};
    
    // Build a set of currently active incident IDs for quick lookup
    const activeIncidentIds = new Set<string>();
    finalIncidents.forEach(inc => {
        if (inc.id) activeIncidentIds.add(String(inc.id));
        if (inc.originalId) activeIncidentIds.add(String(inc.originalId));
        if (inc.incidentId) activeIncidentIds.add(String(inc.incidentId));
    });

    Object.entries(respondersState).forEach(([id, loc]) => {
      if (typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return;
      if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return;
      if (loc.lat === 0 && loc.lng === 0) return;
      if (!isMissionActive(loc.status)) return;

      // ✅ NEW: Check if the responder's incident exists on the map
      if (loc.incidentId) {
          const incidentExists = activeIncidentIds.has(String(loc.incidentId));
          if (!incidentExists) {
              console.log(`[GoogleMap] 🧹 Removing responder ${id} — incident ${loc.incidentId} no longer exists on map.`);
              return; // Skip adding this responder to visible
          }
      }

      visible[id] = loc;
    });

    const visibleIds = new Set(Object.keys(visible));

    Object.keys(responderMarkersRef.current).forEach((id) => {
      if (!visibleIds.has(id)) {
        try { responderMarkersRef.current[id].remove(); } catch {}
        delete responderMarkersRef.current[id];
      }
    });

    Object.entries(visible).forEach(([id, loc]) => {
      const popupHtml = `
        <div style="padding: 4px 0;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <span style="display:inline-block;width:10px;height:10px;background:${colorForResponder(id)};border-radius:50%;"></span>
            <strong style="color:#0F172A;font-size:14px;">${loc.responderName || 'Responder'}</strong>
          </div>
          <div style="font-size:12px;color:#475569;margin-bottom:2px;">
            <strong>Status:</strong>
            <span style="background:${normalizeStatus(loc.status) === 'on_scene' ? '#E6F4EC' : normalizeStatus(loc.status) === 'backup' ? '#FEF3E2' : '#DBEAFE'};color:${normalizeStatus(loc.status) === 'on_scene' ? '#0B6B43' : normalizeStatus(loc.status) === 'backup' ? '#B45309' : '#2563EB'};padding:1px 8px;border-radius:8px;font-weight:700;font-size:11px;">${statusLabel(loc.status)}</span>
          </div>
          <div style="font-size:11px;color:#64748B;">🚑 ${loc.incidentId ? `Incident: ${loc.incidentId}` : ''}</div>
          <div style="font-size:11px;color:#64748B;">📍 ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}</div>
        </div>
      `;

      const existing = responderMarkersRef.current[id];
      if (existing) {
        existing.setLatLng([loc.lat, loc.lng]);
        existing.setIcon(createResponderIcon(loc.status, id));
        existing.setZIndexOffset(50000);
        existing.setPopupContent(popupHtml);
        return;
      }

      const marker = L.marker([loc.lat, loc.lng], {
        icon: createResponderIcon(loc.status, id),
        zIndexOffset: 50000,
        pane: 'markerPane',
        interactive: true,
      }).addTo(map).bindPopup(popupHtml);

      responderMarkersRef.current[id] = marker;
      console.log(`[GoogleMap] 📍 Responder pin created: ${id} (${loc.status})`);
    });

    console.log(`[GoogleMap] 🗺️ Visible responder pins: ${Object.keys(responderMarkersRef.current).length}`);
  }, [respondersState, finalIncidents]);

  // =====================================================
  // DRAW ROUTE + DISTANCE BUBBLE
  // ✅ Prefers publishedRoutes (mirrors Flutter MapPage exactly)
  // ✅ FIXED: Polyline trims to stop exactly at the incident pin
  // ✅ FIXED: Polyline is PERMANENT — does not extend/change on status updates
  // ✅ FIXED: Previous/resolved incident polylines are automatically removed
  // ✅ NEW: Content-signature check so a freshly-published assigned route
  //         (from "Navigate New Assigned Route") is drawn immediately.
  // =====================================================
  useEffect(() => {
    if (!leafletMap.current) return;
    const map = leafletMap.current;

    // Build a set of currently active incident IDs for quick lookup
    const activeIncidentIds = new Set<string>();
    finalIncidents.forEach(inc => {
        if (inc.id) activeIncidentIds.add(String(inc.id));
        if (inc.originalId) activeIncidentIds.add(String(inc.originalId));
        if (inc.incidentId) activeIncidentIds.add(String(inc.incidentId));
    });

    const acceptedEntries = Object.entries(respondersState).filter(([, r]) => {
      const st = normalizeStatus(r.status);
      if (st !== 'enroute' && st !== 'on_scene') return false;
      
      // ✅ FIX: Only accept if the incident this responder is attached to is currently active.
      // This prevents drawing routes for resolved/previous incidents.
      if (r.incidentId && !activeIncidentIds.has(String(r.incidentId))) {
        return false;
      }
      return true;
    });

    const acceptedIds = new Set(acceptedEntries.map(([id]) => id));

    // ✅ Remove routes for responders who are no longer active OR whose incident is resolved
    Object.keys(routeLayersRef.current).forEach((id) => {
      if (!acceptedIds.has(id)) {
        console.log(`[GoogleMap] 🧹 Removing polyline for responder ${id} (incident resolved or responder inactive)`);
        routeLayersRef.current[id]?.remove();
        delete routeLayersRef.current[id];
        delete lastRouteKeyRef.current[id];
        routeOutlinesRef.current[id]?.remove();
        delete routeOutlinesRef.current[id];
        distanceBubblesRef.current[id]?.remove();
        delete distanceBubblesRef.current[id];
        routeInfoRef.current[id] = undefined as any;
      }
    });

    if (acceptedEntries.length === 0) return;

    acceptedEntries.forEach(([responderId, responder]) => {

      // ✅ NEW: Instead of a "route already exists" permanence check, we
      // compare a CONTENT SIGNATURE of the currently-drawn route against
      // the current source (published route OR OSRM fallback). If the
      // content is identical we keep the existing polyline (so status
      // flips EN ROUTE ↔ ON SCENE don't cause churn). If the content
      // differs — e.g. the responder just tapped "Navigate New Assigned
      // Route" and Flutter published a fresh polyline — we tear down the
      // old layers and redraw immediately, no navbar switch needed.

      // Resolve the published route FIRST so the signature reflects it.
      const publishedNow = findPublishedRouteForResponder(
        responder,
        responderId,
        publishedRoutes,
      );

      // Build a signature that captures everything that matters for
      // deciding whether the drawn polyline is still valid:
      //   - which incident we're routing to
      //   - whether it's the assigned (published) route or OSRM fallback
      //   - the published route's updatedAt + point count + first point
      //   - (for OSRM fallback) responder position rounded to ~10m
      let targetIncidentPreview: IncidentMarker | undefined;
      if (responder.incidentId) {
        targetIncidentPreview = finalIncidents.find(
          (i) =>
            (i.originalId === responder.incidentId ||
              i.id === responder.incidentId ||
              i.incidentId === responder.incidentId) &&
            ['enroute', 'on_scene', 'backup'].includes(normalizeStatus(i.status)),
        );
      }
      if (!targetIncidentPreview && finalIncidents.length > 0) {
        let best: IncidentMarker | undefined;
        let bestDist = Infinity;
        finalIncidents.forEach((i) => {
          if (!['enroute', 'on_scene', 'backup'].includes(normalizeStatus(i.status))) return;
          const d = haversineKm(
            { lat: responder.lat, lng: responder.lng },
            { lat: i.lat, lng: i.lng },
          );
          if (d < bestDist) { bestDist = d; best = i; }
        });
        targetIncidentPreview = best;
      }

      let newSignature: string;
      if (publishedNow && !publishedNow.cleared && publishedNow.points.length >= 2) {
        const first = publishedNow.points[0];
        const last = publishedNow.points[publishedNow.points.length - 1];
        newSignature =
          `pub|${targetIncidentPreview?.id ?? 'none'}` +
          `|u=${publishedNow.updatedAtMs ?? 0}` +
          `|n=${publishedNow.points.length}` +
          `|f=${first[0].toFixed(4)},${first[1].toFixed(4)}` +
          `|l=${last[0].toFixed(4)},${last[1].toFixed(4)}` +
          `|d=${publishedNow.distanceText}|e=${publishedNow.etaText}` +
          `|a=${publishedNow.isAssigned ? 1 : 0}`;
      } else if (targetIncidentPreview) {
        newSignature =
          `osrm|${targetIncidentPreview.id}` +
          `|r=${responder.lat.toFixed(4)},${responder.lng.toFixed(4)}` +
          `|i=${targetIncidentPreview.lat.toFixed(4)},${targetIncidentPreview.lng.toFixed(4)}`;
      } else {
        newSignature = 'none';
      }

      const prevSignature = lastRouteKeyRef.current[responderId];
      const routeExists = !!routeLayersRef.current[responderId];

      if (routeExists && prevSignature === newSignature) {
        // Content unchanged → keep the existing permanent polyline.
        // This is what prevents the line from extending/changing when the
        // status flips EN ROUTE ↔ ON SCENE while the geometry is the same.
        return;
      }

      // Content changed (or no route yet) → tear down old layers so the
      // next drawRoute() call replaces them. This is the path that fires
      // when the responder taps "Navigate New Assigned Route".
      if (routeExists) {
        console.log(
          `[GoogleMap] ♻️ Route changed for ${responderId} — replacing polyline immediately`,
        );
        try { routeLayersRef.current[responderId]?.remove(); } catch {}
        delete routeLayersRef.current[responderId];
        try { routeOutlinesRef.current[responderId]?.remove(); } catch {}
        delete routeOutlinesRef.current[responderId];
        try { distanceBubblesRef.current[responderId]?.remove(); } catch {}
        delete distanceBubblesRef.current[responderId];
        delete lastRouteKeyRef.current[responderId];
        routeInfoRef.current[responderId] = undefined as any;
      }

      let targetIncident: IncidentMarker | undefined;

      if (responder.incidentId) {
        targetIncident = finalIncidents.find(
          (i) =>
            (i.originalId === responder.incidentId || i.id === responder.incidentId ||
             i.incidentId === responder.incidentId) &&
            ['enroute', 'on_scene', 'backup'].includes(normalizeStatus(i.status))
        );
      }

      if (!targetIncident && finalIncidents.length > 0) {
        let best: IncidentMarker | undefined;
        let bestDist = Infinity;
        finalIncidents.forEach((i) => {
          if (!['enroute', 'on_scene', 'backup'].includes(normalizeStatus(i.status))) return;
          const d = haversineKm({ lat: responder.lat, lng: responder.lng }, { lat: i.lat, lng: i.lng });
          if (d < bestDist) { bestDist = d; best = i; }
        });
        targetIncident = best;
      }

      if (!targetIncident) return;

      const responderPoint: [number, number] = [responder.lat, responder.lng];
      const incidentPoint: [number, number] = [targetIncident.lat, targetIncident.lng];

      const drawRoute = async () => {
        // ──────────────────────────────────────────────
        // ✅ PRIMARY: use the route published by Flutter's MapPage
        // ──────────────────────────────────────────────
        const published = findPublishedRouteForResponder(
          responder,
          responderId,
          publishedRoutes,
        );

        if (published && !published.cleared && published.points.length >= 2) {
          
          // ✅ FIX: Trim the route so it stops at the incident pin, not past it.
          let polylinePoints = published.points;
          
          let closestIndex = 0;
          let minDistance = Infinity;
          
          published.points.forEach((point, index) => {
            const d = haversineKm(
              { lat: point[0], lng: point[1] },
              { lat: targetIncident!.lat, lng: targetIncident!.lng }
            );
            if (d < minDistance) {
              minDistance = d;
              closestIndex = index;
            }
          });

          if (closestIndex > 0 && closestIndex < published.points.length - 1) {
            polylinePoints = published.points.slice(0, closestIndex + 1);
            polylinePoints.push([targetIncident!.lat, targetIncident!.lng]);
          }

          const mid = polylinePoints[Math.floor(polylinePoints.length / 2)];

          const distanceText = published.distanceText;
          const etaText = published.etaText;

          routeInfoRef.current[responderId] = {
            distanceText,
            etaText,
            distanceMeters: published.distanceKm > 0 ? published.distanceKm * 1000 : undefined,
            durationSeconds: published.etaMinutes > 0 ? published.etaMinutes * 60 : undefined,
          };

          // ✅ Keep the signature in sync with the one computed above so the
          //    next effect run doesn't think the route "changed" and redraw.
          const first = published.points[0];
          const last = published.points[published.points.length - 1];
          const routeKey =
            `pub|${targetIncident!.id}` +
            `|u=${published.updatedAtMs ?? 0}` +
            `|n=${published.points.length}` +
            `|f=${first[0].toFixed(4)},${first[1].toFixed(4)}` +
            `|l=${last[0].toFixed(4)},${last[1].toFixed(4)}` +
            `|d=${published.distanceText}|e=${published.etaText}` +
            `|a=${published.isAssigned ? 1 : 0}`;
          lastRouteKeyRef.current[responderId] = routeKey;

          // Draw the permanent polyline
          routeOutlinesRef.current[responderId] = L.polyline(polylinePoints, {
            color: 'white', weight: 9, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false,
          }).addTo(map);

          routeLayersRef.current[responderId] = L.polyline(polylinePoints, {
            color: published.isAssigned ? '#0B6B43' : colorForResponder(responderId),
            weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false,
          }).addTo(map);

          distanceBubblesRef.current[responderId] = L.marker([mid[0], mid[1]], {
            icon: createDistanceBubble(distanceText, etaText, responderId),
            interactive: false, zIndexOffset: 400,
          }).addTo(map);

          return;
        }

        // ──────────────────────────────────────────────
        // FALLBACK: no published route → compute via OSRM
        // ──────────────────────────────────────────────
        // ✅ Use the SAME signature format as the check above so the next
        //    run of this effect will recognize the drawn route as current.
        const routeKey =
          `osrm|${targetIncident!.id}` +
          `|r=${responderPoint[0].toFixed(4)},${responderPoint[1].toFixed(4)}` +
          `|i=${incidentPoint[0].toFixed(4)},${incidentPoint[1].toFixed(4)}`;
        lastRouteKeyRef.current[responderId] = routeKey;

        let polylinePoints: [number, number][] = [responderPoint, incidentPoint];
        let osrmDistanceMeters: number | null = null;
        let osrmDurationSeconds: number | null = null;

        try {
          const url = `https://router.project-osrm.org/route/v1/driving/${responderPoint[1]},${responderPoint[0]};${incidentPoint[1]},${incidentPoint[0]}?overview=full&geometries=geojson&steps=true`;
          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json();
            if (data?.code === 'Ok' && data?.routes?.length > 0) {
              const route = data.routes[0];
              osrmDistanceMeters = Number(route.distance) || null;
              osrmDurationSeconds = Number(route.duration) || null;
              const coords: [number, number][] = route.geometry.coordinates.map(
                (c: [number, number]) => [c[1], c[0]] as [number, number]
              );
              if (coords.length >= 2) polylinePoints = coords;
            }
          }
        } catch (err) {
          console.warn(`OSRM route fetch failed for ${responderId}:`, err);
        }

        const mid = polylinePoints[Math.floor(polylinePoints.length / 2)];

        let distanceKm: number;
        let etaMinutes: number;

        if (osrmDistanceMeters !== null && osrmDurationSeconds !== null) {
          distanceKm = osrmDistanceMeters / 1000.0;
          etaMinutes = Math.max(1, Math.ceil(osrmDurationSeconds / 60.0));
        } else {
          distanceKm = haversineKm(
            { lat: responderPoint[0], lng: responderPoint[1] },
            { lat: incidentPoint[0], lng: incidentPoint[1] },
          );
          if (polylinePoints.length > 2) {
            let total = 0;
            for (let i = 1; i < polylinePoints.length; i++) {
              total += haversineKm(
                { lat: polylinePoints[i - 1][0], lng: polylinePoints[i - 1][1] },
                { lat: polylinePoints[i][0], lng: polylinePoints[i][1] },
              );
            }
            distanceKm = total;
          }
          etaMinutes = Math.max(1, Math.round((distanceKm / 40) * 60));
        }

        const distanceText = distanceKm < 1 ? `${Math.round(distanceKm * 1000)} m` : `${distanceKm.toFixed(1)} km`;
        const etaText = etaMinutes <= 1 ? '1 min' : `${etaMinutes} min`;

        routeInfoRef.current[responderId] = {
          distanceText,
          etaText,
          distanceMeters: osrmDistanceMeters ?? undefined,
          durationSeconds: osrmDurationSeconds ?? undefined,
        };

        routeOutlinesRef.current[responderId] = L.polyline(polylinePoints, {
          color: 'white', weight: 9, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false,
        }).addTo(map);

        routeLayersRef.current[responderId] = L.polyline(polylinePoints, {
          color: colorForResponder(responderId),
          weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false,
        }).addTo(map);

        distanceBubblesRef.current[responderId] = L.marker([mid[0], mid[1]], {
          icon: createDistanceBubble(distanceText, etaText, responderId),
          interactive: false, zIndexOffset: 400,
        }).addTo(map);
      };

      drawRoute();
    });

    if (!userInteractedRef.current && Object.keys(routeLayersRef.current).length > 0 && lastAutoFitIncidentRef.current !== 'multi') {
      const allPoints: [number, number][] = [];
      Object.values(routeLayersRef.current).forEach((poly) => {
        (poly.getLatLngs() as any[]).forEach((ll: any) => allPoints.push([ll.lat, ll.lng]));
      });
      if (allPoints.length > 0) {
        const bounds = L.latLngBounds(allPoints);
        map.fitBounds(bounds, { paddingTopLeft: [50, 100], paddingBottomRight: [50, 50], maxZoom: 15 });
        lastAutoFitIncidentRef.current = 'multi';
      }
    }
  }, [respondersState, finalIncidents, publishedRoutes]);

  return (
    <div style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }} />
    </div>
  );
};

export default GoogleMap;