// src/components/LeafletMapNew.tsx

import { useEffect, useRef, useState, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default markers in Leaflet with React
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
  const s = (status || '').toLowerCase().trim().replace(/-/g, '_');
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

const getDisplayIncidentType = (type?: string, specificType?: string | null): string => {
  const t = (type || 'Unknown').toString();
  const lower = t.toLowerCase().trim();
  if (lower === 'other' || lower === 'others' || lower === 'other incident' || lower === 'others incident') {
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
const createPinIcon = (isDispatched = false, isSelected = false, isHovered = false) => {
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

const createResponderIcon = (status: string, responderId = 'default') => {
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

const createDistanceBubble = (distanceText: string, etaText: string, responderId = 'default') => {
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

interface LeafletMapNewProps {
  incidents?: IncidentMarker[];
  center?: { lat: number; lng: number };
  zoom?: number;
  responderLocations?: Record<string, ResponderLocation>;
  focusIncidentId?: string | null;
  focusNonce?: number;
  mapType?: 'street' | 'satellite';
  onIncidentSelect?: (incidentId: string) => void;
  selectedIncidentId?: string | null;
  rescuers?: Array<{
    id: string;
    name: string;
    lat: number;
    lng: number;
    status: string;
  }>;
}

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
// ROUTE RENDERER
// =====================================================
function RouteRenderer({
  responders,
  incidents,
  map
}: {
  responders: Record<string, ResponderLocation>;
  incidents: IncidentMarker[];
  map: L.Map;
}) {
  const routeLayersRef = useRef<Record<string, L.Polyline>>({});
  const routeOutlinesRef = useRef<Record<string, L.Polyline>>({});
  const distanceBubblesRef = useRef<Record<string, L.Marker>>({});

  useEffect(() => {
    if (!map) return;

    const acceptedEntries = Object.entries(responders).filter(([, r]) => {
      const st = normalizeStatus(r.status);
      return st === 'enroute' || st === 'on_scene';
    });

    const acceptedIds = new Set(acceptedEntries.map(([id]) => id));

    Object.keys(routeLayersRef.current).forEach((id) => {
      if (!acceptedIds.has(id)) {
        routeLayersRef.current[id]?.remove();
        delete routeLayersRef.current[id];
        routeOutlinesRef.current[id]?.remove();
        delete routeOutlinesRef.current[id];
        distanceBubblesRef.current[id]?.remove();
        delete distanceBubblesRef.current[id];
      }
    });

    if (acceptedEntries.length === 0) return;

    acceptedEntries.forEach(async ([responderId, responder]) => {
      let targetIncident: IncidentMarker | undefined;

      // 1. Try matching by incidentId first
      if (responder.incidentId) {
        targetIncident = incidents.find(
          (i) =>
            (String(i.originalId) === String(responder.incidentId) || 
             String(i.id) === String(responder.incidentId) ||
             String(i.incidentId) === String(responder.incidentId))
        );
      }

      // 2. Fallback: nearest incident if no match or no incidentId
      if (!targetIncident && incidents.length > 0) {
        let best: IncidentMarker | undefined;
        let bestDist = Infinity;
        incidents.forEach((i) => {
          const d = haversineKm({ lat: responder.lat, lng: responder.lng }, { lat: i.lat, lng: i.lng });
          if (d < bestDist) { bestDist = d; best = i; }
        });
        targetIncident = best;
      }

      if (!targetIncident) return;

      const responderPoint: [number, number] = [responder.lat, responder.lng];
      const incidentPoint: [number, number] = [targetIncident.lat, targetIncident.lng];

      let polylinePoints: [number, number][] = [responderPoint, incidentPoint];
      let osrmDistanceMeters: number | null = null;
      let osrmDurationSeconds: number | null = null;

      // Fetch OSRM route
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

      // Draw layers
      routeOutlinesRef.current[responderId] = L.polyline(polylinePoints, {
        color: 'white', weight: 9, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false,
      }).addTo(map);

      routeLayersRef.current[responderId] = L.polyline(polylinePoints, {
        color: colorForResponder(responderId), weight: 6, opacity: 1,
        lineCap: 'round', lineJoin: 'round', interactive: false,
      }).addTo(map);

      // Distance/ETA
      const mid = polylinePoints[Math.floor(polylinePoints.length / 2)];
      let distanceKm: number;
      let etaMinutes: number;

      if (osrmDistanceMeters !== null && osrmDurationSeconds !== null) {
        distanceKm = osrmDistanceMeters / 1000.0;
        etaMinutes = Math.max(1, Math.ceil(osrmDurationSeconds / 60.0));
      } else {
        distanceKm = haversineKm(
          { lat: responderPoint[0], lng: responderPoint[1] },
          { lat: incidentPoint[0], lng: incidentPoint[1] }
        );
        etaMinutes = Math.max(1, Math.round((distanceKm / 40) * 60));
      }

      const distanceText = distanceKm < 1 ? `${Math.round(distanceKm * 1000)} m` : `${distanceKm.toFixed(1)} km`;
      const etaText = etaMinutes <= 1 ? '1 min' : `${etaMinutes} min`;

      if (distanceBubblesRef.current[responderId]) {
        distanceBubblesRef.current[responderId].setLatLng([mid[0], mid[1]]);
        distanceBubblesRef.current[responderId].setIcon(createDistanceBubble(distanceText, etaText, responderId));
      } else {
        distanceBubblesRef.current[responderId] = L.marker([mid[0], mid[1]], {
          icon: createDistanceBubble(distanceText, etaText, responderId),
          interactive: false, zIndexOffset: 400,
        }).addTo(map);
      }
    });

    return () => {
      Object.values(routeLayersRef.current).forEach((l) => l.remove());
      Object.values(routeOutlinesRef.current).forEach((l) => l.remove());
      Object.values(distanceBubblesRef.current).forEach((m) => m.remove());
    };
  }, [responders, incidents, map]);

  return null;
}

// =====================================================
// MAIN COMPONENT
// =====================================================
export default function LeafletMapNew({
  incidents = [],
  center = { lat: 10.3157, lng: 123.8854 },
  zoom = 12,
  responderLocations = {},
  mapType = 'street',
  onIncidentSelect,
  selectedIncidentId,
  rescuers = [],
}: LeafletMapNewProps) {
  const mapRef = useRef<L.Map | null>(null);
  const [hoveredMarkerId, setHoveredMarkerId] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const mergedResponders = useMemo(() => {
    const merged: Record<string, ResponderLocation> = { ...responderLocations };
    rescuers.forEach((r) => {
      merged[r.id] = {
        lat: r.lat,
        lng: r.lng,
        status: r.status,
        responderName: r.name,
        // ✅ Assign the target incident if it exists
        incidentId: selectedIncidentId ? String(selectedIncidentId) : undefined,
      };
    });
    return merged;
  }, [responderLocations, rescuers, selectedIncidentId]);

  useEffect(() => {
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
      .leaflet-control-attribution { background: rgba(30, 41, 59, 0.85) !important; color: #94A3B8 !important; font-size: 10px !important; padding: 2px 8px !important; border-radius: 4px !important; }
      .leaflet-control-attribution a { color: #60A5FA !important; }
    `;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  const renderIncidentMarkers = () => {
    return incidents.map((incident) => {
      const isSelected = selectedIncidentId === incident.id;
      const isHovered = hoveredMarkerId === incident.id;
      const icon = createPinIcon(true, isSelected, isHovered);

      const rawStatus = incident.status || 'dispatched';
      const liveStatus = normalizeStatus(rawStatus);
      const liveStatusLabel = statusLabel(rawStatus);
      const liveStatusBg = statusBg(rawStatus);
      const liveStatusText = statusColor(rawStatus);
      const displayType = getDisplayIncidentType(incident.type, incident.specificType);

      const popupHtml = `
        <div style="padding: 2px 0;">
          <h4 style="margin: 0 0 5px 0; font-size: 12.5px; font-weight: 700; color:${liveStatusText};">🚨 ${displayType}</h4>
          <div style="margin: 4px 0; padding: 5px 8px; background:${liveStatusBg}; border-radius: 6px; border-left: 3px solid ${liveStatusText};">
            <div style="display:flex;align-items:center;gap:5px;color:${liveStatusText};font-weight:600;font-size:10.5px;line-height:1.25;">
              <i class="fa fa-exclamation-triangle" style="color:${liveStatusText};"></i>
              ${liveStatus === 'enroute' ? 'Responder is en route to this location' : liveStatus === 'on_scene' ? 'Responder has arrived at the scene' : 'Units have been dispatched'}
            </div>
          </div>
          <div style="margin: 2px 0; font-size: 11px; line-height: 1.3;"><strong>Type:</strong> ${displayType}</div>
          <div style="margin: 2px 0; font-size: 11px; line-height: 1.3;"><strong>Status:</strong> <span style="background:${liveStatusBg};color:${liveStatusText};padding:1px 6px;border-radius:6px;font-weight:700;font-size:9.5px;margin-left:3px;">${liveStatusLabel}</span></div>
          <div style="margin: 2px 0; font-size: 11px; line-height: 1.3;"><strong>Time:</strong> ${incident.time || 'Just now'}</div>
          ${incident.location ? `<div style="margin: 2px 0; font-size: 11px; line-height: 1.3;"><strong>Location:</strong> ${incident.location}</div>` : ''}
        </div>
      `;

      return (
        <Marker
          key={incident.id}
          position={[incident.lat, incident.lng]}
          icon={icon}
          riseOnHover={true}
          eventHandlers={{
            mouseover: () => setHoveredMarkerId(String(incident.id)),
            mouseout: () => setHoveredMarkerId(null),
            click: () => { if (onIncidentSelect) onIncidentSelect(String(incident.id)); }
          }}
        >
          <Popup className="custom-popup">
            <div dangerouslySetInnerHTML={{ __html: popupHtml }} />
          </Popup>
        </Marker>
      );
    });
  };

  const renderPulseRings = () => {
    return incidents
      .filter(i => normalizeStatus(i.status) !== 'resolved')
      .map((incident) => (
        <Marker
          key={`pulse-${incident.id}`}
          position={[incident.lat, incident.lng]}
          icon={createPulseRing()}
          interactive={false}
          zIndexOffset={-100}
        />
      ));
  };

  const renderResponderMarkers = () => {
    return Object.entries(mergedResponders)
      .filter(([, loc]) => isMissionActive(loc.status))
      .map(([id, loc]) => {
        const icon = createResponderIcon(loc.status, id);
        const popupHtml = `
          <div style="padding: 4px 0;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
              <span style="display:inline-block;width:10px;height:10px;background:${colorForResponder(id)};border-radius:50%;"></span>
              <strong style="color:#0F172A;font-size:14px;">${loc.responderName || 'Responder'}</strong>
            </div>
            <div style="font-size:12px;color:#475569;">
              <strong>Status:</strong> <span style="background:#DBEAFE;color:#2563EB;padding:1px 8px;border-radius:8px;font-weight:700;font-size:11px;">${statusLabel(loc.status)}</span>
            </div>
            <div style="font-size:11px;color:#64748B;margin-top:4px;">📍 ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}</div>
          </div>
        `;
        return (
          <Marker key={`responder-${id}`} position={[loc.lat, loc.lng]} icon={icon} zIndexOffset={50000} riseOnHover={true}>
            <Popup><div dangerouslySetInnerHTML={{ __html: popupHtml }} /></Popup>
          </Marker>
        );
      });
  };

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={zoom}
        style={{ height: '100%', width: '100%', background: '#0F172A' }}
        zoomControl={false}
        attributionControl={true}
        ref={mapRef}
        whenReady={() => setMapReady(true)}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
          opacity={mapType === 'street' ? 1 : 0}
        />
        <TileLayer
          attribution='&copy; <a href="https://www.google.com/maps">Google</a>'
          url="https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
          maxZoom={20}
          subdomains={['mt0', 'mt1', 'mt2', 'mt3']}
          opacity={mapType === 'satellite' ? 1 : 0}
        />
        {renderPulseRings()}
        {renderIncidentMarkers()}
        {renderResponderMarkers()}
        {mapReady && mapRef.current && (
          <RouteRenderer responders={mergedResponders} incidents={incidents} map={mapRef.current} />
        )}
      </MapContainer>
    </div>
  );
}