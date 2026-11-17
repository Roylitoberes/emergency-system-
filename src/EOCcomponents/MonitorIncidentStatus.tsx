import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import L from 'leaflet';
import '../css/MonitorIncidentStatus.css';
import GoogleMap from './GoogleMap';
import { firestore } from '../firebase';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp,
  addDoc,
  where,
  getDocs,
  setDoc,
} from 'firebase/firestore';
import {
  getFirestore,
  collection as fsCollection,
  onSnapshot as fsOnSnapshot,
} from 'firebase/firestore';
import { sendPushToUser } from '../services/sendPushNotification';

interface MonitorIncidentStatusProps {
  sidebarOpen?: boolean;
  highlightIncidentId?: string | null;
}

interface Incident {
  id: string;
  type: string;
  title: string;
  barangay: string;
  responder: string;
  userId?: string;
  status:
    | 'reported'
    | 'verified'
    | 'dispatched'
    | 'en-route'
    | 'on-scene'
    | 'backup'
    | 'resolved';
  time: string;
  progress: number;
  severity: string;
  resolvedAt?: string;
  finalReport?: string;
  awaitingReport: boolean;
  needsBackup: boolean;
  backupDispatched: boolean;
  date?: string;
  location?: string;
  fullDate?: string;
  lat?: number;
  lng?: number;
  description?: string;
  firebaseId?: string;
  dispatchedUnits?: string;
  dispatchTime?: string;
  arrivedAt?: string;
}

interface BackupInfo {
  category: string;
  description: string;
  responderName: string;
  createdAtMs: number;
}

interface BackupLocation {
  lat: number;
  lng: number;
  responderName: string;
  createdAtMs: number;
  category: string;
  description: string;
  userId?: string;
}

interface ResponderInfo {
  lat: number;
  lng: number;
  status: string;
  responderName?: string;
  userId?: string;
  incidentId: string;
}

// ✅ Available responder (from manage_users)
interface AvailableResponder {
  id: string;
  name: string;
  role: string;
  type: string;
  capability: string;
  eta: string;
  code: string;
  station?: string;
  profile?: string;
  phone?: string;
  specialization?: string;
  status: string;
}

type ResolveResult =
  | {
      ok: true;
      responder: {
        id: string;
        name: string;
        userId: string;
        lat: number;
        lng: number;
        status: string;
        source: string;
      };
    }
  | {
      ok: false;
      reason: string;
      diagnostics: string;
    };

// ============================================================
// Helpers for mapping responder roles → unit info
// ============================================================
const getUnitTypeFromRole = (role: string): string => {
  const roleMap: { [key: string]: string } = {
    'Fire Responder': 'Fire Truck',
    'Police Officer': 'Patrol Unit',
    'Medical Staff': 'Ambulance',
    'Rescue Team': 'Rescue Unit',
    Paramedic: 'Ambulance',
    Volunteer: 'Rescue Unit',
    'EOC Personnel': 'EOC Unit',
    'EOC Dispatcher': 'EOC Unit',
    'EOC Manager': 'EOC Unit',
    'EOC Supervisor': 'EOC Unit',
    'EOC Coordinator': 'EOC Unit',
  };
  return roleMap[role] || 'Response Unit';
};

const getCapabilityFromRole = (role: string): string => {
  const capabilityMap: { [key: string]: string } = {
    'Fire Responder': 'Fire Suppression',
    'Police Officer': 'Traffic Control & Security',
    'Medical Staff': 'Medical Support',
    'Rescue Team': 'Search & Rescue',
    Paramedic: 'Emergency Medical Response',
    Volunteer: 'General Response',
    'EOC Personnel': 'Emergency Coordination',
    'EOC Dispatcher': 'Emergency Dispatch',
    'EOC Manager': 'Emergency Management',
    'EOC Supervisor': 'Emergency Supervision',
    'EOC Coordinator': 'Emergency Coordination',
  };
  return capabilityMap[role] || 'Emergency Response';
};

const getUnitCode = (_name: string, role: string): string => {
  const prefixMap: { [key: string]: string } = {
    'Fire Responder': 'BFP',
    'Police Officer': 'PNP',
    'Medical Staff': 'MED',
    'Rescue Team': 'RSC',
    Paramedic: 'PAR',
    Volunteer: 'VOL',
    'EOC Personnel': 'EOC',
    'EOC Dispatcher': 'DSP',
    'EOC Manager': 'MGR',
    'EOC Supervisor': 'SUP',
    'EOC Coordinator': 'COR',
  };
  const prefix = prefixMap[role] || 'RES';
  const randomNum = Math.floor(Math.random() * 100)
    .toString()
    .padStart(3, '0');
  return `${prefix}-${randomNum}`;
};

const getETA = (role: string): string => {
  const etaMap: { [key: string]: string } = {
    'Fire Responder': '6 mins',
    'Police Officer': '8 mins',
    'Medical Staff': '5 mins',
    'Rescue Team': '8 mins',
    Paramedic: '5 mins',
    Volunteer: '10 mins',
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
  if (typeLower.includes('fire') || typeLower.includes('emergency'))
    return 'emergency';
  if (typeLower.includes('accident') || typeLower.includes('vehicle'))
    return 'high';
  if (typeLower.includes('medical')) return 'high';
  if (typeLower.includes('flood') || typeLower.includes('tree')) return 'medium';
  return 'medium';
};

const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);

const fetchJsonWithTimeout = (
  url: string,
  timeoutMs: number,
  label: string
): Promise<any> => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let done = false;

    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => {
        try {
          xhr.abort();
        } catch {}
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      });
    }, timeoutMs);

    xhr.open('GET', url, true);
    xhr.timeout = timeoutMs;

    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return;
      finish(() => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            reject(new Error(`${label}: invalid JSON`));
          }
        } else {
          reject(new Error(`${label}: HTTP ${xhr.status}`));
        }
      });
    };

    xhr.onerror = () =>
      finish(() => reject(new Error(`${label}: network error`)));
    xhr.ontimeout = () =>
      finish(() => reject(new Error(`${label}: XHR timeout`)));

    try {
      xhr.send();
    } catch (err: any) {
      finish(() =>
        reject(new Error(`${label}: send failed — ${err?.message || err}`))
      );
    }
  });
};

// ============================================================
// ✅ Published routes hook (mirrors GoogleMap.tsx exactly)
// ============================================================
interface PublishedRoute {
  points: [number, number][];
  distanceText: string;
  etaText: string;
  distanceKm: number;
  etaMinutes: number;
  isAssigned: boolean;
  cleared: boolean;
}

// ✅ Sends an item to the Dashboard "Recent activity" feed
const logActivity = async (payload: {
  icon: string;
  tone: 'forest' | 'gold' | 'clay';
  title: string;
  meta: string;
}) => {
  try {
    const now = new Date().toISOString();
    await addDoc(collection(firestore, 'activity_feed'), {
      type: 'activity',
      icon: payload.icon,
      tone: payload.tone,
      title: payload.title,
      meta: payload.meta,
      time: now,
      createdAt: now,
    });
  } catch (err) {
    console.warn('Could not log activity:', err);
  }
};

const usePublishedRoutes = () => {
  const [routes, setRoutes] = useState<Record<string, PublishedRoute>>({});

  useEffect(() => {
    let unsub: (() => void) | undefined;
    try {
      const db = getFirestore();
      const routesRef = fsCollection(db, 'responder_routes');
      unsub = fsOnSnapshot(
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
              .filter(
                ([a, b]) =>
                  Number.isFinite(a) &&
                  Number.isFinite(b) &&
                  !(a === 0 && b === 0)
              );

            next[incidentId] = {
              points,
              distanceText: (data.distanceText || '--').toString(),
              etaText: (data.etaText || '--').toString(),
              distanceKm: Number(data.distanceKm) || 0,
              etaMinutes: Number(data.etaMinutes) || 0,
              isAssigned: data.isAssigned === true,
              cleared,
            };
          });
          setRoutes(next);
        },
        (err) => console.error('❌ responder_routes snapshot error:', err)
      );
    } catch (err) {
      console.error('❌ Failed to init responder_routes listener:', err);
    }
    return () => {
      if (unsub) unsub();
    };
  }, []);

  return routes;
};

// ============================================================
// ✅ Available Units count — SAME rule as AppEOC / Dispatch Responders
// available = active responders in manage_users − busy responders
// busy = dispatched / enroute / on_scene with no final report yet
// ============================================================
const useAvailableUnitsCount = () => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const db = getFirestore();

    let responderIds: string[] = [];
    let notifs: any[] = [];
    let tracking: Array<{ id: string; data: any }> = [];
    const finished = new Set<string>();

    const norm = (raw?: string) => {
      const s = (raw || '').toLowerCase().trim().replace(/[\s-]/g, '_');
      if (s === 'enroute' || s === 'en_route') return 'enroute';
      if (s === 'onscene' || s === 'on_scene') return 'on_scene';
      return s;
    };

    const recompute = () => {
      const busy = new Set<string>();

      notifs.forEach((d) => {
        const s = norm(d.status);
        if (s !== 'dispatched' && s !== 'enroute' && s !== 'on_scene') return;
        const uid = d.userId || d.responderUid;
        const incId = d.incidentId ? String(d.incidentId) : '';
        if (uid && !finished.has(incId)) busy.add(uid);
      });

      tracking.forEach(({ id, data }) => {
        const s = norm(data.status);
        if (s !== 'enroute' && s !== 'on_scene') return;
        const uid = data.responderId;
        const incId = String(data.incidentId || id);
        if (uid && !finished.has(incId)) busy.add(uid);
      });

      setCount(responderIds.filter((id) => !busy.has(id)).length);
    };

    const unsubs = [
      fsOnSnapshot(
        fsCollection(db, 'manage_users'),
        (snap) => {
          responderIds = snap.docs
            .filter((d) => {
              const x: any = d.data();
              return x.status === 'active' && x.userType !== 'eoc';
            })
            .map((d) => d.id);
          recompute();
        },
        (e) => console.error('❌ manage_users (available units) error:', e)
      ),
      fsOnSnapshot(
        fsCollection(db, 'responder_notifications'),
        (snap) => {
          notifs = snap.docs.map((d) => d.data());
          recompute();
        },
        (e) => console.error('❌ notifications (available units) error:', e)
      ),
      fsOnSnapshot(
        fsCollection(db, 'responder_tracking'),
        (snap) => {
          tracking = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
          recompute();
        },
        (e) => console.error('❌ tracking (available units) error:', e)
      ),
      fsOnSnapshot(
        fsCollection(db, 'final_reports'),
        (snap) => {
          finished.clear();
          snap.docs.forEach((d) => {
            finished.add(d.id);
            const x: any = d.data();
            if (x.incidentId) finished.add(String(x.incidentId));
          });
          recompute();
        },
        (e) => console.error('❌ final_reports (available units) error:', e)
      ),
    ];

    return () => unsubs.forEach((u) => u());
  }, []);

  return count;
};

// ============================================================
// ✅ NEW: Generate New Route modal (manual route planning)
// ============================================================
type RouteLL = { lat: number; lng: number };

interface RouteStepData {
  instruction: string;
  distance: number;
  duration: number;
  name: string;
  maneuver: string;
  modifier: string;
}

interface ManualRoutePayload {
  distanceMeters: number;
  durationSeconds: number;
  geometry: [number, number][];
  steps: RouteStepData[];
  waypoints: RouteLL[];
  routingMode: 'road' | 'manual';
}

interface GenerateRouteModalProps {
  incident: { id: string; type: string; title?: string; lat?: number; lng?: number };
  responder: { id: string; name: string; userId: string; lat: number; lng: number } | null;
  blockedLoc?: { lat: number; lng: number; category: string; description?: string } | null;
  requestTimeMs?: number;
  resolving: boolean;
  error: string | null;
  diagnostics: string | null;
  needsManualUserId: boolean;
  manualUserId: string;
  onManualUserIdChange: (v: string) => void;
  onManualUserIdSubmit: () => void;
  onRetry: () => void;
  sending: boolean;
  sent: boolean;
  sendError?: string | null;
  onClose: () => void;
  onSend: (route: ManualRoutePayload) => Promise<void> | void;
  publishedRoutes?: Record<string, PublishedRoute>;
  liveResponder?: { lat: number; lng: number; status: string } | null;
}

const grmRad = (d: number) => (d * Math.PI) / 180;

const grmHaversine = (a: RouteLL, b: RouteLL): number => {
  const R = 6371000;
  const dLat = grmRad(b.lat - a.lat);
  const dLng = grmRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(grmRad(a.lat)) * Math.cos(grmRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
};

const grmBearingName = (a: RouteLL, b: RouteLL): string => {
  const y = Math.sin(grmRad(b.lng - a.lng)) * Math.cos(grmRad(b.lat));
  const x =
    Math.cos(grmRad(a.lat)) * Math.sin(grmRad(b.lat)) -
    Math.sin(grmRad(a.lat)) * Math.cos(grmRad(b.lat)) * Math.cos(grmRad(b.lng - a.lng));
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  const names = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
  return names[Math.round(deg / 45) % 8];
};

const grmFmtDistance = (m: number): string =>
  m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;

const grmFmtDuration = (s: number): string => {
  const mins = Math.max(1, Math.ceil(s / 60));
  if (mins < 60) return `${mins} mins`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} hr ${m} mins` : `${h} hr`;
};

const grmInstructionFor = (step: any): string => {
  const m = step?.maneuver || {};
  const type = (m.type || '').toLowerCase();
  const mod = (m.modifier || '').toLowerCase();
  const name = step?.name ? ` onto ${step.name}` : '';
  switch (type) {
    case 'depart': return `Head ${mod || 'forward'}${name}`;
    case 'arrive': return 'Arrive at your destination';
    case 'turn': return `Turn ${mod || 'ahead'}${name}`;
    case 'new name': return `Continue${name}`;
    case 'merge': return `Merge ${mod || ''}${name}`;
    case 'on ramp': return `Take the ramp${name}`;
    case 'off ramp': return `Take the exit${name}`;
    case 'fork': return `Keep ${mod || 'straight'} at the fork${name}`;
    case 'roundabout':
    case 'rotary': return `At the roundabout, take exit ${m.exit || 1}${name}`;
    case 'end of road': return `At the end of the road, turn ${mod || ''}${name}`;
    case 'continue': return `Continue ${mod || 'straight'}${name}`;
    default: return `Proceed${name}`;
  }
};

const grmPinIcon = (color: string, iconClass: string, label?: string) =>
  L.divIcon({
    className: 'grm-pin-wrap',
    html:
      `<div class="grm-pin" style="background:${color}"><i class="${iconClass}"></i></div>` +
      (label ? `<span class="grm-pin-label" style="background:${color}">${label}</span>` : ''),
    iconSize: [34, 44],
    iconAnchor: [17, 42],
  });

const grmWpIcon = (n: number, editable: boolean) =>
  L.divIcon({
    className: 'grm-wp-wrap',
    html: `<div class="grm-wp${editable ? ' editable' : ''}">${n}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });

type GrmTool = 'add' | 'draw' | 'edit' | null;

interface GrmRouteResult {
  distanceMeters: number;
  durationSeconds: number;
  geometry: [number, number][];
  steps: RouteStepData[];
}

const GenerateRouteModal: React.FC<GenerateRouteModalProps> = ({
  incident,
  responder,
  blockedLoc,
  resolving,
  error,
  diagnostics,
  needsManualUserId,
  manualUserId,
  onManualUserIdChange,
  onManualUserIdSubmit,
  onRetry,
  sending,
  sent,
  sendError,
  onClose,
  onSend,
  publishedRoutes = {},
  liveResponder = null,
}) => {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const wpGroupRef = useRef<L.LayerGroup | null>(null);
  const routeLineRef = useRef<L.Polyline | null>(null);
  const toolRef = useRef<GrmTool>('add');
  const sendLockRef = useRef(false);
  const routeTokenRef = useRef(0);

  const liveRouteLineRef = useRef<L.Polyline | null>(null);
  const liveRouteOutlineRef = useRef<L.Polyline | null>(null);
  const liveResponderMarkerRef = useRef<L.Marker | null>(null);
  const liveBubbleRef = useRef<L.Marker | null>(null);

  const [mapType, setMapType] = useState<'street' | 'satellite'>('street');
  const [tool, setTool] = useState<GrmTool>('add');
  const [routingMode, setRoutingMode] = useState<'road' | 'manual'>('road');
  const [waypoints, setWaypoints] = useState<RouteLL[]>([]);
  const [route, setRoute] = useState<GrmRouteResult | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeErr, setRouteErr] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [liveNavEnabled, setLiveNavEnabled] = useState(true);

  toolRef.current = tool;

  const hasCoords = typeof incident.lat === 'number' && typeof incident.lng === 'number';
  const mapReady = !!responder && hasCoords && !needsManualUserId;

  useEffect(() => {
    if (!mapReady || !mapDivRef.current || !responder) return;

    const map = L.map(mapDivRef.current, {
      zoomControl: false,
      attributionControl: true,
      doubleClickZoom: false,
    }).setView([incident.lat!, incident.lng!], 13);
    mapRef.current = map;

    wpGroupRef.current = L.layerGroup().addTo(map);

    L.marker([responder.lat, responder.lng], {
      icon: grmPinIcon('#16A34A', 'fa fa-truck-medical', 'Responder'),
      zIndexOffset: 500,
    }).addTo(map);

    L.marker([incident.lat!, incident.lng!], {
      icon: grmPinIcon('#DC2626', 'fa fa-fire', 'Incident'),
      zIndexOffset: 600,
    }).addTo(map);

    if (blockedLoc) {
      L.marker([blockedLoc.lat, blockedLoc.lng], {
        icon: grmPinIcon('#F59E0B', 'fa fa-triangle-exclamation', 'Blocked'),
      }).addTo(map);
    }

    map.on('click', (e: L.LeafletMouseEvent) => {
      const t = toolRef.current;
      if (t === 'add' || t === 'draw') {
        setPreviewing(false);
        setWaypoints((w) => [...w, { lat: e.latlng.lat, lng: e.latlng.lng }]);
      }
    });

    map.fitBounds(
      L.latLngBounds([
        [responder.lat, responder.lng],
        [incident.lat!, incident.lng!],
      ]),
      { padding: [60, 60], maxZoom: 15 }
    );

    const t1 = setTimeout(() => map.invalidateSize(), 80);
    const t2 = setTimeout(() => map.invalidateSize(), 400);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);

      liveRouteLineRef.current?.remove();
      liveRouteOutlineRef.current?.remove();
      liveResponderMarkerRef.current?.remove();
      liveBubbleRef.current?.remove();
      liveRouteLineRef.current = null;
      liveRouteOutlineRef.current = null;
      liveResponderMarkerRef.current = null;
      liveBubbleRef.current = null;

      map.remove();
      mapRef.current = null;
      baseLayerRef.current = null;
      wpGroupRef.current = null;
      routeLineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, responder?.id]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (baseLayerRef.current) map.removeLayer(baseLayerRef.current);
    const layer =
      mapType === 'street'
        ? L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap contributors',
          })
        : L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            { maxZoom: 19, attribution: 'Tiles &copy; Esri' }
          );
    layer.addTo(map);
    layer.bringToBack();
    baseLayerRef.current = layer;
  }, [mapType, mapReady, responder?.id]);

  useEffect(() => {
    const group = wpGroupRef.current;
    if (!group) return;
    group.clearLayers();
    const editable = tool === 'edit';
    waypoints.forEach((wp, i) => {
      const m = L.marker([wp.lat, wp.lng], {
        icon: grmWpIcon(i + 1, editable),
        draggable: editable,
        zIndexOffset: 400,
      });
      if (editable) {
        m.on('dragend', () => {
          const p = m.getLatLng();
          setPreviewing(false);
          setWaypoints((prev) => prev.map((w, idx) => (idx === i ? { lat: p.lat, lng: p.lng } : w)));
        });
        m.on('dblclick', (ev: any) => {
          if (ev?.originalEvent) L.DomEvent.stopPropagation(ev.originalEvent);
          setPreviewing(false);
          setWaypoints((prev) => prev.filter((_, idx) => idx !== i));
        });
      }
      group.addLayer(m);
    });
  }, [waypoints, tool, mapReady, responder?.id]);

  useEffect(() => {
    if (!responder || !hasCoords) return;

    if (waypoints.length === 0) {
      routeTokenRef.current++;
      setRoute(null);
      setRouteErr(null);
      setRouteBusy(false);
      return;
    }

    const startPt: RouteLL = liveResponder
      ? { lat: liveResponder.lat, lng: liveResponder.lng }
      : { lat: responder.lat, lng: responder.lng };

    const pts: RouteLL[] = [
      startPt,
      ...waypoints,
      { lat: incident.lat!, lng: incident.lng! },
    ];
    const token = ++routeTokenRef.current;

    if (routingMode === 'manual') {
      let dist = 0;
      const steps: RouteStepData[] = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const d = grmHaversine(pts[i], pts[i + 1]);
        dist += d;
        const last = i === pts.length - 2;
        steps.push({
          instruction: last
            ? `Head ${grmBearingName(pts[i], pts[i + 1])} and arrive at incident location`
            : i === 0
            ? `Head ${grmBearingName(pts[i], pts[i + 1])} toward waypoint 1`
            : `From waypoint ${i}, head ${grmBearingName(pts[i], pts[i + 1])} toward waypoint ${i + 1}`,
          distance: d,
          duration: d / (40000 / 3600),
          name: '',
          maneuver: i === 0 ? 'depart' : last ? 'arrive' : 'continue',
          modifier: '',
        });
      }
      setRoute({
        distanceMeters: dist,
        durationSeconds: dist / (40000 / 3600),
        geometry: pts.map((p) => [p.lat, p.lng] as [number, number]),
        steps,
      });
      setRouteErr(null);
      setRouteBusy(false);
      return;
    }

    setRouteBusy(true);
    const timer = setTimeout(async () => {
      try {
        const coords = pts.map((p) => `${p.lng},${p.lat}`).join(';');
        const url =
          `https://router.project-osrm.org/route/v1/driving/${coords}` +
          `?overview=full&geometries=geojson&steps=true&continue_straight=false`;
        const data = await fetchJsonWithTimeout(url, 15000, 'OSRM route fetch');
        if (token !== routeTokenRef.current) return;
        if (data?.code !== 'Ok' || !data?.routes?.length) {
          throw new Error('No road route found through these waypoints.');
        }
        const r = data.routes[0];
        const legs: any[] = r.legs || [];
        const steps: RouteStepData[] = [];
        legs.forEach((leg, li) => {
          const isLastLeg = li === legs.length - 1;
          (leg.steps || []).forEach((s: any) => {
            const type = (s?.maneuver?.type || '').toLowerCase();
            if (type === 'arrive') {
              steps.push({
                instruction: isLastLeg ? 'Arrive at incident location' : `Reach waypoint ${li + 1}`,
                distance: Number(s.distance) || 0,
                duration: Number(s.duration) || 0,
                name: s.name || '',
                maneuver: 'arrive',
                modifier: '',
              });
              return;
            }
            steps.push({
              instruction: grmInstructionFor(s),
              distance: Number(s.distance) || 0,
              duration: Number(s.duration) || 0,
              name: s.name || '',
              maneuver: s.maneuver?.type || '',
              modifier: s.maneuver?.modifier || '',
            });
          });
        });
        setRoute({
          distanceMeters: Number(r.distance) || 0,
          durationSeconds: Number(r.duration) || 0,
          geometry: (r.geometry?.coordinates || []).map(
            (c: [number, number]) => [c[1], c[0]] as [number, number]
          ),
          steps,
        });
        setRouteErr(null);
      } catch (e: any) {
        if (token !== routeTokenRef.current) return;
        setRouteErr(e?.message || 'Failed to compute route.');
        setRoute(null);
      } finally {
        if (token === routeTokenRef.current) setRouteBusy(false);
      }
    }, 400);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waypoints, routingMode, responder?.id, mapReady, liveResponder?.lat, liveResponder?.lng]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (routeLineRef.current) {
      map.removeLayer(routeLineRef.current);
      routeLineRef.current = null;
    }
    if (!route || route.geometry.length < 2) return;
    const line = L.polyline(route.geometry, {
      color: '#2563EB',
      weight: previewing ? 8 : 5,
      opacity: 0.95,
      lineJoin: 'round',
      dashArray: routingMode === 'manual' ? '10 8' : undefined,
    }).addTo(map);
    routeLineRef.current = line;
    if (previewing) map.fitBounds(line.getBounds(), { padding: [50, 50] });
  }, [route, previewing, routingMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !responder || !hasCoords) return;

    if (!liveNavEnabled) {
      liveRouteLineRef.current?.remove();
      liveRouteOutlineRef.current?.remove();
      liveResponderMarkerRef.current?.remove();
      liveBubbleRef.current?.remove();
      liveRouteLineRef.current = null;
      liveRouteOutlineRef.current = null;
      liveResponderMarkerRef.current = null;
      liveBubbleRef.current = null;
      return;
    }

    const routeKeyCandidates = [
      incident.id,
      (incident as any).incidentId,
      (incident as any).firebaseId,
    ].filter(Boolean) as string[];

    let live: PublishedRoute | undefined;
    for (const k of routeKeyCandidates) {
      if (publishedRoutes && publishedRoutes[k]) {
        live = publishedRoutes[k];
        break;
      }
    }

    if (!live || live.cleared || live.points.length < 2) {
      if (liveRouteLineRef.current) {
        liveRouteLineRef.current.remove();
        liveRouteLineRef.current = null;
      }
      if (liveRouteOutlineRef.current) {
        liveRouteOutlineRef.current.remove();
        liveRouteOutlineRef.current = null;
      }
      if (liveBubbleRef.current) {
        liveBubbleRef.current.remove();
        liveBubbleRef.current = null;
      }
    } else {
      let pts = live.points.slice();
      let closestIdx = 0;
      let minD = Infinity;
      pts.forEach((p, i) => {
        const d = grmHaversine(
          { lat: p[0], lng: p[1] },
          { lat: incident.lat!, lng: incident.lng! }
        );
        if (d < minD) {
          minD = d;
          closestIdx = i;
        }
      });
      if (closestIdx > 0 && closestIdx < pts.length - 1) {
        pts = pts.slice(0, closestIdx + 1);
        pts.push([incident.lat!, incident.lng!]);
      }

      const color = live.isAssigned ? '#0B6B43' : '#16A34A';

      if (!liveRouteOutlineRef.current) {
        liveRouteOutlineRef.current = L.polyline(pts, {
          color: '#FFFFFF',
          weight: 10,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false,
        }).addTo(map);
      } else {
        liveRouteOutlineRef.current.setLatLngs(pts);
      }
      liveRouteOutlineRef.current.bringToBack();

      if (!liveRouteLineRef.current) {
        liveRouteLineRef.current = L.polyline(pts, {
          color,
          weight: 6,
          opacity: 1,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false,
        }).addTo(map);
      } else {
        liveRouteLineRef.current.setLatLngs(pts);
        liveRouteLineRef.current.setStyle({ color });
      }

      const mid = pts[Math.floor(pts.length / 2)];
      const bubbleIcon = L.divIcon({
        className: 'grm-live-bubble',
        html: `
          <div style="
            display:inline-flex;flex-direction:column;align-items:center;
            background:#0B1220;color:#fff;padding:6px 14px;border-radius:10px;
            border:2px solid ${color}66;font-family:inherit;
            box-shadow:0 4px 14px rgba(0,0,0,0.4);white-space:nowrap;
            transform:translate(-50%,-50%);
          ">
            <div style="font-size:12px;font-weight:800;color:${color};">${live.distanceText}</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.75);margin-top:1px;">${live.etaText} drive</div>
          </div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      if (!liveBubbleRef.current) {
        liveBubbleRef.current = L.marker([mid[0], mid[1]], {
          icon: bubbleIcon,
          interactive: false,
          zIndexOffset: 800,
        }).addTo(map);
      } else {
        liveBubbleRef.current.setLatLng([mid[0], mid[1]]);
        liveBubbleRef.current.setIcon(bubbleIcon);
      }
    }

    if (liveResponder) {
      const color = live?.isAssigned ? '#0B6B43' : '#16A34A';
      const statusText = (liveResponder.status || 'en-route')
        .replace('-', ' ')
        .toUpperCase();

      const markerIcon = L.divIcon({
        className: 'grm-live-responder',
        html: `
          <div style="position:relative;width:64px;height:64px;display:flex;align-items:center;justify-content:center;">
            <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:56px;height:56px;border-radius:50%;background:${color}30;animation:grmLivePulse 1.6s ease-out infinite;"></div>
            <div style="position:relative;width:48px;height:34px;margin-top:-8px;">
              <div style="position:absolute;right:0;bottom:0;width:18px;height:22px;background:${color};border:2px solid #fff;border-radius:4px 8px 4px 4px;box-shadow:0 3px 9px rgba(0,0,0,0.4);"></div>
              <div style="position:absolute;right:3px;bottom:12px;width:10px;height:7px;background:#BFDBFE;border-radius:2px 4px 0 0;"></div>
              <div style="position:absolute;left:0;bottom:0;width:32px;height:26px;background:${color};border:2px solid #fff;border-radius:3px;box-shadow:0 3px 9px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;">
                <i class="fa fa-plus" style="color:#fff;font-size:14px;font-weight:900;line-height:1;"></i>
              </div>
              <div style="position:absolute;left:4px;bottom:-5px;width:9px;height:9px;background:#0F172A;border:2px solid #fff;border-radius:50%;"></div>
              <div style="position:absolute;left:19px;bottom:-5px;width:9px;height:9px;background:#0F172A;border:2px solid #fff;border-radius:50%;"></div>
              <div style="position:absolute;right:3px;bottom:-5px;width:9px;height:9px;background:#0F172A;border:2px solid #fff;border-radius:50%;"></div>
            </div>
            <div style="position:absolute;bottom:-2px;left:50%;transform:translateX(-50%);background:${color};color:#fff;font-size:7.5px;font-weight:800;letter-spacing:0.4px;padding:2px 8px;border-radius:8px;white-space:nowrap;text-transform:uppercase;border:1px solid #fff;box-shadow:0 2px 5px rgba(0,0,0,0.35);">
              ${statusText}
            </div>
          </div>`,
        iconSize: [64, 64],
        iconAnchor: [32, 46],
        popupAnchor: [0, -40],
      });

      if (!liveResponderMarkerRef.current) {
        liveResponderMarkerRef.current = L.marker(
          [liveResponder.lat, liveResponder.lng],
          { icon: markerIcon, zIndexOffset: 900 }
        ).addTo(map);
      } else {
        liveResponderMarkerRef.current.setLatLng([
          liveResponder.lat,
          liveResponder.lng,
        ]);
        liveResponderMarkerRef.current.setIcon(markerIcon);
      }
    } else if (liveResponderMarkerRef.current) {
      liveResponderMarkerRef.current.remove();
      liveResponderMarkerRef.current = null;
    }

    if (!document.getElementById('grm-live-nav-style')) {
      const s = document.createElement('style');
      s.id = 'grm-live-nav-style';
      s.textContent = `
        @keyframes grmLivePulse {
          0% { transform: translate(-50%, -50%) scale(0.7); opacity: 0.85; }
          70% { transform: translate(-50%, -50%) scale(1.4); opacity: 0; }
          100% { transform: translate(-50%, -50%) scale(1.4); opacity: 0; }
        }
        .grm-live-bubble, .grm-live-responder { background: none !important; border: none !important; }
      `;
      document.head.appendChild(s);
    }
  }, [
    publishedRoutes,
    liveResponder?.lat,
    liveResponder?.lng,
    liveResponder?.status,
    liveNavEnabled,
    responder?.id,
    incident.id,
    incident.lat,
    incident.lng,
    hasCoords,
  ]);

  const pickTool = (t: GrmTool) => {
    setPreviewing(false);
    setTool((cur) => (cur === t ? null : t));
    if (t === 'add') setRoutingMode('road');
    if (t === 'draw') setRoutingMode('manual');
  };

  const handleClear = () => {
    if (waypoints.length === 0) return;
    if (window.confirm('Clear all waypoints and the selected route?')) {
      setPreviewing(false);
      setWaypoints([]);
      setRoute(null);
      setRouteErr(null);
    }
  };

  const handleLocate = () => {
    if (mapRef.current) {
      if (liveResponder) {
        mapRef.current.flyTo([liveResponder.lat, liveResponder.lng], 16, { duration: 0.8 });
      } else if (responder) {
        mapRef.current.flyTo([responder.lat, responder.lng], 16, { duration: 0.8 });
      }
    }
  };

  const handlePreview = () => {
    if (!route) return;
    setTool(null);
    setPreviewing((p) => !p);
  };

  const handleSend = async () => {
    if (!route || sendLockRef.current || sending || sent) return;
    sendLockRef.current = true;
    try {
      await onSend({
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        geometry: route.geometry,
        steps: route.steps,
        waypoints,
        routingMode,
      });
    } finally {
      sendLockRef.current = false;
    }
  };

  const canSend = !!route && !routeBusy && !sending && !sent && waypoints.length > 0;

  return createPortal(
    <div
      className="grm-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !sending) onClose();
      }}
    >
      <div className="grm-modal" role="dialog" aria-modal="true">
        <button
          className="grm-close grm-close-floating"
          onClick={onClose}
          aria-label="Close"
          type="button"
        >
          <i className="fa fa-times" />
        </button>

        {resolving && !responder && (
          <div className="grm-state">
            <div className="loading-spinner" />
            <strong>Locating responder…</strong>
            <span>Checking live responder tracking.</span>
          </div>
        )}

        {!resolving && needsManualUserId && (
          <div className="grm-state error">
            <i className="fa fa-user-circle" />
            <strong>Responder userId required</strong>
            <span className="grm-left">{error}</span>
            <input
              type="text"
              placeholder="Paste responder userId (auth UID)"
              value={manualUserId}
              onChange={(e) => onManualUserIdChange(e.target.value)}
            />
            <button
              className="grm-btn primary"
              disabled={!manualUserId.trim()}
              onClick={onManualUserIdSubmit}
            >
              <i className="fa fa-route" /> Continue
            </button>
            {diagnostics && <pre className="grm-diag">{diagnostics}</pre>}
          </div>
        )}

        {!resolving && !needsManualUserId && !responder && (
          <div className="grm-state error">
            <i className="fa fa-triangle-exclamation" />
            <strong>Could not load responder</strong>
            <span className="grm-left">{error || 'No responder available for this incident.'}</span>
            <button className="grm-btn" onClick={onRetry}>
              <i className="fa fa-rotate-right" /> Try Again
            </button>
          </div>
        )}

        {!resolving && responder && !hasCoords && (
          <div className="grm-state error">
            <i className="fa fa-triangle-exclamation" />
            <strong>Incident has no coordinates</strong>
          </div>
        )}

        {mapReady && (
          <>
            <div className="grm-map-wrap">
              <div ref={mapDivRef} className="grm-map" />

              <div className="grm-maptype">
                <button className={mapType === 'street' ? 'active' : ''} onClick={() => setMapType('street')}>
                  <i className="fa fa-map" /> Map
                </button>
                <button className={mapType === 'satellite' ? 'active' : ''} onClick={() => setMapType('satellite')}>
                  <i className="fa fa-satellite" /> Satellite
                </button>
              </div>

              <div className="grm-tools">
                <button className={tool === 'add' ? 'active' : ''} onClick={() => pickTool('add')}>
                  <i className="fa fa-location-dot" />
                  <span>Add Waypoint</span>
                </button>
                <button className={tool === 'draw' ? 'active' : ''} onClick={() => pickTool('draw')}>
                  <i className="fa fa-bezier-curve" />
                  <span>Draw Route</span>
                </button>
                <button
                  className={tool === 'edit' ? 'active' : ''}
                  onClick={() => pickTool('edit')}
                  disabled={waypoints.length === 0}
                >
                  <i className="fa fa-pen" />
                  <span>Edit Point</span>
                </button>
                <button onClick={handleClear} disabled={waypoints.length === 0}>
                  <i className="fa fa-trash" />
                  <span>Clear</span>
                </button>
                <button
                  className={liveNavEnabled ? 'active' : ''}
                  onClick={() => setLiveNavEnabled((v) => !v)}
                  title="Show/hide the responder's live GPS polyline"
                >
                  <i className="fa fa-satellite-dish" />
                  <span>Live Nav</span>
                </button>
              </div>

              <div className="grm-zoom">
                <button onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom in">
                  <i className="fa fa-plus" />
                </button>
                <button onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom out">
                  <i className="fa fa-minus" />
                </button>
                <button onClick={handleLocate} aria-label="Locate responder">
                  <i className="fa fa-crosshairs" />
                </button>
              </div>

              <div className="grm-legend">
                <div><span className="dot green" /> Responder</div>
                <div><span className="dot red" /> Incident (destination)</div>
                <div><span className="dot blue" /> Waypoint</div>
                <div><span className="line" /> Planned route</div>
                {liveNavEnabled && (
                  <div><span className="line" style={{ background: '#16A34A' }} /> Live route</div>
                )}
                {blockedLoc && <div><span className="dot amber" /> Reported blockage</div>}
              </div>

              {(routeBusy || routeErr || waypoints.length === 0 || previewing) && (
                <div className={`grm-hint ${routeErr ? 'error' : ''}`}>
                  {routeBusy
                    ? 'Calculating route…'
                    : routeErr
                    ? routeErr
                    : previewing
                    ? 'Previewing selected route — click Preview Route again to resume editing.'
                    : tool === 'draw'
                    ? 'Draw Route: click the map to lay down the path point by point.'
                    : 'Click the map to add waypoints and build the route.'}
                </div>
              )}
            </div>

            <div className="grm-panels">
              <div className="grm-panel">
                <div className="grm-panel-title">
                  <i className="fa fa-list-ul" /> Route Details
                </div>
                <div className="grm-detail">
                  <span><i className="fa fa-road" /> Distance:</span>
                  <b>{route ? grmFmtDistance(route.distanceMeters) : '—'}</b>
                </div>
                <div className="grm-detail">
                  <span><i className="fa fa-clock" /> Estimated Time:</span>
                  <b>{route ? grmFmtDuration(route.durationSeconds) : '—'}</b>
                </div>
                <div className="grm-detail">
                  <span><i className="fa fa-location-dot" /> Waypoints:</span>
                  <b>{waypoints.length}</b>
                </div>
                <div className="grm-detail">
                  <span><i className="fa fa-share-nodes" /> Route Points:</span>
                  <b>{route ? route.geometry.length : 0}</b>
                </div>
              </div>

              <div className="grm-panel">
                <div className="grm-panel-title">
                  <i className="fa fa-diamond-turn-right" /> Turn-by-Turn Directions
                </div>
                <div className="grm-steps">
                  {route && route.steps.length > 0 ? (
                    route.steps.map((s, i) => (
                      <div className="grm-step" key={i}>
                        <span className="grm-step-num">{i + 1}</span>
                        <span className="grm-step-text">{s.instruction}</span>
                        <span className="grm-step-dist">{grmFmtDistance(s.distance)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="grm-steps-empty">
                      Directions will appear here once you add waypoints.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {sendError && <div className="grm-send-error">{sendError}</div>}

        <div className="grm-footer">
          <button className="grm-btn" onClick={onClose} disabled={sending}>
            <i className="fa fa-reply" /> Cancel
          </button>
          <button
            className={`grm-btn outline ${previewing ? 'on' : ''}`}
            onClick={handlePreview}
            disabled={!route || sending}
          >
            <i className="fa fa-eye" /> Preview Route
          </button>
          <button className="grm-btn danger" onClick={handleSend} disabled={!canSend}>
            <i className="fa fa-paper-plane" />{' '}
            {sending ? 'Sending…' : sent ? 'Route Sent' : 'Send Route to Responder'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

const MonitorIncidentStatus: React.FC<MonitorIncidentStatusProps> = ({
  highlightIncidentId = null,
}) => {
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedType, setSelectedType] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIncident, setSelectedIncident] = useState<string | null>(null);

  const [focusIncidentId, setFocusIncidentId] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);

  const [mapType, setMapType] = useState<'street' | 'satellite'>('street');

  const [showBackupModal, setShowBackupModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [activeIncident, _setActiveIncident] = useState<Incident | null>(null);
  const [mapCenter, setMapCenter] = useState({ lat: 14.5995, lng: 120.9842 });
  const [mapZoom, setMapZoom] = useState(13);
  const [loading, setLoading] = useState(true);

  const [pulseIncidentId, setPulseIncidentId] = useState<string | null>(null);

  const [incidents, setIncidents] = useState<Incident[]>([]);

  const [responderLocations, setResponderLocations] = useState<
    Record<string, ResponderInfo>
  >({});

  const [backupByIncident, setBackupByIncident] = useState<
    Record<string, BackupInfo>
  >({});

  const [backupLocationByIncident, setBackupLocationByIncident] = useState<
    Record<string, BackupLocation>
  >({});

  const [showRouteModal, setShowRouteModal] = useState(false);
  const [routeTargetIncident, setRouteTargetIncident] = useState<Incident | null>(null);
  const [routeResponder, setRouteResponder] = useState<{
    id: string;
    name: string;
    userId: string;
    lat: number;
    lng: number;
    status: string;
    source: string;
  } | null>(null);
  const [routeReporterInfo, setRouteReporterInfo] = useState<{
    name: string;
    phone: string;
  } | null>(null);

  const [, setRouteAlternatives] = useState<
    {
      id: number;
      distanceMeters: number;
      durationSeconds: number;
      geometry: [number, number][];
      steps: any[];
    }[]
  >([]);
  const [, setSelectedRouteIdx] = useState<number>(0);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeDiagnostics, setRouteDiagnostics] = useState<string | null>(null);
  const [sendingRoute, setSendingRoute] = useState(false);
  const [routeSentOk, setRouteSentOk] = useState(false);

  const [manualUserId, setManualUserId] = useState('');
  const [needsManualUserId, setNeedsManualUserId] = useState(false);

  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [dispatchTargetIncident, setDispatchTargetIncident] = useState<Incident | null>(null);
  const [availableResponders, setAvailableResponders] = useState<AvailableResponder[]>([]);
  const [selectedResponderIds, setSelectedResponderIds] = useState<string[]>([]);
  const [dispatchLoading, setDispatchLoading] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [isDispatchingBackup, setIsDispatchingBackup] = useState(false);
  const [dispatchSuccess, setDispatchSuccess] = useState(false);

  const publishedRoutes = usePublishedRoutes();
  // ✅ Live Available Units count (same rule as AppEOC dashboard)
  const availableUnitsCount = useAvailableUnitsCount();

  useEffect(() => {
    if (showRouteModal || showDispatchModal) {
      document.body.classList.add('route-modal-open');
    } else {
      document.body.classList.remove('route-modal-open');
    }
    return () => {
      document.body.classList.remove('route-modal-open');
    };
  }, [showRouteModal, showDispatchModal]);

  useEffect(() => {
    console.log('📡 Listening to monitoring_status collection...');

    const normalizeStatus = (raw: string | undefined): Incident['status'] => {
      const s = (raw || '').toLowerCase().trim().replace(/[\s_-]/g, '');
      if (s === 'enroute') return 'en-route';
      if (s === 'onscene') return 'on-scene';
      if (s === 'backup') return 'backup';
      if (s === 'resolved' || s === 'completed') return 'resolved';
      if (s === 'dispatched') return 'dispatched';
      if (s === 'verified') return 'verified';
      if (s === 'reported' || s === 'pending') return 'reported';
      return 'reported';
    };

    const progressFromStatus = (status: Incident['status']): number => {
      switch (status) {
        case 'reported': return 1;
        case 'verified': return 2;
        case 'dispatched': return 3;
        case 'en-route': return 4;
        case 'backup': return 4;
        case 'on-scene': return 5;
        case 'resolved': return 7;
        default: return 1;
      }
    };

    const formatTime = (raw: any): string => {
      if (!raw) return '';
      try {
        const date = raw?.toDate
          ? raw.toDate()
          : typeof raw === 'object' && raw?.seconds
          ? new Date(raw.seconds * 1000)
          : new Date(raw);
        if (!isNaN(date.getTime())) {
          return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
      } catch {
        if (typeof raw === 'string') return raw.slice(0, 5);
      }
      return '';
    };

    const toMillis = (val: any): number => {
      if (!val) return 0;
      if (typeof val?.toDate === 'function') return val.toDate().getTime();
      if (typeof val?.seconds === 'number') return val.seconds * 1000;
      const d = new Date(val);
      return isNaN(d.getTime()) ? 0 : d.getTime();
    };

    try {
      const monitoringRef = collection(firestore, 'monitoring_status');
      const q = query(monitoringRef, orderBy('createdAt', 'desc'));

      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const incidentMap = new Map<string, Incident>();

          snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const uniqueKey = data.incidentId || docSnap.id;
            if (!uniqueKey || uniqueKey === '' || data.type === 'Unknown') return;

            const title = data.title || data.type || '';
            const location = data.location || 'Unknown location';
            if (title === 'Emergency Response' || location === 'Unknown location') return;
            if (incidentMap.has(uniqueKey)) return;

            const normalized = normalizeStatus(data.status);
            const progress =
              typeof data.progress === 'number' && data.progress > 0
                ? data.progress
                : progressFromStatus(normalized);

            const dispatchTimeDisplay =
              formatTime(data.dispatchTime) || formatTime(data.acceptedAt) || '';
            const arrivalTimeDisplay = formatTime(data.arrivedAt) || '';
            const resolvedTimeDisplay =
              formatTime(data.resolvedAt) || formatTime(data.completedAt) || '';

            incidentMap.set(uniqueKey, {
              id: data.id || data.incidentId || docSnap.id,
              type: data.type || 'Unknown',
              title: data.title || data.type || 'Incident',
              barangay: data.barangay || 'Unknown',
              responder: data.responder || data.unitName || 'Unassigned',
              userId: data.userId || data.responderId || data.assignedUserId || '',
              status: normalized,
              time: data.time || formatTime(data.createdAt) || '--:--',
              progress,
              severity: data.severity || 'medium',
              awaitingReport: data.awaitingReport || false,
              needsBackup: data.needsBackup || false,
              backupDispatched: data.backupDispatched || false,
              date: data.date || new Date().toLocaleDateString(),
              location,
              fullDate: data.fullDate || new Date().toLocaleDateString('en-US', {
                month: 'long', day: 'numeric', year: 'numeric',
              }),
              lat: data.lat || 14.5995,
              lng: data.lng || 120.9842,
              description: data.description || 'No description',
              firebaseId: docSnap.id,
              dispatchedUnits: data.dispatchedUnits || '',
              dispatchTime: dispatchTimeDisplay,
              resolvedAt: resolvedTimeDisplay,
              finalReport: data.finalReport || '',
              arrivedAt: arrivalTimeDisplay,
            } as Incident & { arrivedAt?: string });
          });

          const locationMap = new Map<string, Incident>();
          Array.from(incidentMap.values()).forEach((incident) => {
            const locationKey = `${incident.title}_${incident.location}`;
            const existing = locationMap.get(locationKey);
            if (existing) {
              const existingTime = toMillis(existing.dispatchTime);
              const currentTime = toMillis(incident.dispatchTime);
              if (currentTime > existingTime) locationMap.set(locationKey, incident);
            } else {
              locationMap.set(locationKey, incident);
            }
          });

          let incidentList = Array.from(locationMap.values());
          incidentList.sort((a, b) => toMillis(b.dispatchTime) - toMillis(a.dispatchTime));

          setIncidents(incidentList);
          setLoading(false);

          if (incidentList.length > 0 && !selectedIncident) {
            setSelectedIncident(incidentList[0].id);
          }

          setTimeout(() => {
            setIncidents((prev) => {
              const seen = new Set<string>();
              const cleaned = prev.filter((incident) => {
                const key = `${incident.title}_${incident.location}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              });
              return cleaned.length !== prev.length ? cleaned : prev;
            });
          }, 10000);
        },
        (error) => {
          console.error('❌ Error listening to monitoring_status:', error);
          setLoading(false);
        }
      );

      return () => unsubscribe();
    } catch (error) {
      console.error('❌ Error setting up monitoring_status listener:', error);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const trackingRef = collection(firestore, 'responder_tracking');

    const unsub = onSnapshot(
      trackingRef,
      (snap) => {
        const locationMap: Record<string, ResponderInfo> = {};

        snap.docs.forEach((docSnap) => {
          const data = docSnap.data();
          const rawLat = data.lat;
          const rawLng = data.lng;

          if (rawLat === null || rawLat === undefined) return;
          if (rawLng === null || rawLng === undefined) return;

          const lat = Number(rawLat);
          const lng = Number(rawLng);

          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
          if (lat === 0 && lng === 0) return;
          if (lat < 4 || lat > 22 || lng < 116 || lng > 127) return;

          const incidentId = data.incidentId || data.incident_id || docSnap.id;
          if (!incidentId || incidentId === '' || incidentId === 'undefined') return;

          const rawStatus = (data.status || '').toLowerCase().trim();
          let status = 'dispatched';
          if (rawStatus === 'enroute' || rawStatus === 'en_route') status = 'enroute';
          else if (rawStatus === 'onscene' || rawStatus === 'on_scene') status = 'on_scene';
          else if (rawStatus === 'backup') status = 'backup';
          else if (rawStatus === 'resolved' || rawStatus === 'completed') return;

          if (status === 'enroute' || status === 'on_scene' || status === 'backup') {
            locationMap[docSnap.id] = {
              lat,
              lng,
              status,
              responderName: data.responderName || data.name || 'Responder',
              userId: data.userId || data.uid || data.responderId || '',
              incidentId: String(incidentId),
            };
          }
        });

        setResponderLocations(locationMap);
      },
      (err) => console.error('❌ responder_tracking snapshot error:', err)
    );

    return () => unsub();
  }, []);

  useEffect(() => {
    const backupRef = collection(firestore, 'backup_requests');

    let q;
    try {
      q = query(backupRef, orderBy('createdAt', 'desc'));
    } catch {
      q = query(backupRef);
    }

    const unsub = onSnapshot(
      q,
      (snap) => {
        const map: Record<string, BackupInfo> = {};
        const locMap: Record<string, BackupLocation> = {};

        snap.docs.forEach((docSnap) => {
          const data = docSnap.data() as any;
          const incidentKey = (data.reportId || data.incidentId || '').toString().trim();
          if (!incidentKey) return;

          const createdAtMs =
            typeof data.createdAt?.toDate === 'function'
              ? data.createdAt.toDate().getTime()
              : typeof data.createdAt?.seconds === 'number'
              ? data.createdAt.seconds * 1000
              : 0;

          const info: BackupInfo = {
            category: (data.category || data.type || 'Backup Request').toString(),
            description: (data.description || '').toString().trim(),
            responderName: (data.responderName || data.responder || 'Responder').toString(),
            createdAtMs,
          };

          const prev = map[incidentKey];
          if (!prev || info.createdAtMs > prev.createdAtMs) map[incidentKey] = info;

          const rawLat = data.lat;
          const rawLng = data.lng;
          const lat =
            typeof rawLat === 'number'
              ? rawLat
              : typeof rawLat === 'string' && rawLat.trim() !== ''
              ? parseFloat(rawLat)
              : NaN;
          const lng =
            typeof rawLng === 'number'
              ? rawLng
              : typeof rawLng === 'string' && rawLng.trim() !== ''
              ? parseFloat(rawLng)
              : NaN;

          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            const locInfo: BackupLocation = {
              lat,
              lng,
              responderName: (data.responderName || data.responder || 'Responder').toString(),
              createdAtMs,
              category: (data.category || data.type || 'Backup Request').toString(),
              description: (data.description || '').toString().trim(),
              userId: (data.userId || data.responderId || '').toString(),
            };
            const prevLoc = locMap[incidentKey];
            if (!prevLoc || locInfo.createdAtMs > prevLoc.createdAtMs) {
              locMap[incidentKey] = locInfo;
            }
          }
        });

        setBackupByIncident(map);
        setBackupLocationByIncident(locMap);
      },
      (err) => console.error('❌ backup_requests snapshot error:', err)
    );

    return () => unsub();
  }, []);

  const findBackupFor = (incident: Incident): BackupInfo | undefined => {
    if (!incident) return undefined;
    const candidates = [incident.id, incident.firebaseId]
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .map((v) => v.toLowerCase());

    for (const key of Object.keys(backupByIncident)) {
      const k = key.toLowerCase();
      if (candidates.includes(k)) return backupByIncident[key];
    }
    return undefined;
  };

  const findBackupLocationFor = (
    incident: Incident
  ): BackupLocation | undefined => {
    if (!incident) return undefined;
    const candidates = [incident.id, incident.firebaseId]
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .map((v) => v.toLowerCase());

    for (const key of Object.keys(backupLocationByIncident)) {
      const k = key.toLowerCase();
      if (candidates.includes(k)) return backupLocationByIncident[key];
    }
    return undefined;
  };

  const findLiveResponderLocationFor = (
    incident: Incident
  ): ResponderInfo | undefined => {
    const incidentKeys = [incident.id, incident.firebaseId, (incident as any).incidentId]
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .map((v) => v.trim().toLowerCase());

    for (const r of Object.values(responderLocations)) {
      const rInc = (r.incidentId || '').toString().toLowerCase();
      if (!rInc) continue;
      if (incidentKeys.some((k) => rInc === k || rInc.includes(k) || k.includes(rInc))) {
        return r;
      }
    }
    return undefined;
  };

  const handleOpenResponderLocation = (
    e: React.MouseEvent,
    lat: number,
    lng: number
  ) => {
    e.stopPropagation();
    const url = `https://www.google.com/maps?q=${lat},${lng}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const fetchReporterInfo = async (
    incident: Incident
  ): Promise<{ name: string; phone: string } | null> => {
    const db = firestore;

    const incidentKeys = [
      incident.id,
      incident.firebaseId,
      (incident as any).incidentId,
    ]
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .map((v) => v.trim());

    const extractName = (d: any): string => {
      if (!d) return '';
      const direct =
        d.reporterName ||
        d.reporterFullName ||
        d.fullName ||
        d.name ||
        d.reporter;
      if (
        typeof direct === 'string' &&
        direct.trim() !== '' &&
        direct.trim() !== 'None'
      ) {
        return direct.trim();
      }
      if (d.reporter && typeof d.reporter === 'object') {
        const n =
          d.reporter.fullName ||
          d.reporter.name ||
          d.reporter.displayName ||
          '';
        if (typeof n === 'string' && n.trim() !== '') return n.trim();
      }
      return '';
    };

    const extractPhone = (d: any): string => {
      if (!d) return '';
      const direct =
        d.reporterPhone ||
        d.phoneNumber ||
        d.phone ||
        d.contact ||
        d.reporterPhoneNumber;
      if (
        typeof direct === 'string' &&
        direct.trim() !== '' &&
        direct.trim() !== 'None'
      ) {
        return direct.trim();
      }
      if (d.reporter && typeof d.reporter === 'object') {
        const p =
          d.reporter.phoneNumber ||
          d.reporter.phone ||
          d.reporter.contact ||
          '';
        if (typeof p === 'string' && p.trim() !== '') return p.trim();
      }
      return '';
    };

    for (const key of incidentKeys) {
      try {
        const snap = await getDocs(
          query(
            collection(db, 'incident_reports'),
            where('incidentId', '==', key)
          )
        );
        for (const d of snap.docs) {
          const data = d.data();
          const name = extractName(data);
          const phone = extractPhone(data);
          if (name || phone) {
            return { name: name || 'Unknown', phone: phone || 'Unknown' };
          }
        }
      } catch {}
    }

    for (const key of incidentKeys) {
      try {
        const snap = await getDocs(
          query(
            collection(db, 'incident_reports'),
            where('reportId', '==', key)
          )
        );
        for (const d of snap.docs) {
          const data = d.data();
          const name = extractName(data);
          const phone = extractPhone(data);
          if (name || phone) {
            return { name: name || 'Unknown', phone: phone || 'Unknown' };
          }
        }
      } catch {}
    }

    for (const key of incidentKeys) {
      try {
        const all = await getDocs(collection(db, 'incident_reports'));
        const match = all.docs.find(
          (d) =>
            d.id === key ||
            (d.data().incidentId || '').toString() === key ||
            (d.data().reportId || '').toString() === key
        );
        if (match) {
          const data = match.data();
          const name = extractName(data);
          const phone = extractPhone(data);
          if (name || phone) {
            return { name: name || 'Unknown', phone: phone || 'Unknown' };
          }
        }
      } catch {}
    }

    for (const key of incidentKeys) {
      try {
        const snap = await getDocs(
          query(
            collection(db, 'responder_notifications'),
            where('incidentId', '==', key)
          )
        );
        for (const d of snap.docs) {
          const data = d.data();
          const name = extractName(data);
          const phone = extractPhone(data);
          if (name || phone) {
            return { name: name || 'Unknown', phone: phone || 'Unknown' };
          }
        }
      } catch {}
    }

    for (const key of incidentKeys) {
      try {
        const snap = await getDocs(
          query(
            collection(db, 'monitoring_status'),
            where('incidentId', '==', key)
          )
        );
        for (const d of snap.docs) {
          const data = d.data();
          const name = extractName(data);
          const phone = extractPhone(data);
          if (name || phone) {
            return { name: name || 'Unknown', phone: phone || 'Unknown' };
          }
        }
      } catch {}
    }

    return null;
  };

  const handleOpenViewDispatch = async (incident: Incident) => {
    console.log('[DISPATCH] Opening dispatch modal for incident:', incident.id);

    setDispatchTargetIncident(incident);
    setAvailableResponders([]);
    setSelectedResponderIds([]);
    setDispatchError(null);
    setDispatchSuccess(false);
    setDispatchLoading(true);
    setShowDispatchModal(true);

    try {
      const db = firestore;
      const respondersList: AvailableResponder[] = [];
      const seenIds = new Set<string>();

      try {
        const manageUsersRef = collection(db, 'manage_users');
        const manageUsersSnap = await getDocs(manageUsersRef);

        console.log(`📋 Found ${manageUsersSnap.size} users in manage_users`);

        manageUsersSnap.forEach((docSnap) => {
          const data = docSnap.data();
          if (seenIds.has(docSnap.id)) return;

          if (data.status === 'active' && data.userType !== 'eoc') {
            const role = data.role || 'Responder';
            const name = data.name || 'Unknown Responder';
            const userId = docSnap.id;

            const alreadyAssigned =
              (incident.dispatchedUnits || '')
                .split(',')
                .map((n) => n.trim())
                .includes(name);
            if (alreadyAssigned) return;

            respondersList.push({
              id: userId,
              name,
              role,
              type: getUnitTypeFromRole(role),
              capability: getCapabilityFromRole(role),
              eta: getETA(role),
              code: getUnitCode(name, role),
              station: data.station || data.department || '',
              profile: data.profile || '',
              phone: data.phone || '',
              specialization: data.specialization || '',
              status: 'available',
            });
            seenIds.add(userId);
          }
        });
      } catch (err) {
        console.error('❌ Error loading manage_users:', err);
      }

      respondersList.sort((a, b) => a.name.localeCompare(b.name));

      console.log(`✅ Loaded ${respondersList.length} available responders`);
      setAvailableResponders(respondersList);

      if (respondersList.length === 0) {
        setDispatchError(
          'No available responders found. Add responders in Manage Users to see them here.'
        );
      }
    } catch (err: any) {
      console.error('❌ Error loading available responders:', err);
      setDispatchError(err?.message || 'Failed to load available responders.');
    } finally {
      setDispatchLoading(false);
    }
  };

  const handleToggleResponder = (responderId: string) => {
    setSelectedResponderIds((prev) =>
      prev.includes(responderId)
        ? prev.filter((id) => id !== responderId)
        : [...prev, responderId]
    );
  };

  const handleDispatchBackupResponders = async () => {
    if (!dispatchTargetIncident) return;
    if (selectedResponderIds.length === 0) {
      alert('⚠️ Please select at least one responder to dispatch.');
      return;
    }

    setIsDispatchingBackup(true);

    try {
      const db = firestore;
      const incident = dispatchTargetIncident;

      // ✅ Capture the ORIGINAL backup request (before we write anything)
      const originalBackup = findBackupFor(incident);
      const originalBackupLoc = findBackupLocationFor(incident);
      const originalLive = findLiveResponderLocationFor(incident);

      // ✅ Exclude the EOC itself from the requester resolution so EOC
      //    never receives its own backup messages.
      const candidateRequesterIds = [
        originalBackupLoc?.userId,
        originalLive?.userId,
        incident.userId,
      ]
        .map((v) => (v || '').toString().trim())
        .filter((v) => v.length > 0);

      const requesterUserId =
        candidateRequesterIds.find(
          (id) => !selectedResponderIds.includes(id)
        ) || '';

      const selectedResponders = availableResponders.filter((r) =>
        selectedResponderIds.includes(r.id)
      );

      const responderNames = selectedResponders.map((r) => r.name).join(', ');

      const notifPromises = selectedResponders.map((responder) => {
        const notifRef = collection(db, 'responder_notifications');
        return setDoc(doc(notifRef), {
          userId: responder.id,
          incidentId: incident.id,
          type: incident.type || 'Unknown Incident',
          specificType: null,
          location: incident.location || 'Unknown location',
          description: incident.description || 'No description',
          date:
            incident.date ||
            new Date().toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            }),
          time: incident.time || new Date().toLocaleTimeString(),
          status: 'dispatched',
          severity: getSeverity(incident.type),
          photoUrl: null,
          lat: incident.lat || 0,
          lng: incident.lng || 0,
          casualties: { injured: 0, fatalities: 0, trapped: 0 },
          reporterName: null,
          reporterPhone: null,
          reporter: null,
          phone: null,
          assignedBy: 'EOC Backup Dispatch',
          dispatchedAt: new Date().toISOString(),
          createdAt: serverTimestamp(),
          read: false,
          isAssignedToUser: true,
          isBackup: true,
          unitName: responder.name,
          unitCode: responder.code,
          unitType: responder.type,
          eta: responder.eta,
          responderUid: responder.id,
        });
      });

      await Promise.all(notifPromises);
      console.log(
        `✅ Sent backup notifications to ${selectedResponders.length} responders`
      );

      if (incident.firebaseId) {
        const newDispatched = incident.dispatchedUnits
          ? `${incident.dispatchedUnits}, ${responderNames}`
          : responderNames;

        const monitorRef = doc(db, 'monitoring_status', incident.firebaseId);
        await updateDoc(monitorRef, {
          needsBackup: false,
          backupDispatched: true,
          dispatchedUnits: newDispatched,
          backupDispatchedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        console.log('✅ Updated monitoring_status with backup units');
      }

      // ✅ REMOVED: no more writing to `backup_requests` here.
      //    `backup_requests` is only for INCOMING requests from responders.
      //    Writing to it from the EOC dispatch flow was what created the
      //    "EOC Manual Backup [incidentId] — Backup dispatched by EOC: …"
      //    card in the EOC's own message box.

      // ✅ Notify the responder who REQUESTED backup (shows in their EOC Message Box)
      //    Guarded so the EOC never messages itself, and skips if the
      //    resolved requester is one of the dispatched responders.
      try {
        const requesterId = requesterUserId;
        const isSelf = requesterId && selectedResponderIds.includes(requesterId);
        if (requesterId && !isSelf) {
          const reqCategory = originalBackup?.category || 'Backup Request';
          const reqDescription = originalBackup?.description || '';

          const unitLines = selectedResponders
            .map((r, i) => `${i + 1}. ${r.name} (${r.type} • ${r.code}) — ETA ${r.eta}`)
            .join('\n');

          const msgBody =
            `Your backup request has been received and backup is on the way.\n\n` +
            `🆘 Request: ${reqCategory}\n` +
            (reqDescription ? `📝 Details: ${reqDescription}\n` : '') +
            `🚨 Incident: ${incident.title || incident.type} (${incident.id})\n` +
            `📍 Location: ${incident.location || 'Unknown'}\n\n` +
            `🚑 Dispatched responder${selectedResponders.length > 1 ? 's' : ''}:\n` +
            `${unitLines}\n\n` +
            `Stay safe and hold your position until backup arrives.`;

          await addDoc(collection(db, 'responder_messages'), {
            userId: requesterId,
            from: 'EOC',
            subject: `Backup Dispatched — ${reqCategory}`,
            message: msgBody,
            priority: 'high',
            read: false,
            createdAt: serverTimestamp(),
          });

          try {
            await sendPushToUser(
              requesterId,
              '🚑 Backup Dispatched',
              `EOC dispatched ${responderNames} for your "${reqCategory}" request.`,
              { incidentId: incident.id, type: 'backup_dispatched' }
            );
          } catch (pushErr) {
            console.warn('Push to requesting responder failed:', pushErr);
          }
        } else if (isSelf) {
          console.warn(
            'Skipped backup message: requester is the same user being dispatched (EOC self-dispatch).'
          );
        } else {
          console.warn('No requesting responder userId found; skipped message.');
        }
      } catch (msgErr) {
        console.warn('Could not message requesting responder:', msgErr);
      }

      // ── reporter notify block (unchanged) ───────────────────
      try {
        const reportsRef = collection(db, 'incident_reports');
        const allReports = await getDocs(reportsRef);
        let reporterUserId: string | null = null;

        allReports.forEach((d) => {
          const data = d.data();
          const matchesId =
            d.id === incident.id ||
            data.incidentId === incident.id ||
            data.reportId === incident.id;
          if (matchesId && data.userId && data.userId !== 'eoc-user') {
            reporterUserId = data.userId;
          }
        });

        if (reporterUserId) {
          const userNotifRef = collection(db, 'user_notifications');
          await setDoc(doc(userNotifRef), {
            userId: reporterUserId,
            reportId: incident.id,
            title: '🚑 Backup Responders Dispatched',
            message: `Additional responders have been dispatched to your report: ${responderNames}.`,
            incidentType: incident.type || 'Unknown',
            assignedResponders: selectedResponders.map((r) => ({
              name: r.name,
              role: r.role || '',
              type: r.type || '',
              eta: r.eta || '',
            })),
            read: false,
            createdAt: serverTimestamp(),
            type: 'backup_dispatch',
          });

          await sendPushToUser(
            reporterUserId,
            '🚑 Backup Responders Dispatched',
            `Additional responders have been dispatched to your report: ${responderNames}.`,
            { reportId: incident.id, type: 'backup_dispatch' }
          );
        }
      } catch (notifErr) {
        console.warn('Could not notify reporter of backup dispatch:', notifErr);
      }

      for (const responder of selectedResponders) {
        try {
          const trackingRef = collection(db, 'responder_tracking');
          const existing = await getDocs(
            query(trackingRef, where('userId', '==', responder.id))
          );

          if (existing.empty) {
            const trackingDoc = doc(trackingRef);
            await setDoc(trackingDoc, {
              userId: responder.id,
              responderName: responder.name,
              incidentId: incident.id,
              status: 'dispatched',
              lat: incident.lat || 14.5995,
              lng: incident.lng || 120.9842,
              updatedAt: serverTimestamp(),
              createdAt: serverTimestamp(),
            });
          } else {
            const existingDoc = existing.docs[0];
            await updateDoc(existingDoc.ref, {
              incidentId: incident.id,
              responderName: responder.name,
              status: 'dispatched',
              updatedAt: serverTimestamp(),
            });
          }
        } catch (e) {
          console.warn('Could not seed responder_tracking:', e);
        }
      }

      const requestedBy =
        originalBackup?.responderName || originalBackupLoc?.responderName || 'a responder';
      const backupWhy = originalBackup
        ? ` · Request: ${originalBackup.category}${
            originalBackup.description ? ` — "${originalBackup.description}"` : ''
          }`
        : '';
      const backupWhere = originalBackupLoc
        ? ` · Backup location: ${originalBackupLoc.lat.toFixed(5)}, ${originalBackupLoc.lng.toFixed(5)}`
        : '';

      await logActivity({
        icon: 'truck',
        tone: 'gold',
        title: `🚑 Backup Dispatched — ${incident.type || 'Incident'}`,
        meta:
          `EOC dispatched ${responderNames} as backup for the ${incident.type || 'Incident'} ` +
          `incident at ${incident.location || 'unknown location'} (requested by ${requestedBy})` +
          `${backupWhy}${backupWhere}`,
      });

      setDispatchSuccess(true);

      setIncidents((prev) =>
        prev.map((i) =>
          i.id === incident.id
            ? {
                ...i,
                needsBackup: false,
                backupDispatched: true,
                dispatchedUnits: i.dispatchedUnits
                  ? `${i.dispatchedUnits}, ${responderNames}`
                  : responderNames,
              }
            : i
        )
      );

      setTimeout(() => {
        setShowDispatchModal(false);
        setDispatchSuccess(false);
        setSelectedResponderIds([]);
      }, 1800);
    } catch (err: any) {
      console.error('❌ Error dispatching backup responders:', err);
      setDispatchError(err?.message || 'Failed to dispatch backup responders.');
    } finally {
      setIsDispatchingBackup(false);
    }
  };

  const resolveResponderLocally = (incident: Incident): ResolveResult => {
    const diagnostics: string[] = [];
    const incidentKeys = [
      incident.id,
      incident.firebaseId,
      (incident as any).incidentId,
    ]
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .map((v) => v.trim().toLowerCase());

    diagnostics.push(`incident keys: ${JSON.stringify(incidentKeys)}`);

    const entries = Object.entries(responderLocations);
    diagnostics.push(`live responder_tracking docs: ${entries.length}`);

    for (const [id, r] of entries) {
      diagnostics.push(
        `  • tracking "${id}" | incidentId="${r.incidentId}" | ` +
          `userId="${r.userId || '—'}" | name="${r.responderName || '—'}" | ` +
          `status="${r.status}"`
      );
    }

    const backupLoc = findBackupLocationFor(incident);

    const matched = entries.filter(([, r]) => {
      const rInc = (r.incidentId || '').toString().toLowerCase();
      if (!rInc) return false;
      return incidentKeys.some(
        (k) => rInc === k || rInc.includes(k) || k.includes(rInc)
      );
    });

    if (matched.length > 0) {
      const [id, r] = matched[0];
      let userId = (r.userId || '').toString();

      if (!userId && incident.userId) {
        userId = incident.userId;
        diagnostics.push(`using incident.userId as fallback: ${userId}`);
      }

      if (!userId && backupLoc?.userId) {
        userId = backupLoc.userId;
        diagnostics.push(`using backup_requests.userId: ${userId}`);
      }

      if (!userId) {
        return {
          ok: false,
          reason:
            `Matched responder "${r.responderName}" but no userId was found on the ` +
            `tracking doc, the incident, or the backup request. Please provide the ` +
            `responder's userId manually.`,
          diagnostics: diagnostics.join('\n'),
        };
      }

      return {
        ok: true,
        responder: {
          id,
          name: r.responderName || 'Responder',
          userId,
          lat: r.lat,
          lng: r.lng,
          status: r.status,
          source: 'responder_tracking (matched incidentId)',
        },
      };
    }

    if (entries.length > 0 && incident.lat && incident.lng) {
      const sorted = entries
        .map(([id, r]) => {
          const d = Math.hypot(r.lat - incident.lat!, r.lng - incident.lng!);
          return { id, r, d };
        })
        .sort((a, b) => a.d - b.d);

      const { id, r } = sorted[0];
      let userId = (r.userId || '').toString();
      if (!userId && incident.userId) userId = incident.userId;
      if (!userId && backupLoc?.userId) userId = backupLoc.userId;

      if (!userId) {
        return {
          ok: false,
          reason:
            `No exact match. Nearest live responder "${r.responderName}" has no userId. ` +
            `Please provide the responder's userId manually.`,
          diagnostics: diagnostics.join('\n'),
        };
      }

      return {
        ok: true,
        responder: {
          id,
          name: r.responderName || 'Responder',
          userId,
          lat: r.lat,
          lng: r.lng,
          status: r.status,
          source: 'responder_tracking (nearest live)',
        },
      };
    }

    if (backupLoc) {
      const userId = (backupLoc.userId || incident.userId || '').toString();
      if (userId) {
        return {
          ok: true,
          responder: {
            id: `backup_${incident.id}`,
            name: backupLoc.responderName || 'Responder',
            userId,
            lat: backupLoc.lat,
            lng: backupLoc.lng,
            status: incident.status,
            source: 'backup_requests location',
          },
        };
      }
    }

    if (incident.userId) {
      return {
        ok: true,
        responder: {
          id: `ms_${incident.id}`,
          name: incident.responder || 'Responder',
          userId: incident.userId,
          lat: incident.lat!,
          lng: incident.lng!,
          status: incident.status,
          source: 'monitoring_status (incident.userId)',
        },
      };
    }

    return {
      ok: false,
      reason:
        `No live responder_tracking doc matched this incident, and neither the ` +
        `incident nor the backup request carries a userId. Please provide the ` +
        `responder's userId manually.`,
      diagnostics: diagnostics.join('\n'),
    };
  };

  const buildInstruction = (step: any): string => {
    const m = step?.maneuver || {};
    const type = (m.type || '').toLowerCase();
    const mod = (m.modifier || '').toLowerCase();
    const name = step?.name ? ` onto ${step.name}` : '';

    switch (type) {
      case 'depart': return `Head ${mod || 'forward'}${name}`;
      case 'arrive': return 'Arrive at your destination';
      case 'turn': return `Turn ${mod || 'ahead'}${name}`;
      case 'new name': return `Continue${name}`;
      case 'merge': return `Merge ${mod || ''}${name}`;
      case 'on ramp': return `Take the ramp${name}`;
      case 'off ramp': return `Take the exit${name}`;
      case 'fork': return `Keep ${mod || 'straight'} at the fork${name}`;
      case 'roundabout':
      case 'rotary': return `At the roundabout, take exit ${m.exit || 1}${name}`;
      case 'end of road': return `At the end of the road, turn ${mod || ''}${name}`;
      case 'continue': return `Continue ${mod || 'straight'}${name}`;
      default: return `Proceed${name}`;
    }
  };

  const computeDetourWaypoints = (
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    block: { lat: number; lng: number },
    offsetMeters = 900
  ): { pointA: { lat: number; lng: number }; pointB: { lat: number; lng: number } } => {
    const latDegPerMeter = 1 / 111320;
    const lngDegPerMeter = 1 / (111320 * Math.cos((from.lat * Math.PI) / 180));

    const dx = to.lng - from.lng;
    const dy = to.lat - from.lat;
    const len = Math.hypot(dx, dy) || 1;

    const perpX = -dy / len;
    const perpY = dx / len;

    const offLat = perpY * offsetMeters * latDegPerMeter;
    const offLng = perpX * offsetMeters * lngDegPerMeter;

    const pointA = {
      lat: block.lat + offLat,
      lng: block.lng + offLng,
    };
    const pointB = {
      lat: block.lat - offLat,
      lng: block.lng - offLng,
    };

    const distA = Math.hypot(pointA.lat - block.lat, pointA.lng - block.lng);
    const distB = Math.hypot(pointB.lat - block.lat, pointB.lng - block.lng);
    if (distA > distB) {
      return { pointA: pointB, pointB: pointA };
    }
    return { pointA, pointB };
  };

  const handleOpenGenerateRoute = (incident: Incident) => {
    console.log('[ROUTE] STEP 1 — click received', incident.id);

    setRouteTargetIncident(incident);
    setRouteError(null);
    setRouteDiagnostics(null);
    setRouteAlternatives([]);
    setSelectedRouteIdx(0);
    setRouteSentOk(false);
    setRouteResponder(null);
    setRouteReporterInfo(null);
    setManualUserId('');
    setNeedsManualUserId(false);
    setShowRouteModal(true);
    setRouteLoading(true);

    setTimeout(async () => {
      try {
        if (!incident.lat || !incident.lng) {
          throw new Error('Incident has no coordinates.');
        }

        try {
          const fetched = await fetchReporterInfo(incident);
          setRouteReporterInfo(fetched);
          console.log('[ROUTE] reporter info fetched:', fetched);
        } catch (e) {
          console.warn('Could not fetch reporter info:', e);
        }

        const result = resolveResponderLocally(incident);

        if (result.ok === false) {
          const diag: string = result.diagnostics;
          const reason: string = result.reason;
          setNeedsManualUserId(true);
          setRouteDiagnostics(diag);
          setRouteError(reason);
          setRouteLoading(false);
          return;
        }

        const responder = result.responder;
        setRouteResponder(responder);

        const blockedLoc = findBackupLocationFor(incident);
        const hasBlock = !!blockedLoc;

        let osrmUrl: string;

        if (hasBlock && blockedLoc) {
          const { pointA, pointB } = computeDetourWaypoints(
            { lat: responder.lat, lng: responder.lng },
            { lat: incident.lat, lng: incident.lng },
            { lat: blockedLoc.lat, lng: blockedLoc.lng },
            900
          );

          osrmUrl =
            `https://router.project-osrm.org/route/v1/driving/` +
            `${responder.lng},${responder.lat};` +
            `${pointA.lng},${pointA.lat};` +
            `${pointB.lng},${pointB.lat};` +
            `${incident.lng},${incident.lat}` +
            `?overview=full&geometries=geojson&steps=true&alternatives=3`;
        } else {
          osrmUrl =
            `https://router.project-osrm.org/route/v1/driving/` +
            `${responder.lng},${responder.lat};${incident.lng},${incident.lat}` +
            `?overview=full&geometries=geojson&steps=true&alternatives=3`;
        }

        const data = await fetchJsonWithTimeout(osrmUrl, 15000, 'OSRM route fetch');

        if (data?.code !== 'Ok' || !data?.routes?.length) {
          throw new Error('No route could be generated by OSRM.');
        }

        const alts = data.routes.map((r: any, i: number) => ({
          id: i,
          distanceMeters: Number(r.distance) || 0,
          durationSeconds: Number(r.duration) || 0,
          geometry: (r.geometry?.coordinates || []).map(
            (c: [number, number]) => [c[1], c[0]] as [number, number]
          ),
          steps:
            r.legs?.[0]?.steps?.map((s: any) => ({
              instruction: buildInstruction(s),
              distance: Number(s.distance) || 0,
              duration: Number(s.duration) || 0,
              name: s.name || '',
              maneuver: s.maneuver?.type || '',
              modifier: s.maneuver?.modifier || '',
            })) || [],
        }));

        setRouteAlternatives(alts);
        setSelectedRouteIdx(0);
      } catch (e: any) {
        const msg = e?.message || 'Failed to generate route.';
        const parts = msg.split('\n\n');
        setRouteError(parts[0]);
        if (parts.length > 1) setRouteDiagnostics(parts.slice(1).join('\n\n'));
      } finally {
        setRouteLoading(false);
      }
    }, 0);
  };

  const handleManualUserIdSubmit = () => {
    if (!routeTargetIncident || !manualUserId.trim()) return;

    const liveLoc = findLiveResponderLocationFor(routeTargetIncident);
    const backupLoc = findBackupLocationFor(routeTargetIncident);

    const responder = {
      id: `manual_${routeTargetIncident.id}`,
      name:
        liveLoc?.responderName ||
        routeResponder?.name ||
        routeTargetIncident.responder ||
        'Responder',
      userId: manualUserId.trim(),
      lat: liveLoc?.lat ?? backupLoc?.lat ?? routeTargetIncident.lat!,
      lng: liveLoc?.lng ?? backupLoc?.lng ?? routeTargetIncident.lng!,
      status: liveLoc?.status ?? routeTargetIncident.status,
      source: 'manual entry',
    };

    setRouteResponder(responder);
    setNeedsManualUserId(false);
    setRouteError(null);
    setRouteLoading(true);

    setTimeout(async () => {
      try {
        let osrmUrl: string;
        if (backupLoc) {
          const { pointA, pointB } = computeDetourWaypoints(
            { lat: responder.lat, lng: responder.lng },
            { lat: routeTargetIncident.lat!, lng: routeTargetIncident.lng! },
            { lat: backupLoc.lat, lng: backupLoc.lng },
            900
          );
          osrmUrl =
            `https://router.project-osrm.org/route/v1/driving/` +
            `${responder.lng},${responder.lat};` +
            `${pointA.lng},${pointA.lat};` +
            `${pointB.lng},${pointB.lat};` +
            `${routeTargetIncident.lng},${routeTargetIncident.lat}` +
            `?overview=full&geometries=geojson&steps=true&alternatives=3`;
        } else {
          osrmUrl =
            `https://router.project-osrm.org/route/v1/driving/` +
            `${responder.lng},${responder.lat};${routeTargetIncident.lng},${routeTargetIncident.lat}` +
            `?overview=full&geometries=geojson&steps=true&alternatives=3`;
        }

        const data = await fetchJsonWithTimeout(osrmUrl, 15000, 'OSRM route fetch');

        if (data?.code !== 'Ok' || !data?.routes?.length) {
          throw new Error('No route could be generated by OSRM.');
        }

        const alts = data.routes.map((r: any, i: number) => ({
          id: i,
          distanceMeters: Number(r.distance) || 0,
          durationSeconds: Number(r.duration) || 0,
          geometry: (r.geometry?.coordinates || []).map(
            (c: [number, number]) => [c[1], c[0]] as [number, number]
          ),
          steps:
            r.legs?.[0]?.steps?.map((s: any) => ({
              instruction: buildInstruction(s),
              distance: Number(s.distance) || 0,
              duration: Number(s.duration) || 0,
              name: s.name || '',
              maneuver: s.maneuver?.type || '',
              modifier: s.maneuver?.modifier || '',
            })) || [],
        }));

        setRouteAlternatives(alts);
        setSelectedRouteIdx(0);
      } catch (e: any) {
        setRouteError(e?.message || 'Failed to generate route.');
      } finally {
        setRouteLoading(false);
      }
    }, 0);
  };

  const handleSendManualRoute = async (payload: ManualRoutePayload) => {
    if (!routeTargetIncident || !routeResponder || sendingRoute || routeSentOk) return;

    setSendingRoute(true);
    setRouteError(null);
    try {
      const distanceText =
        payload.distanceMeters < 1000
          ? `${Math.round(payload.distanceMeters)} m`
          : `${(payload.distanceMeters / 1000).toFixed(1)} km`;
      const etaMin = Math.max(1, Math.ceil(payload.durationSeconds / 60));

      const stepsText = payload.steps
        .slice(0, 12)
        .map((s, i) => `${i + 1}. ${s.instruction}`)
        .join('\n');

      const blockedLoc = findBackupLocationFor(routeTargetIncident);

      const avoidLine = blockedLoc
        ? `\n🚧 Avoiding: ${blockedLoc.category} at ${blockedLoc.lat.toFixed(5)}, ${blockedLoc.lng.toFixed(5)}\n`
        : '';

      const incidentType = routeTargetIncident.type || 'Unknown';
      const incidentTitle =
        routeTargetIncident.title || routeTargetIncident.type || 'Incident';
      const incidentLocation = routeTargetIncident.location || '';
      const incidentDate = routeTargetIncident.date || '';
      const incidentTime = routeTargetIncident.time || '';
      const incidentDescription = routeTargetIncident.description || '';
      const incidentSeverity = routeTargetIncident.severity || 'medium';

      const reporterName =
        routeReporterInfo?.name ||
        (routeTargetIncident as any).reporterName ||
        ((routeTargetIncident as any).reporter &&
          (routeTargetIncident as any).reporter.fullName) ||
        'Unknown';

      const reporterPhone =
        routeReporterInfo?.phone ||
        (routeTargetIncident as any).reporterPhone ||
        ((routeTargetIncident as any).reporter &&
          (routeTargetIncident as any).reporter.phoneNumber) ||
        (routeTargetIncident as any).phone ||
        'Unknown';

      const casualties =
        (routeTargetIncident as any).casualties || {
          injured: 0,
          fatalities: 0,
          trapped: 0,
        };

      const messageBody =
        `A new route has been manually assigned by the EOC for incident ${routeTargetIncident.id}.\n` +
        `🚨 Incident Type: ${incidentType}\n` +
        `📋 Title: ${incidentTitle}\n` +
        `📍 Location: ${incidentLocation || 'Unknown'}\n` +
        `👤 Reporter: ${reporterName}\n` +
        `📞 Contact: ${reporterPhone}\n` +
        `🗓️ Date: ${incidentDate} ${incidentTime}\n` +
        avoidLine +
        `\n📏 Distance: ${distanceText}\n` +
        `⏱️ ETA: ${etaMin} min\n` +
        `📍 Waypoints: ${payload.waypoints.length}\n\n` +
        `Turn-by-turn directions:\n${stepsText}\n\n` +
        `Open the message to view the route on the map.`;

      await withTimeout(
        addDoc(collection(firestore, 'responder_messages'), {
          userId: routeResponder.userId,
          from: 'EOC',
          subject: `New Route — ${incidentType} (${routeTargetIncident.id})`,
          message: messageBody,
          priority: 'high',
          read: false,
          createdAt: serverTimestamp(),
          routeData: {
            incidentId: routeTargetIncident.id,
            incidentType: incidentType,
            incidentTitle: incidentTitle,
            incidentLocation: incidentLocation,
            incidentDate: incidentDate,
            incidentTime: incidentTime,
            incidentDescription: incidentDescription,
            incidentSeverity: incidentSeverity,
            reporterName: reporterName,
            reporterPhone: reporterPhone,
            casualties: casualties,
            incidentLat: routeTargetIncident.lat,
            incidentLng: routeTargetIncident.lng,
            responderLat: routeResponder.lat,
            responderLng: routeResponder.lng,
            distanceMeters: payload.distanceMeters,
            durationSeconds: payload.durationSeconds,
            geometry: payload.geometry.map(([la, ln]) => ({ lat: la, lng: ln })),
            steps: payload.steps,
            waypoints: payload.waypoints,
            routingMode: payload.routingMode,
            manuallySelected: true,
            avoidedLocation: blockedLoc
              ? {
                  lat: blockedLoc.lat,
                  lng: blockedLoc.lng,
                  category: blockedLoc.category,
                  description: blockedLoc.description,
                }
              : null,
          },
        }),
        10000,
        'send route'
      );

      // ✅ Clear any previously published auto/live route for this incident
      try {
        const routesRef = collection(firestore, 'responder_routes');
        const existingRoutes = await getDocs(
          query(routesRef, where('incidentId', '==', routeTargetIncident.id))
        );
        await Promise.all(
          existingRoutes.docs.map((d) =>
            updateDoc(d.ref, {
              cleared: true,
              clearedAt: serverTimestamp(),
              clearedReason: 'manual_route_assigned',
              points: [],
            })
          )
        );
        console.log(
          `[ROUTE] Cleared ${existingRoutes.docs.length} old responder_routes entries`
        );
      } catch (e) {
        console.warn('Could not clear old responder_routes:', e);
      }

      // ✅ Publish the newly assigned manual route into `responder_routes`
      try {
        const routesRef = collection(firestore, 'responder_routes');
        const newRouteRef = doc(routesRef, routeTargetIncident.id);
        await setDoc(
          newRouteRef,
          {
            incidentId: routeTargetIncident.id,
            points: payload.geometry.map(([lat, lng]) => ({ lat, lng })),
            distanceText,
            etaText: `${etaMin} min`,
            distanceKm: payload.distanceMeters / 1000,
            etaMinutes: etaMin,
            isAssigned: true,
            cleared: false,
            routingMode: payload.routingMode,
            manuallyAssigned: true,
            assignedBy: 'EOC',
            assignedAt: serverTimestamp(),
            waypoints: payload.waypoints.map((w) => ({ lat: w.lat, lng: w.lng })),
            steps: payload.steps,
          },
          { merge: true }
        );
        console.log('[ROUTE] Published manual route to responder_routes');
      } catch (e) {
        console.warn('Could not publish to responder_routes:', e);
      }

      try {
        const snap = await getDocs(
          query(
            collection(firestore, 'backup_requests'),
            where('reportId', '==', routeTargetIncident.id)
          )
        );
        await Promise.all(
          snap.docs.map((d) =>
            updateDoc(d.ref, {
              routeStatus: 'route_assigned',
              routeAssignedAt: serverTimestamp(),
            })
          )
        );
      } catch (e) {
        console.warn('Could not update request status:', e);
      }

      try {
        await sendPushToUser(
          routeResponder.userId,
          '🧭 New Route Assigned',
          `The EOC assigned a new route for ${incidentType} incident ${routeTargetIncident.id}.`,
          { incidentId: routeTargetIncident.id, type: 'new_route' }
        );
      } catch (e) {
        console.warn('Push failed:', e);
      }

      await logActivity({
        icon: 'route',
        tone: 'forest',
        title: `🧭 Route Sent — ${incidentType}`,
        meta:
          `EOC sent a new route to ${routeResponder.name} for the ${incidentType} incident ` +
          `at ${incidentLocation || 'unknown location'} · ${distanceText}, ETA ${etaMin} min, ` +
          `${payload.waypoints.length} waypoint(s)` +
          (blockedLoc
            ? ` · Avoiding ${blockedLoc.category} at ${blockedLoc.lat.toFixed(5)}, ${blockedLoc.lng.toFixed(5)}`
            : ''),
      });

      setRouteSentOk(true);
      setTimeout(() => setShowRouteModal(false), 1400);
    } catch (e: any) {
      setRouteError(e?.message || 'Failed to send route.');
    } finally {
      setSendingRoute(false);
    }
  };

  useEffect(() => {
    if (selectedIncident) {
      const incident = incidents.find((i) => i.id === selectedIncident);
      if (incident && incident.lat && incident.lng) {
        setMapCenter({ lat: incident.lat, lng: incident.lng });
        setMapZoom(15);
      }
    }
  }, [selectedIncident, incidents]);

  useEffect(() => {
    if (!highlightIncidentId) return;
    if (incidents.length === 0) return;

    const key = highlightIncidentId.toLowerCase();
    const match = incidents.find((inc) => {
      const cand1 = (inc.id || '').toString().toLowerCase();
      const cand2 = (inc.firebaseId || '').toString().toLowerCase();
      return cand1 === key || cand2 === key || cand1.includes(key) || cand2.includes(key);
    });

    if (!match) return;

    setSelectedIncident(match.id);
    setPulseIncidentId(match.id);
    const pulseTimer = setTimeout(() => setPulseIncidentId(null), 2500);

    // ✅ FIX: scroll ONLY the table container. `scrollIntoView` also scrolls every
    // ancestor (the whole page), which is what made the Monitor page stretch / shift
    // up when new backup data arrived.
    const scrollTimer = setTimeout(() => {
      const el = document.getElementById(`monitor-row-${match.id}`);
      const container = el?.closest('.incident-cards-container') as HTMLElement | null;
      if (el && container) {
        const top =
          el.getBoundingClientRect().top -
          container.getBoundingClientRect().top +
          container.scrollTop -
          container.clientHeight / 2 +
          el.clientHeight / 2;
        container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      }
    }, 250);

    return () => {
      clearTimeout(pulseTimer);
      clearTimeout(scrollTimer);
    };
  }, [highlightIncidentId, incidents]);

  const updateIncidentStatus = async (
    incidentId: string,
    updates: Partial<Incident>
  ) => {
    try {
      const incident = incidents.find((i) => i.id === incidentId);
      if (!incident || !incident.firebaseId) return;
      const docRef = doc(firestore, 'monitoring_status', incident.firebaseId);
      await updateDoc(docRef, { ...updates, updatedAt: serverTimestamp() });
    } catch (error) {
      console.error('Error updating incident:', error);
    }
  };

  const handleDispatchBackup = () => {
    if (activeIncident) {
      setIncidents((prev) =>
        prev.map((i) =>
          i.id === activeIncident.id
            ? {
                ...i,
                needsBackup: false,
                backupDispatched: true,
                status: 'on-scene' as const,
              }
            : i
        )
      );
      updateIncidentStatus(activeIncident.id, {
        needsBackup: false,
        backupDispatched: true,
        status: 'on-scene',
      });
      setShowBackupModal(false);
    }
  };

  const handleDeclineBackup = () => {
    if (activeIncident) {
      setIncidents((prev) =>
        prev.map((i) =>
          i.id === activeIncident.id ? { ...i, needsBackup: false } : i
        )
      );
      updateIncidentStatus(activeIncident.id, { needsBackup: false });
      setShowBackupModal(false);
    }
  };

  const handleSubmitReport = async (incidentId: string, report: string) => {
    setIncidents((prev) =>
      prev.map((i) =>
        i.id === incidentId ? { ...i, finalReport: report, awaitingReport: false } : i
      )
    );
    updateIncidentStatus(incidentId, {
      finalReport: report,
      awaitingReport: false,
    });
    setShowReportModal(false);
  };

  const getBadgeClass = (status: string) => {
    const statusMap: Record<string, string> = {
      'en-route': 'enroute',
      verified: 'verified',
      reported: 'pending',
      pending: 'pending',
      dispatched: 'dispatched',
      'on-scene': 'enroute',
      backup: 'backup',
      resolved: 'resolved',
    };
    return statusMap[status] || 'pending';
  };

  const getTypeBadgeClass = (type: string) => {
    const typeMap: Record<string, string> = {
      fire: 'fire',
      medical: 'medical',
      police: 'police',
      rescue: 'rescue',
      accident: 'accident',
      flood: 'flood',
    };
    return typeMap[type] || 'default';
  };

  const getTypeEmoji = (type: string) => {
    const typeMap: Record<string, string> = {
      fire: '🔥',
      medical: '🚑',
      police: '👮',
      rescue: '🆘',
      accident: '🚗',
      flood: '🌊',
    };
    return typeMap[type] || '⚠️';
  };

  // ✅ HEARTBEAT: number of incidents that are not resolved yet.
  //    The Active Incidents pill gets the `has-active` class while this is > 0.
  const activeCount = incidents.filter((i) => i.status !== 'resolved').length;

  const filteredIncidents = incidents.filter((incident) => {
    let matchesStatus = true;
    let matchesType = true;
    let matchesSearch = true;

    if (selectedStatus !== 'all') matchesStatus = incident.status === selectedStatus;
    if (selectedType !== 'all') matchesType = incident.type === selectedType;

    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      matchesSearch =
        incident.id.toLowerCase().includes(searchLower) ||
        incident.location?.toLowerCase().includes(searchLower) ||
        incident.title.toLowerCase().includes(searchLower) ||
        incident.description?.toLowerCase().includes(searchLower);
    }

    return matchesStatus && matchesType && matchesSearch;
  });

  if (loading) {
    return (
      <div className="monitor-container">
        <div
          className="monitor-scrollable-content"
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100%',
          }}
        >
          <div className="loading-spinner"></div>
          <p style={{ marginLeft: '16px', color: '#94A3B8' }}>Loading incidents...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="monitor-container">
      <div className="monitor-scrollable-content">
        <div className="dashboard-top-grid full-width-map">
          <div className="map-column">
            <div className="map-container">
              <div className="map-header">
                <div className="header-stats">
                  <div className="stat-pill total">
                    <i className="fa fa-exclamation-triangle"></i>
                    <div className="stat-info">
                      <span className="stat-value">{incidents.length}</span>
                      <span className="stat-label">Total Incidents</span>
                    </div>
                  </div>
                  {/* ✅ HEARTBEAT: `has-active` makes the border pulse while activeCount > 0 */}
                  <div className={`stat-pill active ${activeCount > 0 ? 'has-active' : ''}`}>
                    <i className="fa fa-shield-alt"></i>
                    <div className="stat-info">
                      <span className="stat-value">{activeCount}</span>
                      <span className="stat-label">Active Incidents</span>
                    </div>
                  </div>
                  {/* ❌ REMOVED: hardcoded "Responders: 42" pill */}

                  {/* ✅ Available Units — live count, same rule as AppEOC dashboard */}
                  <div className="stat-pill units">
                    <i className="fa fa-truck"></i>
                    <div className="stat-info">
                      <span className="stat-value">{availableUnitsCount}</span>
                      <span className="stat-label">Available Units</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="map-type-toggle-monitor">
                <button
                  type="button"
                  className={mapType === 'street' ? 'active' : ''}
                  onClick={() => setMapType('street')}
                  title="Street View"
                >
                  <i className="fa fa-map"></i>
                  <span className="tooltip">Street</span>
                </button>
                <div className="divider"></div>
                <button
                  type="button"
                  className={mapType === 'satellite' ? 'active' : ''}
                  onClick={() => setMapType('satellite')}
                  title="Satellite View"
                >
                  <i className="fa fa-satellite"></i>
                  <span className="tooltip">Satellite</span>
                </button>
              </div>

              <div className="map-content">
                <GoogleMap
                  incidents={incidents
                    .filter((i) => i.lat !== undefined && i.lng !== undefined)
                    .map((i) => ({
                      id: i.id,
                      type: i.type,
                      title: i.title,
                      severity: i.severity as any,
                      status: i.status,
                      lat: i.lat!,
                      lng: i.lng!,
                      time: i.time,
                      location: i.location,
                      responder: i.responder,
                      description: i.description,
                    }))}
                  responderLocations={responderLocations}
                  center={mapCenter}
                  zoom={mapZoom}
                  focusIncidentId={focusIncidentId}
                  focusNonce={focusNonce}
                  mapType={mapType}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="dashboard-bottom-grid full-width">
          <div className="incident-cards-column">
            <div className="panel-header-combined">
              <div className="filter-section">
                <div className="filter-group search-group">
                  <i className="fa fa-search"></i>
                  <input
                    type="text"
                    placeholder="Search incident ID, location, or address..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>

                <div className="filter-group">
                  <select
                    value={selectedStatus}
                    onChange={(e) => setSelectedStatus(e.target.value)}
                  >
                    <option value="all">All Status</option>
                    <option value="reported">Reported</option>
                    <option value="verified">Verified</option>
                    <option value="dispatched">Dispatched</option>
                    <option value="en-route">En Route</option>
                    <option value="on-scene">On Scene</option>
                    <option value="backup">Backup</option>
                    <option value="resolved">Resolved</option>
                  </select>
                </div>

                <div className="filter-group">
                  <select
                    value={selectedType}
                    onChange={(e) => setSelectedType(e.target.value)}
                  >
                    <option value="all">All Types</option>
                    <option value="fire">Fire</option>
                    <option value="medical">Medical</option>
                    <option value="police">Police</option>
                    <option value="rescue">Rescue</option>
                    <option value="accident">Accident</option>
                  </select>
                </div>

                <div className="filter-group">
                  <input
                    type="date"
                    defaultValue={new Date().toISOString().split('T')[0]}
                  />
                </div>

                <button className="btn-filter">
                  <i className="fa fa-sliders"></i>
                </button>
              </div>
            </div>

            <div className="incident-cards-container">
              {filteredIncidents.length === 0 ? (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '200px',
                    color: '#64748B',
                    textAlign: 'center',
                  }}
                >
                  <i
                    className="fa fa-inbox"
                    style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.3 }}
                  ></i>
                  <p style={{ fontSize: '14px', margin: 0, color: '#94A3B8' }}>
                    No incidents found
                  </p>
                  <p
                    style={{
                      fontSize: '12px',
                      margin: '4px 0 0 0',
                      color: '#64748B',
                    }}
                  >
                    Adjust your filters to see more results
                  </p>
                </div>
              ) : (
                <table className="incident-table">
                  <thead>
                    <tr>
                      <th>
                        Location <i className="fa fa-sort"></i>
                      </th>
                      <th>
                        Type <i className="fa fa-sort"></i>
                      </th>
                      <th>
                        Status <i className="fa fa-sort"></i>
                      </th>
                      <th>Responder Location</th>
                      <th>
                        Reported <i className="fa fa-sort"></i>
                      </th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredIncidents.map((incident) => {
                      const badgeClass = getBadgeClass(incident.status);
                      const typeClass = getTypeBadgeClass(incident.type);
                      const statusDisplay = incident.status
                        .replace('-', ' ')
                        .toUpperCase();
                      const typeDisplay = incident.type.toUpperCase();
                      const isPulsing = pulseIncidentId === incident.id;

                      const backup = findBackupFor(incident);
                      const liveLoc = findLiveResponderLocationFor(incident);
                      const backupLoc = findBackupLocationFor(incident);
                      const displayLoc = liveLoc
                        ? {
                            lat: liveLoc.lat,
                            lng: liveLoc.lng,
                            source: 'live' as const,
                            responderName: liveLoc.responderName || 'Responder',
                          }
                        : backupLoc
                        ? {
                            lat: backupLoc.lat,
                            lng: backupLoc.lng,
                            source: 'backup' as const,
                            responderName: backupLoc.responderName,
                          }
                        : null;

                      return (
                        <tr
                          key={incident.id}
                          id={`monitor-row-${incident.id}`}
                          className={`${
                            selectedIncident === incident.id ? 'selected' : ''
                          } ${isPulsing ? 'monitor-row-pulse' : ''}`}
                          onClick={() => {
                            setSelectedIncident(incident.id);
                            setFocusIncidentId(incident.id);
                            setFocusNonce((n) => n + 1);
                          }}
                        >
                          <td className="col-location">
                            <i className="fa fa-map-marker-alt"></i>
                            {incident.location || incident.barangay}
                          </td>
                          <td className="col-type">
                            <span className={`type-badge ${typeClass}`}>
                              {getTypeEmoji(incident.type)} {typeDisplay}
                            </span>
                          </td>
                          <td className="col-status">
                            <span className={`incident-badge ${badgeClass}`}>
                              {statusDisplay}
                            </span>

                            {backup && (
                              <div
                                className="backup-reason-badge"
                                title={
                                  backup.description
                                    ? `${backup.category} — ${backup.description}`
                                    : backup.category
                                }
                              >
                                <i className="fa fa-life-ring"></i> {backup.category}
                              </div>
                            )}
                          </td>
                          <td className="col-responder-location">
                            {displayLoc ? (
                              <div className="responder-loc-cell">
                                <i className="fa fa-map-marker-alt responder-loc-icon"></i>
                                <span className="responder-loc-text">
                                  {displayLoc.lat.toFixed(5)},{' '}
                                  {displayLoc.lng.toFixed(5)}
                                </span>
                                <button
                                  className="responder-loc-btn"
                                  onClick={(e) =>
                                    handleOpenResponderLocation(
                                      e,
                                      displayLoc.lat,
                                      displayLoc.lng
                                    )
                                  }
                                  title="Open responder location in Google Maps"
                                >
                                  <i className="fa fa-external-link"></i>
                                </button>
                              </div>
                            ) : (
                              <span className="responder-loc-empty">—</span>
                            )}
                          </td>
                          <td className="col-reported">
                            {incident.date} {incident.time}
                          </td>
                          <td className="col-actions">
                            <button
                              className="btn-view-dispatch"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenViewDispatch(incident);
                              }}
                            >
                              <i className="fa fa-truck"></i> View Dispatch
                            </button>
                            <button
                              className="btn-generate-route"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenGenerateRoute(incident);
                              }}
                            >
                              <i className="fa fa-route"></i> Generate New Route
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>

      {showBackupModal && activeIncident && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>
                <i className="fa fa-triangle-exclamation"></i> Need Additional Support?
              </h3>
              <button
                className="modal-close"
                onClick={() => setShowBackupModal(false)}
              >
                <i className="fa fa-times"></i>
              </button>
            </div>
            <div className="modal-body">
              <p>
                Incident <strong>{activeIncident.id}</strong> requires additional
                support.
              </p>
              <p className="sub-text">
                Backup units available:{' '}
                <span className="available-count">3</span>
              </p>
              <div className="backup-units">
                <div className="backup-units-title">Select Backup Unit</div>
                <div className="unit-option">
                  <input
                    type="radio"
                    name="backup-unit"
                    id="unit1"
                    defaultChecked
                  />
                  <label htmlFor="unit1">
                    Unit B-15 <span className="unit-distance">2.3km away</span>
                    <span className="unit-status-available">Available</span>
                  </label>
                </div>
                <div className="unit-option">
                  <input type="radio" name="backup-unit" id="unit2" />
                  <label htmlFor="unit2">
                    Unit A-09 <span className="unit-distance">3.1km away</span>
                    <span className="unit-status-available">Available</span>
                  </label>
                </div>
                <div className="unit-option">
                  <input type="radio" name="backup-unit" id="unit3" />
                  <label htmlFor="unit3">
                    Unit P-07 <span className="unit-distance">4.5km away</span>
                    <span className="unit-status-available">Available</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={handleDeclineBackup}>
                No, Continue Monitoring
              </button>
              <button className="btn-primary" onClick={handleDispatchBackup}>
                <i className="fa fa-paper-plane"></i> Dispatch Backup
              </button>
            </div>
          </div>
        </div>
      )}

      {showReportModal && activeIncident && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>
                <i className="fa fa-file-pen"></i> Rescuer's Final Report
              </h3>
              <button
                className="modal-close"
                onClick={() => setShowReportModal(false)}
              >
                <i className="fa fa-times"></i>
              </button>
            </div>
            <div className="modal-body">
              <p>
                Incident <strong>{activeIncident.id}</strong> - {activeIncident.title}
              </p>
              <div className="form-group">
                <label>Incident Summary:</label>
                <textarea
                  rows={4}
                  placeholder="Describe the incident outcome, actions taken, and any recommendations..."
                  defaultValue={activeIncident.finalReport || ''}
                  id="final-report-text"
                />
              </div>
              <div className="form-group">
                <label>Incident Status:</label>
                <select defaultValue="resolved">
                  <option value="resolved">Resolved</option>
                  <option value="pending">Pending Further Action</option>
                  <option value="referred">Referred to Other Agency</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn-secondary"
                onClick={() => setShowReportModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  const report =
                    (
                      document.getElementById(
                        'final-report-text'
                      ) as HTMLTextAreaElement
                    )?.value || '';
                  handleSubmitReport(activeIncident.id, report);
                }}
              >
                <i className="fa fa-check"></i> Submit Report
              </button>
            </div>
          </div>
        </div>
      )}

      {showDispatchModal &&
        dispatchTargetIncident &&
        createPortal(
          <div
            className="dispatch-overlay"
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              width: '100vw',
              height: '100vh',
              zIndex: 2147483000,
              background: 'rgba(0, 0, 0, 0.75)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'auto',
              padding: '20px',
              boxSizing: 'border-box',
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowDispatchModal(false);
            }}
          >
            <div
              className="dispatch-modal"
              style={{
                visibility: 'visible',
                opacity: 1,
                position: 'relative',
                width: 620,
                maxWidth: '92vw',
                minWidth: 320,
                maxHeight: '90vh',
                display: 'flex',
                flexDirection: 'column',
                background: '#1A2332',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 14,
                boxShadow: '0 25px 60px rgba(0,0,0,0.9)',
                color: '#F8FAFC',
                fontFamily:
                  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '16px 20px',
                  borderBottom: '1px solid rgba(255,255,255,0.08)',
                  flexShrink: 0,
                }}
              >
                <h3
                  style={{
                    color: '#F8FAFC',
                    margin: 0,
                    fontSize: 16,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <i className="fa fa-truck" style={{ color: '#F59E0B' }}></i>{' '}
                  Dispatch Backup Responders
                </h3>
                <button
                  onClick={() => setShowDispatchModal(false)}
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 6,
                    color: '#64748B',
                    width: 30,
                    height: 30,
                    fontSize: 16,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <i className="fa fa-times"></i>
                </button>
              </div>

              <div
                style={{
                  padding: '18px 20px',
                  overflowY: 'auto',
                  flex: 1,
                }}
              >
                <div
                  style={{
                    background: 'rgba(37, 99, 235, 0.08)',
                    border: '1px solid rgba(37, 99, 235, 0.25)',
                    borderRadius: 10,
                    padding: '14px 16px',
                    marginBottom: 18,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      marginBottom: 6,
                    }}
                  >
                    <span style={{ fontSize: 20 }}>
                      {getTypeEmoji(dispatchTargetIncident.type)}
                    </span>
                    <span
                      style={{
                        color: '#F8FAFC',
                        fontSize: 15,
                        fontWeight: 700,
                      }}
                    >
                      {dispatchTargetIncident.title || dispatchTargetIncident.type}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '8px 16px',
                      fontSize: 12.5,
                      color: '#94A3B8',
                    }}
                  >
                    <div>
                      <span style={{ color: '#64748B', fontWeight: 600 }}>
                        Incident ID:{' '}
                      </span>
                      <span style={{ color: '#60A5FA', fontWeight: 600 }}>
                        {dispatchTargetIncident.id}
                      </span>
                    </div>
                    <div>
                      <span style={{ color: '#64748B', fontWeight: 600 }}>
                        Status:{' '}
                      </span>
                      <span
                        style={{
                          color:
                            dispatchTargetIncident.status === 'resolved'
                              ? '#4ADE80'
                              : dispatchTargetIncident.status === 'on-scene'
                              ? '#FBBF24'
                              : '#60A5FA',
                          fontWeight: 600,
                          textTransform: 'capitalize',
                        }}
                      >
                        {dispatchTargetIncident.status.replace('-', ' ')}
                      </span>
                    </div>
                    <div>
                      <span style={{ color: '#64748B', fontWeight: 600 }}>
                        Location:{' '}
                      </span>
                      <span style={{ color: '#CBD5E1' }}>
                        <i
                          className="fa fa-map-marker-alt"
                          style={{ marginRight: 4, color: '#F87171' }}
                        ></i>
                        {dispatchTargetIncident.location || 'Unknown'}
                      </span>
                    </div>
                    <div>
                      <span style={{ color: '#64748B', fontWeight: 600 }}>
                        Reported:{' '}
                      </span>
                      <span style={{ color: '#CBD5E1' }}>
                        {dispatchTargetIncident.date} {dispatchTargetIncident.time}
                      </span>
                    </div>
                  </div>
                </div>

                {dispatchLoading && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 12,
                      padding: '40px 16px',
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 10,
                    }}
                  >
                    <div className="loading-spinner" />
                    <div
                      style={{
                        color: '#F8FAFC',
                        fontSize: 14,
                        fontWeight: 600,
                      }}
                    >
                      Loading available responders…
                    </div>
                    <div style={{ color: '#94A3B8', fontSize: 12 }}>
                      Fetching from Manage Users
                    </div>
                  </div>
                )}

                {!dispatchLoading && dispatchError && availableResponders.length === 0 && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      padding: '30px 16px',
                      background: 'rgba(220, 38, 38, 0.08)',
                      border: '1px solid rgba(220, 38, 38, 0.3)',
                      borderRadius: 10,
                      textAlign: 'center',
                    }}
                  >
                    <i
                      className="fa fa-info-circle"
                      style={{ fontSize: 28, color: '#F87171', marginBottom: 4 }}
                    />
                    <div
                      style={{
                        color: '#FCA5A5',
                        fontSize: 14,
                        fontWeight: 700,
                      }}
                    >
                      No Available Responders
                    </div>
                    <div
                      style={{
                        color: '#FCA5A5',
                        fontSize: 12.5,
                        opacity: 0.85,
                      }}
                    >
                      {dispatchError}
                    </div>
                  </div>
                )}

                {dispatchSuccess && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      padding: '30px 16px',
                      background: 'rgba(22, 163, 74, 0.10)',
                      border: '1px solid rgba(22, 163, 74, 0.35)',
                      borderRadius: 10,
                      textAlign: 'center',
                    }}
                  >
                    <i
                      className="fa fa-check-circle"
                      style={{ fontSize: 32, color: '#4ADE80', marginBottom: 4 }}
                    />
                    <div
                      style={{
                        color: '#86EFAC',
                        fontSize: 15,
                        fontWeight: 700,
                      }}
                    >
                      Backup Dispatched!
                    </div>
                    <div
                      style={{
                        color: '#94A3B8',
                        fontSize: 12.5,
                      }}
                    >
                      {selectedResponderIds.length} responder(s) notified and en route.
                    </div>
                  </div>
                )}

                {!dispatchLoading &&
                  !dispatchSuccess &&
                  availableResponders.length > 0 && (
                    <>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: 10,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 12,
                            color: '#94A3B8',
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: 0.5,
                          }}
                        >
                          Recommended Available Units
                        </div>
                        <div
                          style={{
                            background: 'rgba(245, 158, 11, 0.15)',
                            border: '1px solid rgba(245, 158, 11, 0.3)',
                            borderRadius: 20,
                            padding: '3px 10px',
                            fontSize: 11,
                            color: '#FBBF24',
                            fontWeight: 700,
                          }}
                        >
                          {availableResponders.length}{' '}
                          {availableResponders.length === 1 ? 'unit' : 'units'}
                        </div>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 10,
                        }}
                      >
                        {availableResponders.map((unit) => {
                          const selected = selectedResponderIds.includes(unit.id);
                          return (
                            <div
                              key={unit.id}
                              onClick={() => handleToggleResponder(unit.id)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12,
                                padding: '12px 14px',
                                background: selected
                                  ? 'rgba(37, 99, 235, 0.12)'
                                  : 'rgba(255,255,255,0.03)',
                                border: selected
                                  ? '1px solid #2563EB'
                                  : '1px solid rgba(255,255,255,0.07)',
                                borderRadius: 10,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                                boxShadow: selected
                                  ? '0 0 0 2px rgba(37, 99, 235, 0.2)'
                                  : 'none',
                              }}
                            >
                              <div
                                style={{
                                  width: 20,
                                  height: 20,
                                  borderRadius: 4,
                                  border: selected
                                    ? '2px solid #2563EB'
                                    : '2px solid rgba(255,255,255,0.2)',
                                  background: selected
                                    ? '#2563EB'
                                    : 'transparent',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0,
                                }}
                              >
                                {selected && (
                                  <i
                                    className="fa fa-check"
                                    style={{
                                      fontSize: 12,
                                      color: 'white',
                                    }}
                                  ></i>
                                )}
                              </div>

                              <div
                                style={{
                                  width: 40,
                                  height: 40,
                                  borderRadius: '50%',
                                  overflow: 'hidden',
                                  flexShrink: 0,
                                  background: 'rgba(37, 99, 235, 0.15)',
                                  border: '1px solid rgba(37, 99, 235, 0.3)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                              >
                                {unit.profile ? (
                                  <img
                                    src={unit.profile}
                                    alt={unit.name}
                                    style={{
                                      width: '100%',
                                      height: '100%',
                                      objectFit: 'cover',
                                    }}
                                    onError={(e) => {
                                      (
                                        e.target as HTMLImageElement
                                      ).style.display = 'none';
                                    }}
                                  />
                                ) : (
                                  <i
                                    className="fa fa-user-circle"
                                    style={{
                                      fontSize: 22,
                                      color: '#60A5FA',
                                    }}
                                  ></i>
                                )}
                              </div>

                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div
                                  style={{
                                    color: '#F8FAFC',
                                    fontSize: 13.5,
                                    fontWeight: 700,
                                    marginBottom: 2,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {unit.name}
                                </div>
                                <div
                                  style={{
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    gap: 6,
                                    alignItems: 'center',
                                  }}
                                >
                                  <span
                                    style={{
                                      fontSize: 10.5,
                                      color: '#94A3B8',
                                      background: 'rgba(255,255,255,0.06)',
                                      padding: '1px 6px',
                                      borderRadius: 4,
                                    }}
                                  >
                                    {unit.code}
                                  </span>
                                  <span
                                    style={{
                                      fontSize: 10.5,
                                      color: '#60A5FA',
                                    }}
                                  >
                                    {unit.type}
                                  </span>
                                  <span
                                    style={{
                                      fontSize: 10.5,
                                      color: '#64748B',
                                    }}
                                  >
                                    • {unit.role}
                                  </span>
                                </div>
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: '#94A3B8',
                                    marginTop: 3,
                                  }}
                                >
                                  {unit.capability}
                                </div>
                                {unit.station && (
                                  <div
                                    style={{
                                      fontSize: 10.5,
                                      color: '#64748B',
                                      marginTop: 2,
                                    }}
                                  >
                                    <i
                                      className="fa fa-building"
                                      style={{ marginRight: 3 }}
                                    ></i>
                                    {unit.station}
                                  </div>
                                )}
                              </div>

                              <div
                                style={{
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'flex-end',
                                  gap: 4,
                                  flexShrink: 0,
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: 10.5,
                                    fontWeight: 700,
                                    padding: '2px 8px',
                                    borderRadius: 20,
                                    background: 'rgba(34, 197, 94, 0.15)',
                                    color: '#4ADE80',
                                    textTransform: 'uppercase',
                                    letterSpacing: 0.3,
                                  }}
                                >
                                  Available
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div
                        style={{
                          marginTop: 14,
                          padding: '10px 12px',
                          background: 'rgba(245, 158, 11, 0.06)',
                          border: '1px solid rgba(245, 158, 11, 0.15)',
                          borderRadius: 8,
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 8,
                        }}
                      >
                        <i
                          className="fa fa-info-circle"
                          style={{
                            color: '#FBBF24',
                            marginTop: 1,
                            fontSize: 13,
                          }}
                        ></i>
                        <div
                          style={{
                            color: '#94A3B8',
                            fontSize: 11.5,
                            lineHeight: 1.5,
                          }}
                        >
                          Select one or more responders to dispatch as{' '}
                          <strong style={{ color: '#FBBF24' }}>backup</strong> for
                          this incident. They will receive a notification and
                          appear on the map once they accept.
                        </div>
                      </div>
                    </>
                  )}
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                  padding: '14px 20px',
                  borderTop: '1px solid rgba(255,255,255,0.06)',
                  background: 'rgba(255,255,255,0.01)',
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    color: '#94A3B8',
                    fontSize: 12.5,
                  }}
                >
                  {selectedResponderIds.length > 0 ? (
                    <>
                      <strong style={{ color: '#60A5FA' }}>
                        {selectedResponderIds.length}
                      </strong>{' '}
                      selected
                    </>
                  ) : (
                    'Select responders to dispatch'
                  )}
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    onClick={() => setShowDispatchModal(false)}
                    style={{
                      padding: '8px 22px',
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 6,
                      color: '#94A3B8',
                      fontSize: 14,
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    disabled={
                      selectedResponderIds.length === 0 ||
                      isDispatchingBackup ||
                      dispatchSuccess
                    }
                    onClick={handleDispatchBackupResponders}
                    style={{
                      padding: '8px 22px',
                      background:
                        selectedResponderIds.length === 0 ||
                        isDispatchingBackup ||
                        dispatchSuccess
                          ? 'rgba(245, 158, 11, 0.4)'
                          : 'linear-gradient(135deg, #F59E0B, #D97706)',
                      border: 'none',
                      borderRadius: 6,
                      color: 'white',
                      fontSize: 14,
                      fontWeight: 600,
                      cursor:
                        selectedResponderIds.length === 0 ||
                        isDispatchingBackup ||
                        dispatchSuccess
                          ? 'not-allowed'
                          : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      opacity:
                        selectedResponderIds.length === 0 ||
                        isDispatchingBackup ||
                        dispatchSuccess
                          ? 0.5
                          : 1,
                    }}
                  >
                    <i className="fa fa-paper-plane"></i>{' '}
                    {isDispatchingBackup
                      ? 'Dispatching…'
                      : `Dispatch ${selectedResponderIds.length || ''} Backup${
                          selectedResponderIds.length === 1 ? '' : 's'
                        }`}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {showRouteModal && routeTargetIncident && (
        <GenerateRouteModal
          incident={{
            id: routeTargetIncident.id,
            type: routeTargetIncident.type,
            title: routeTargetIncident.title,
            lat: routeTargetIncident.lat,
            lng: routeTargetIncident.lng,
          }}
          responder={routeResponder}
          blockedLoc={findBackupLocationFor(routeTargetIncident) || null}
          requestTimeMs={findBackupLocationFor(routeTargetIncident)?.createdAtMs}
          resolving={routeLoading && !routeResponder}
          error={routeResponder ? null : routeError}
          diagnostics={routeDiagnostics}
          needsManualUserId={needsManualUserId}
          manualUserId={manualUserId}
          onManualUserIdChange={setManualUserId}
          onManualUserIdSubmit={handleManualUserIdSubmit}
          onRetry={() => handleOpenGenerateRoute(routeTargetIncident)}
          sending={sendingRoute}
          sent={routeSentOk}
          sendError={routeResponder ? routeError : null}
          onClose={() => setShowRouteModal(false)}
          onSend={handleSendManualRoute}
          publishedRoutes={publishedRoutes}
          liveResponder={
            (() => {
              const live = findLiveResponderLocationFor(routeTargetIncident);
              if (!live) return null;
              return { lat: live.lat, lng: live.lng, status: live.status };
            })()
          }
        />
      )}
    </div>
  );
};

export default MonitorIncidentStatus;