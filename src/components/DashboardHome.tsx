import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { User } from 'firebase/auth';
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  query,
  orderBy,
  where,
  doc,
  setDoc,
  deleteDoc,
  updateDoc,
  onSnapshot,
} from 'firebase/firestore';
import { getAuth, sendPasswordResetEmail } from 'firebase/auth';
import '../css/Dashboard.css';

// ============================================================
// TYPES
// ============================================================
interface Incident {
  id: number;
  type: string;
  location: string;
  status: string;
  severity: string;
  reportedAt: string;
  assignedTo: string | null;
  description?: string;
  responseTime?: number;
  __docId?: string;
  __altIds?: string[];
  __key?: string;
}

interface UserData {
  id: string;
  name: string;
  email: string;
  role: string;
  status: 'active' | 'inactive';
  department?: string;
  station?: string;
  profile?: string;
  joinedDate?: string;
  uid?: string;
  userType?: string;
  isManagedUser?: boolean;
}

interface DashboardHomeProps {
  user: User | null;
  userRole: 'admin' | 'eoc' | null;
  incidents: Incident[];
  onTabChange: (tab: string) => void;
}

type FeedFilter = 'all' | 'request' | 'activity';

// ✅ A pending request coming from Manage Users collections
interface PendingRequest {
  id: string;
  kind: 'reset' | 'profile';
  name: string;
  detail: string;
  createdAt: number;
}

declare global {
  interface Window {
    lucide?: { createIcons: () => void };
    Chart?: any;
  }
}

// ============================================================
// CONSTANTS
// ============================================================
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const FEED_TABS: { key: FeedFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'activity', label: 'Recent activity' },
  { key: 'request', label: 'New requests' },
];

// ============================================================
// ✅ FIRESTORE-BACKED DEDUPE FLAGS (per source doc)
// ============================================================
const FLAG_INCIDENT_LOGGED = 'dashboardLogged';
const FLAG_DISPATCH_LOGGED = 'dashboardDispatchLogged';
const FLAG_ARRIVED_LOGGED  = 'dashboardArrivedLogged';
const FLAG_BACKUP_LOGGED   = 'dashboardBackupLogged';
const FLAG_FINAL_LOGGED    = 'dashboardFinalLogged';
const FLAG_SMS_LOGGED      = 'dashboardSmsLogged';       // emergencyMessages
const FLAG_LORA_LOGGED     = 'dashboardLoraLogged';      // lora_alerts
const FLAG_LORA_FORWARD_LOGGED = 'dashboardLoRaForwardLogged'; // forwarded_incidents

// ============================================================
// ✅ TOMBSTONE COLLECTION
// ============================================================
const TOMBSTONE_COLLECTION = 'dashboard_hidden';

// Legacy localStorage keys to clean once
const LEGACY_LS_KEYS = [
  'dashboard_logged_incident_reports_v2',
  'dashboard_logged_accepted_dispatches_v1',
  'dashboard_logged_arrived_scenes_v1',
  'dashboard_logged_backup_requests_v1',
  'dashboard_logged_final_reports_v1',
  'dashboard_logged_incident_reports',
  'dashboard_logged_accepted_dispatches',
  'dashboard_logged_arrived_scenes',
  'dashboard_logged_backup_requests',
  'dashboard_logged_final_reports',
];

// ============================================================
// HELPERS
// ============================================================
const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function generateStrongPassword(): string {
  const words = ['Fire', 'Rescue', 'Brave', 'Swift', 'Strong', 'Noble', 'Wise', 'Fierce', 'Mighty', 'Valor', 'Courage', 'Honor', 'Loyal', 'Bright'];
  const symbols = ['!', '@', '#', '$', '%', '&', '*', '+', '='];
  const rand = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
  const num = () => Math.floor(Math.random() * 10).toString();

  let w1 = rand(words), w2 = rand(words), w3 = rand(words);
  while (w2 === w1) w2 = rand(words);
  while (w3 === w1 || w3 === w2) w3 = rand(words);

  const fmt = (w: string) => w.substring(0, 4).charAt(0).toUpperCase() + w.substring(1, 4).toLowerCase();
  let pwd = fmt(w1) + num() + rand(symbols) + fmt(w2) + num() + fmt(w3);
  while (pwd.length < 12) pwd += num();
  return pwd.substring(0, 12);
}

function getInitials(name: string): string {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function formatRelativeTime(createdAt: number): string {
  const diff = Date.now() - createdAt;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  return new Date(createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

// Local-date helpers (avoid UTC shifts from toISOString / new Date("YYYY-MM-DD"))
function toInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatRangeLabel(start: Date, end: Date): string {
  const sameYear = start.getFullYear() === end.getFullYear();
  const fmt = (d: Date, withYear: boolean) =>
    d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(withYear ? { year: 'numeric' } : {}),
    });
  return `${fmt(start, !sameYear)} - ${fmt(end, true)}`;
}

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

function parseDate(value: any): Date | null {
  if (!value) return null;
  try {
    if (typeof value?.toDate === 'function') return value.toDate();
    if (typeof value === 'object' && typeof value.seconds === 'number') {
      return new Date(value.seconds * 1000);
    }
    if (typeof value === 'string' || typeof value === 'number') {
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  } catch {
    return null;
  }
}

function toMillis(value: any, fallbackMs: number = 0): number {
  const d = parseDate(value);
  if (!d) return fallbackMs;
  const t = d.getTime();
  return Number.isFinite(t) ? t : fallbackMs;
}

// ============================================================
// HOOKS
// ============================================================
// ✅ Normalise any id so "INC-001", " inc-001 " and "inc-001" all match
const normId = (v: any): string => String(v ?? '').trim().toLowerCase();

function useCountUp(target: number, duration = 700) {
  const [value, setValue] = useState(prefersReducedMotion() ? target : 0);
  const prevTarget = useRef(target);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if (prefersReducedMotion()) {
      setValue(target);
      return;
    }
    const from = prevTarget.current === target ? valueRef.current : 0;
    prevTarget.current = target;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

// ============================================================
// SMALL COMPONENTS
// ============================================================
const KpiCard: React.FC<{
  label: string;
  value: number;
  icon: string;
  iconBg: string;
  trend?: { text: string; tone: 'forest' | 'gold' | 'muted'; pulse?: boolean };
}> = ({ label, value, icon, iconBg, trend }) => (
  <div className="glass-card kpi-card">
    <div className="kpi-top">
      <span className="kpi-label">{label}</span>
      <div className={`kpi-icon ${iconBg} ${trend?.pulse ? 'kpi-icon-live' : ''}`}>
        <i data-lucide={icon} />
      </div>
    </div>
    <div className="kpi-bottom">
      <span className="kpi-value">{value}</span>
      {trend && (
        <span className={`trend-pill ${trend.tone === 'muted' ? 'muted' : `bg-${trend.tone}-soft`}`}>
          {trend.text}
        </span>
      )}
    </div>
  </div>
);

const EmptyState: React.FC<{ icon: string; title: string; body: string }> = ({
  icon,
  title,
  body,
}) => (
  <div className="empty-state">
    <div className="empty-state-icon">
      <i data-lucide={icon} style={{ width: 18, height: 18 }} />
    </div>
    <strong>{title}</strong>
    <p>{body}</p>
  </div>
);

// ============================================================
// MAIN COMPONENT
// ============================================================
const DashboardHome: React.FC<DashboardHomeProps> = ({
  onTabChange,
}) => {
  const weeklyChartRef = useRef<HTMLCanvasElement | null>(null);
  const chartsRef = useRef<any[]>([]);
  const dateInputRef = useRef<HTMLInputElement>(null);

  // ✅ `users` holds every account from manage_users / users.
  const [users, setUsers] = useState<UserData[]>([]);
  const [toast, setToast] = useState<{ msg: string; tone: 'ok' | 'err' } | null>(null);

  const [liveActivity, setLiveActivity] = useState<any[]>([]);
  const [firestoreIncidents, setFirestoreIncidents] = useState<Incident[]>([]);

  const [responderTracking, setResponderTracking] = useState<Record<string, string>>({});
  const [finalReportIds, setFinalReportIds] = useState<Set<string>>(new Set());
  // ✅ Total number of documents in final_reports (same count as the Final Reports page)
  const [finalReportCount, setFinalReportCount] = useState(0);

  // ✅ NEW REQUESTS (same collections the Manage Users bell uses)
  const [resetReqs, setResetReqs] = useState<PendingRequest[]>([]);
  const [profileReqs, setProfileReqs] = useState<PendingRequest[]>([]);

  const pendingRequests = useMemo(
    () => [...resetReqs, ...profileReqs].sort((a, b) => b.createdAt - a.createdAt),
    [resetReqs, profileReqs]
  );

  // ✅ TOMBSTONES: set of source keys that should NEVER be logged again.
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());

  const [isClearing, setIsClearing] = useState(false);

  const inFlightRef = useRef<Set<string>>(new Set());

  const activityCreatedAtCache = useRef<Map<string, number>>(new Map());

  // ✅ Chart filter state & Calendar state
  const [chartFilter, setChartFilter] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [calendarOpen, setCalendarOpen] = useState(false);

  // Ref for clicking outside the calendar
  const calendarRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((msg: string, tone: 'ok' | 'err' = 'ok') => {
    setToast({ msg, tone });
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  // ============================================================
  // ✅ ONE-TIME: wipe legacy localStorage keys
  // ============================================================
  useEffect(() => {
    try {
      LEGACY_LS_KEYS.forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
  }, []);

  // ============================================================
  // ✅ TOMBSTONE LISTENER: dashboard_hidden → Set of source keys
  // ============================================================
  useEffect(() => {
    const db = getFirestore();
    const q = query(collection(db, TOMBSTONE_COLLECTION));

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const set = new Set<string>();
        snapshot.docs.forEach((d) => {
          const data = d.data();
          const key = data.sourceKey?.toString() || d.id;
          if (key) set.add(key);
        });
        setHiddenKeys(set);
      },
      (error) =>
        console.warn(
          'dashboard_hidden listener:',
          error?.message || error
        )
    );

    return () => unsub();
  }, []);

  // ============================================================
  // ✅ NEW REQUESTS LISTENERS
  //    password_reset_requests + profile_update_requests (pending)
  //    → shown in the "All" and "New requests" tabs.
  //    Items vanish automatically once approved / rejected / dismissed
  //    in Manage Users (status is no longer 'pending').
  // ============================================================
  useEffect(() => {
    const db = getFirestore();

    const unsubReset = onSnapshot(
      query(collection(db, 'password_reset_requests'), where('status', '==', 'pending')),
      (snap) =>
        setResetReqs(
          snap.docs.map((d) => {
            const data: any = d.data();
            return {
              id: `reset-${d.id}`,
              kind: 'reset' as const,
              name: data.email || 'Unknown user',
              detail: 'Requested a password reset',
              createdAt: toMillis(data.requestedAt, Date.now()),
            };
          })
        ),
      (err) => console.warn('password_reset_requests listener:', err?.message || err)
    );

    const unsubProfile = onSnapshot(
      query(collection(db, 'profile_update_requests'), where('status', '==', 'pending')),
      (snap) =>
        setProfileReqs(
          snap.docs.map((d) => {
            const data: any = d.data();
            const fields: string[] = data.fields || [];
            return {
              id: `profile-${d.id}`,
              kind: 'profile' as const,
              name: data.responderName || data.email || 'Responder',
              detail: `Requested a profile update${fields.length ? ` · ${fields.join(', ')}` : ''}`,
              createdAt: toMillis(data.requestedAt, Date.now()),
            };
          })
        ),
      (err) => console.warn('profile_update_requests listener:', err?.message || err)
    );

    return () => {
      unsubReset();
      unsubProfile();
    };
  }, []);

  // ---------- Users fetch ----------
  const fetchUsers = useCallback(async () => {
    try {
      const db = getFirestore();

      let q = query(collection(db, 'manage_users'), orderBy('createdAt', 'desc'));
      let snapshot = await getDocs(q);
      if (snapshot.empty) {
        q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
        snapshot = await getDocs(q);
      }

      const fetchedUsers: UserData[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          uid: data.uid || d.id,
          name: data.name || data.fullName || data.displayName || 'Unnamed User',
          email: data.email || 'N/A',
          role: data.role || 'Responder',
          status: data.status || 'active',
          department: data.department || data.station || 'N/A',
          station: data.station || '',
          profile: data.profile || '',
          joinedDate: data.createdAt
            ? new Date(data.createdAt).toLocaleDateString('en-US', {
                month: 'short',
                day: '2-digit',
                year: 'numeric',
              })
            : 'N/A',
          userType: data.userType || data.type || 'responder',
          isManagedUser: data.isManagedUser || false,
        };
      });
      setUsers(fetchedUsers);
    } catch (err) {
      console.error('Error fetching users:', err);
      showToast('Failed to load users.', 'err');
    }
  }, [showToast]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // ✅ Real-time listener for the activity feed
  useEffect(() => {
    const db = getFirestore();
    const q = query(collection(db, 'activity_feed'), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const now = Date.now();
        const cache = activityCreatedAtCache.current;

        const activities = snapshot.docs.map((doc) => {
          const data = doc.data();

          let createdAtMs = cache.get(doc.id);
          if (createdAtMs === undefined) {
            createdAtMs = toMillis(data.createdAt, now);
            cache.set(doc.id, createdAtMs);
          }

          return {
            id: doc.id,
            icon: data.icon || 'user-check',
            tone: data.tone || 'forest',
            title: data.title,
            meta: data.meta,
            createdAt: createdAtMs,
            time: formatRelativeTime(createdAtMs),
            sourceKey: data.sourceKey || null,
          };
        });

        activities.sort((a, b) => b.createdAt - a.createdAt);

        // ✅ Same incident / same event = ONE feed item.
        //    Uses sourceKey when it exists, otherwise title + meta
        //    (e.g. "Incident report verified" + "Crime at 375 Naga - Uling Road…").
        const seen = new Set<string>();
        const uniqueActivities = activities.filter((a) => {
          const dedupeKey = a.sourceKey
            ? String(a.sourceKey)
            : `${String(a.title ?? '').trim().toLowerCase()}|${String(a.meta ?? '').trim().toLowerCase()}`;
          if (seen.has(dedupeKey)) return false;
          seen.add(dedupeKey);
          return true;
        });

        setLiveActivity(uniqueActivities);
      },
      (error) => {
        console.error('Error fetching activity feed:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  // ✅ Real-time listener for incidents (source for KPIs + charts)
  useEffect(() => {
    const db = getFirestore();
    const q = query(
      collection(db, 'incident_reports'),
      orderBy('submittedAt', 'desc')
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const rows: Incident[] = snapshot.docs.map((doc, idx) => {
          const data = doc.data();

          const rawType =
            data.incidentType ||
            data.incidentName ||
            data.type ||
            'Incident';

          const typeEmoji: Record<string, string> = {
            Fire: '🔥',
            Flood: '💧',
            Medical: '🏥',
            Accident: '🚗',
            Earthquake: '🌊',
            Crime: '🚨',
            Other: '⚠️',
          };
          const icon = typeEmoji[rawType] || '⚠️';

          const reportedAtDate = parseDate(data.submittedAt) || new Date();

          const status = data.status || 'Pending';

          return {
            id: idx + 1,
            __docId: doc.id,
            // ✅ Same incident id = same incident (used to remove duplicates)
            __key: normId(
              data.incidentId || data.incidentReportId || data.reportId || doc.id
            ),
            __altIds: [
              data.incidentId,
              data.incidentReportId,
              data.reportId,
              data.id,
              data.reportNumber,
              data.incidentDocId,
            ]
              .filter(Boolean)
              .map(String),
            type: `${icon} ${rawType}`,
            location:
              data.location?.address ||
              data.location ||
              data.address ||
              data.incidentLocation ||
              'Unknown location',
            status: String(status).charAt(0).toUpperCase() + String(status).slice(1),
            severity:
              data.priority === 'critical'
                ? 'Critical'
                : data.priority === 'high'
                ? 'High'
                : data.priority === 'low'
                ? 'Low'
                : 'Medium',
            reportedAt: reportedAtDate.toISOString(),
            assignedTo:
              data.assignedTo ||
              data.responderName ||
              data.teamLeader ||
              null,
            description:
              data.description ||
              data.situationAssessment ||
              'No description provided',
            responseTime: data.responseTime || undefined,
          };
        });

        setFirestoreIncidents(rows);
      },
      (error) => {
        console.warn('incident_reports (charts) listener:', error?.message || error);
      }
    );

    return () => unsub();
  }, []);

  // ✅ Real-time listener: responder_tracking → status map
  useEffect(() => {
    const db = getFirestore();
    const q = query(collection(db, 'responder_tracking'));

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const map: Record<string, string> = {};
        snapshot.docs.forEach((d) => {
          const data = d.data();
          const id = data.incidentId?.toString() || d.id;
          const status = (data.status || '').toString().toLowerCase();
          if (id && status) map[normId(id)] = status;
        });
        setResponderTracking(map);
      },
      (error) =>
        console.warn('responder_tracking (status map) listener:', error?.message || error)
    );

    return () => unsub();
  }, []);

  // ✅ Real-time listener: final_reports → set of resolved incidentIds
  useEffect(() => {
    const db = getFirestore();
    const q = query(collection(db, 'final_reports'));

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const set = new Set<string>();
        snapshot.docs.forEach((d) => {
          const data = d.data();
          // ✅ Collect EVERY id a final report may use to point at its incident
          [
            data.incidentId,
            data.incidentReportId,
            data.reportId,
            data.incidentDocId,
            data.incidentDocumentId,
            d.id,
          ].forEach((v) => {
            if (v) set.add(normId(v));
          });
        });
        setFinalReportIds(set);
        setFinalReportCount(snapshot.size);
      },
      (error) =>
        console.warn('final_reports (id set) listener:', error?.message || error)
    );

    return () => unsub();
  }, []);

  // ============================================================
  // ✅ LISTENER 1: incident_reports → activity_feed
  // ============================================================
  useEffect(() => {
    const db = getFirestore();
    const reportQ = query(
      collection(db, 'incident_reports'),
      orderBy('submittedAt', 'desc')
    );

    const unsubReport = onSnapshot(
      reportQ,
      (snapshot) => {
        snapshot.docs.forEach(async (d) => {
          const data = d.data();

          const sourceKey = `incident:${d.id}`;

          if (data[FLAG_INCIDENT_LOGGED] === true) return;
          if (hiddenKeys.has(sourceKey)) return;

          const flightKey = `inc-${d.id}`;
          if (inFlightRef.current.has(flightKey)) return;
          inFlightRef.current.add(flightKey);

          let activityRef: any = null;

          try {
            const type = normalizeIncidentType(
              data.incidentType || data.incidentName || data.type,
              data.specificType
            );

            try {
              await updateDoc(d.ref, {
                [FLAG_INCIDENT_LOGGED]: true,
                dashboardLoggedAt: new Date().toISOString(),
              });
            } catch (flagErr: any) {
              console.error(
                '❌ Flag write failed for incident_report (rules?):',
                flagErr?.code,
                flagErr?.message
              );
              try {
                await setDoc(
                  doc(
                    db,
                    TOMBSTONE_COLLECTION,
                    sourceKey.replace(/[:/]/g, '_')
                  ),
                  {
                    sourceKey,
                    reason: 'flag-write-failed',
                    createdAt: new Date().toISOString(),
                  }
                );
              } catch {
                /* ignore */
              }
              setTimeout(() => inFlightRef.current.delete(flightKey), 30_000);
              return;
            }

            activityRef = doc(collection(db, 'activity_feed'));
            await setDoc(activityRef, {
              type: 'activity',
              icon: 'alert-triangle',
              tone: data.priority === 'critical' ? 'clay' : 'gold',
              title: `${type} Incident Report`,
              meta: `Type: ${type} at ${data.location?.address || data.location || data.address || 'unknown location'} — reported by ${data.reporter?.fullName || data.reporterName || data.reportedBy || 'Unknown'}`,
              time: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              sourceKey,
            });

            inFlightRef.current.delete(flightKey);
          } catch (err: any) {
            console.error(
              'Failed to log incident_report:',
              err?.code,
              err?.message
            );
            if (activityRef) {
              try {
                await deleteDoc(activityRef);
              } catch {
                /* ignore */
              }
            }
            setTimeout(
              () => inFlightRef.current.delete(flightKey),
              err?.code === 'permission-denied' ? 30_000 : 5_000
            );
          }
        });
      },
      (error) => console.warn('incident_reports listener:', error?.message || error)
    );

    return () => unsubReport();
  }, [hiddenKeys]);

  // ============================================================
  // ✅ LISTENER 2: responder_tracking (accepted) → activity_feed
  // ============================================================
  useEffect(() => {
    const db = getFirestore();
    const trackQ = query(
      collection(db, 'responder_tracking'),
      orderBy('acceptedAt', 'desc')
    );

    const unsubTrack = onSnapshot(
      trackQ,
      async (snapshot) => {
        for (const d of snapshot.docs) {
          const data = d.data();
          const status = (data.status || '').toString().toLowerCase();

          if (status !== 'enroute' && status !== 'on_scene') continue;
          if (data[FLAG_DISPATCH_LOGGED] === true) continue;

          const sourceKey = `dispatch:${d.id}`;
          if (hiddenKeys.has(sourceKey)) continue;

          const flightKey = `dsp-${d.id}`;
          if (inFlightRef.current.has(flightKey)) continue;
          inFlightRef.current.add(flightKey);

          const incidentId = data.incidentId?.toString() || d.id;
          if (!incidentId) {
            inFlightRef.current.delete(flightKey);
            continue;
          }

          let incidentType = 'Incident';
          let reporterName = 'Unknown';

          try {
            const reportDoc = await getDoc(doc(db, 'incident_reports', incidentId));
            if (reportDoc.exists()) {
              const rd = reportDoc.data() as any;
              incidentType = normalizeIncidentType(
                rd.incidentType || rd.incidentName || rd.type,
                rd.specificType
              );
              reporterName =
                rd.reporter?.fullName ||
                rd.reporterName ||
                rd.reportedBy ||
                'Unknown';
            } else {
              const snap = await getDocs(collection(db, 'incident_reports'));
              for (const rdoc of snap.docs) {
                const rd = rdoc.data();
                const matches =
                  rdoc.id === incidentId ||
                  rd.incidentId?.toString() === incidentId ||
                  rd.reportId?.toString() === incidentId;
                if (!matches) continue;
                incidentType = normalizeIncidentType(
                  rd.incidentType || rd.incidentName || rd.type,
                  rd.specificType
                );
                reporterName =
                  rd.reporter?.fullName ||
                  rd.reporterName ||
                  rd.reportedBy ||
                  'Unknown';
                break;
              }
            }
          } catch (e) {
            console.warn('Could not resolve incident report:', e);
          }

          const responderName =
            data.responderName ||
            data.teamLeader ||
            data.responder ||
            'A responder';

          try {
            try {
              await updateDoc(d.ref, {
                [FLAG_DISPATCH_LOGGED]: true,
                dashboardDispatchLoggedAt: new Date().toISOString(),
              });
            } catch (flagErr: any) {
              console.error(
                '❌ Flag write failed for accepted dispatch:',
                flagErr?.code,
                flagErr?.message
              );
              try {
                await setDoc(
                  doc(db, TOMBSTONE_COLLECTION, sourceKey.replace(/[:/]/g, '_')),
                  { sourceKey, reason: 'flag-write-failed', createdAt: new Date().toISOString() }
                );
              } catch {
                /* ignore */
              }
              setTimeout(() => inFlightRef.current.delete(flightKey), 30_000);
              continue;
            }

            await setDoc(doc(collection(db, 'activity_feed')), {
              type: 'activity',
              icon: 'check-circle-2',
              tone: 'forest',
              title: `✅ Dispatch Accepted — ${incidentType}`,
              meta: `${responderName} accepted the ${incidentType} report from ${reporterName} and is now en route.`,
              time: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              sourceKey,
            });

            inFlightRef.current.delete(flightKey);
          } catch (err: any) {
            console.error(
              'Failed to log accepted dispatch:',
              err?.code,
              err?.message
            );
            setTimeout(
              () => inFlightRef.current.delete(flightKey),
              err?.code === 'permission-denied' ? 30_000 : 5_000
            );
          }
        }
      },
      (error) =>
        console.warn('responder_tracking listener:', error?.message || error)
    );

    return () => unsubTrack();
  }, [hiddenKeys]);

  // ============================================================
  // ✅ LISTENER 3: responder_tracking (on_scene) → activity_feed
  // ============================================================
  useEffect(() => {
    const db = getFirestore();
    const trackQ = query(
      collection(db, 'responder_tracking'),
      orderBy('arrivedAt', 'desc')
    );

    const unsubArrived = onSnapshot(
      trackQ,
      async (snapshot) => {
        for (const d of snapshot.docs) {
          const data = d.data();
          const status = (data.status || '').toString().toLowerCase();

          if (status !== 'on_scene') continue;
          if (data[FLAG_ARRIVED_LOGGED] === true) continue;

          const sourceKey = `arrived:${d.id}`;
          if (hiddenKeys.has(sourceKey)) continue;

          const flightKey = `arv-${d.id}`;
          if (inFlightRef.current.has(flightKey)) continue;
          inFlightRef.current.add(flightKey);

          const incidentId = data.incidentId?.toString() || d.id;
          if (!incidentId) {
            inFlightRef.current.delete(flightKey);
            continue;
          }

          let incidentType = 'Incident';
          let locationName = 'the incident scene';

          try {
            const reportDoc = await getDoc(doc(db, 'incident_reports', incidentId));
            if (reportDoc.exists()) {
              const rd = reportDoc.data() as any;
              incidentType = normalizeIncidentType(
                rd.incidentType || rd.incidentName || rd.type,
                rd.specificType
              );
              locationName =
                rd.location?.address ||
                rd.location ||
                rd.address ||
                rd.incidentLocation ||
                'the incident scene';
            } else {
              const snap = await getDocs(collection(db, 'incident_reports'));
              for (const rdoc of snap.docs) {
                const rd = rdoc.data();
                const matches =
                  rdoc.id === incidentId ||
                  rd.incidentId?.toString() === incidentId ||
                  rd.reportId?.toString() === incidentId;
                if (!matches) continue;
                incidentType = normalizeIncidentType(
                  rd.incidentType || rd.incidentName || rd.type,
                  rd.specificType
                );
                locationName =
                  rd.location?.address ||
                  rd.location ||
                  rd.address ||
                  rd.incidentLocation ||
                  'the incident scene';
                break;
              }
            }
          } catch (e) {
            console.warn('Could not resolve incident report for arrival:', e);
          }

          const responderName =
            data.responderName ||
            data.teamLeader ||
            data.responder ||
            'A responder';

          try {
            try {
              await updateDoc(d.ref, {
                [FLAG_ARRIVED_LOGGED]: true,
                dashboardArrivedLoggedAt: new Date().toISOString(),
              });
            } catch (flagErr: any) {
              console.error(
                '❌ Flag write failed for arrived scene:',
                flagErr?.code,
                flagErr?.message
              );
              try {
                await setDoc(
                  doc(db, TOMBSTONE_COLLECTION, sourceKey.replace(/[:/]/g, '_')),
                  { sourceKey, reason: 'flag-write-failed', createdAt: new Date().toISOString() }
                );
              } catch {
                /* ignore */
              }
              setTimeout(() => inFlightRef.current.delete(flightKey), 30_000);
              continue;
            }

            await setDoc(doc(collection(db, 'activity_feed')), {
              type: 'activity',
              icon: 'map-pin',
              tone: 'forest',
              title: `✅ Responder Arrived — ${incidentType}`,
              meta: `${responderName} arrived at the ${incidentType} incident scene at ${locationName}.`,
              time: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              sourceKey,
            });

            inFlightRef.current.delete(flightKey);
          } catch (err: any) {
            console.error(
              'Failed to log arrived scene:',
              err?.code,
              err?.message
            );
            setTimeout(
              () => inFlightRef.current.delete(flightKey),
              err?.code === 'permission-denied' ? 30_000 : 5_000
            );
          }
        }
      },
      (error) =>
        console.warn('responder_tracking (arrived) listener:', error?.message || error)
    );

    return () => unsubArrived();
  }, [hiddenKeys]);

  // ============================================================
  // ✅ LISTENER 4: backup_requests → activity_feed
  // ============================================================
  useEffect(() => {
    const db = getFirestore();
    const backupQ = query(
      collection(db, 'backup_requests'),
      orderBy('createdAt', 'desc')
    );

    const unsubBackup = onSnapshot(
      backupQ,
      async (snapshot) => {
        for (const d of snapshot.docs) {
          const data = d.data();
          if (data[FLAG_BACKUP_LOGGED] === true) continue;

          const sourceKey = `backup:${d.id}`;
          if (hiddenKeys.has(sourceKey)) continue;

          const flightKey = `bkp-${d.id}`;
          if (inFlightRef.current.has(flightKey)) continue;
          inFlightRef.current.add(flightKey);

          const incidentId =
            data.incidentId?.toString() ||
            data.reportId?.toString() ||
            '';

          const responderName =
            data.responderName ||
            data.teamLeader ||
            data.responder ||
            'A responder';

          const category = data.category || data.requestType || 'Backup';
          const description = (data.description || '').toString().trim();

          let incidentType = 'Incident';
          let locationName = 'unknown location';

          try {
            if (incidentId) {
              const reportDoc = await getDoc(
                doc(db, 'incident_reports', incidentId)
              );
              if (reportDoc.exists()) {
                const rd = reportDoc.data() as any;
                incidentType = normalizeIncidentType(
                  rd.incidentType || rd.incidentName || rd.type,
                  rd.specificType
                );
                locationName =
                  rd.location?.address ||
                  rd.location ||
                  rd.address ||
                  rd.incidentLocation ||
                  'unknown location';
              }
            }
          } catch (e) {
            console.warn('Could not resolve incident report for backup:', e);
          }

          const metaParts: string[] = [];
          metaParts.push(`${responderName} requested backup (${category})`);
          if (incidentId) metaParts.push(`for the ${incidentType} incident`);
          if (locationName && locationName !== 'unknown location') {
            metaParts.push(`at ${locationName}`);
          }
          if (description) metaParts.push(`— "${description}"`);

          try {
            try {
              await updateDoc(d.ref, {
                [FLAG_BACKUP_LOGGED]: true,
                dashboardBackupLoggedAt: new Date().toISOString(),
              });
            } catch (flagErr: any) {
              console.error(
                '❌ Flag write failed for backup request:',
                flagErr?.code,
                flagErr?.message
              );
              try {
                await setDoc(
                  doc(db, TOMBSTONE_COLLECTION, sourceKey.replace(/[:/]/g, '_')),
                  { sourceKey, reason: 'flag-write-failed', createdAt: new Date().toISOString() }
                );
              } catch {
                /* ignore */
              }
              setTimeout(() => inFlightRef.current.delete(flightKey), 30_000);
              continue;
            }

            await setDoc(doc(collection(db, 'activity_feed')), {
              type: 'activity',
              icon: 'alert-octagon',
              tone: 'clay',
              title: `🚨 Backup Requested — ${incidentType}`,
              meta: metaParts.join(' '),
              time: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              sourceKey,
            });

            inFlightRef.current.delete(flightKey);
          } catch (err: any) {
            console.error(
              'Failed to log backup request:',
              err?.code,
              err?.message
            );
            setTimeout(
              () => inFlightRef.current.delete(flightKey),
              err?.code === 'permission-denied' ? 30_000 : 5_000
            );
          }
        }
      },
      (error) =>
        console.warn('backup_requests listener:', error?.message || error)
    );

    return () => unsubBackup();
  }, [hiddenKeys]);

  // ============================================================
  // ✅ LISTENER 5: final_reports → activity_feed
  // ============================================================
  useEffect(() => {
    const db = getFirestore();
    const finalQ = query(
      collection(db, 'final_reports'),
      orderBy('submittedAt', 'desc')
    );

    const unsubFinal = onSnapshot(
      finalQ,
      async (snapshot) => {
        for (const d of snapshot.docs) {
          const data = d.data();
          if (data[FLAG_FINAL_LOGGED] === true) continue;

          const sourceKey = `final:${d.id}`;
          if (hiddenKeys.has(sourceKey)) continue;

          const flightKey = `fin-${d.id}`;
          if (inFlightRef.current.has(flightKey)) continue;
          inFlightRef.current.add(flightKey);

          const incidentId = data.incidentId?.toString() || d.id;

          const responderName =
            data.responderName ||
            data.teamLeader ||
            data.responder ||
            'A responder';

          let incidentType = normalizeIncidentType(
            data.incidentType || data.incidentName || data.type,
            data.specificType
          );

          let locationName =
            data.incidentLocation ||
            data.location?.address ||
            data.location ||
            data.address ||
            '';

          if ((!incidentType || incidentType === 'Incident') && incidentId) {
            try {
              const reportDoc = await getDoc(
                doc(db, 'incident_reports', incidentId)
              );
              if (reportDoc.exists()) {
                const rd = reportDoc.data() as any;
                incidentType = normalizeIncidentType(
                  rd.incidentType || rd.incidentName || rd.type,
                  rd.specificType
                );
                if (!locationName) {
                  locationName =
                    rd.location?.address ||
                    rd.location ||
                    rd.address ||
                    rd.incidentLocation ||
                    '';
                }
              }
            } catch (e) {
              console.warn(
                'Could not resolve incident report for final report:',
                e
              );
            }
          }

          const outcome = (data.finalOutcome || 'Resolved').toString();

          const metaParts: string[] = [];
          metaParts.push(
            `${responderName} submitted a final report for the ${incidentType} incident`
          );
          if (locationName && locationName.trim()) {
            metaParts.push(`at ${locationName}`);
          }
          metaParts.push(`Outcome: ${outcome}.`);

          try {
            try {
              await updateDoc(d.ref, {
                [FLAG_FINAL_LOGGED]: true,
                dashboardFinalLoggedAt: new Date().toISOString(),
              });
            } catch (flagErr: any) {
              console.error(
                '❌ Flag write failed for final report:',
                flagErr?.code,
                flagErr?.message
              );
              try {
                await setDoc(
                  doc(db, TOMBSTONE_COLLECTION, sourceKey.replace(/[:/]/g, '_')),
                  { sourceKey, reason: 'flag-write-failed', createdAt: new Date().toISOString() }
                );
              } catch {
                /* ignore */
              }
              setTimeout(() => inFlightRef.current.delete(flightKey), 30_000);
              continue;
            }

            await setDoc(doc(collection(db, 'activity_feed')), {
              type: 'activity',
              icon: 'file-check',
              tone: 'forest',
              title: `📄 Final Report Ready — ${incidentType}`,
              meta: metaParts.join(' '),
              time: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              sourceKey,
            });

            inFlightRef.current.delete(flightKey);
          } catch (err: any) {
            console.error(
              'Failed to log final report:',
              err?.code,
              err?.message
            );
            setTimeout(
              () => inFlightRef.current.delete(flightKey),
              err?.code === 'permission-denied' ? 30_000 : 5_000
            );
          }
        }
      },
      (error) =>
        console.warn('final_reports listener:', error?.message || error)
    );

    return () => unsubFinal();
  }, [hiddenKeys]);

  // ============================================================
  // ✅ LISTENER 6: emergencyMessages (SMS fallback) → activity_feed
  // ============================================================
  useEffect(() => {
    const db = getFirestore();
    const smsQ = query(
      collection(db, 'emergencyMessages'),
      orderBy('timestamp', 'desc')
    );

    const unsubSms = onSnapshot(
      smsQ,
      (snapshot) => {
        snapshot.docs.forEach(async (d) => {
          const data = d.data();

          const sourceKey = `sms:${d.id}`;

          if (data[FLAG_SMS_LOGGED] === true) return;
          if (hiddenKeys.has(sourceKey)) return;

          const flightKey = `sms-${d.id}`;
          if (inFlightRef.current.has(flightKey)) return;
          inFlightRef.current.add(flightKey);

          const codeMap: Record<string, string> = {
            MED: 'Medical',
            FIRE: 'Fire',
            CRIME: 'Crime',
            ACC: 'Accident',
            FLOOD: 'Flood',
            OTHER: 'Emergency',
          };

          const rawCode = (data.code || 'OTHER').toString().toUpperCase();
          const incidentType =
            codeMap[rawCode] ||
            normalizeIncidentType(
              data.incidentType || data.type || 'Emergency'
            );

          const senderName =
            data.citizenName ||
            data.senderName ||
            data.reporter?.fullName ||
            data.reporterName ||
            '';

          const senderPhone =
            data.citizenPhone ||
            data.phoneNumber ||
            data.senderPhone ||
            'Unknown number';

          const displaySender = senderName
            ? `${senderName} (${senderPhone})`
            : senderPhone;

          const locationName =
            data.location?.address ||
            data.location ||
            data.address ||
            'unknown location';

          const priority = (data.priority || '').toString().toLowerCase();
          const priorityLabel =
            priority === 'high'
              ? 'HIGH'
              : priority === 'normal'
              ? 'NORMAL'
              : priority === 'low'
              ? 'LOW'
              : '';

          const metaParts: string[] = [];
          metaParts.push(
            `📱 SMS fallback — ${incidentType} report from ${displaySender}`
          );
          metaParts.push(`at ${locationName}`);
          if (priorityLabel) {
            metaParts.push(`· Priority: ${priorityLabel}`);
          }

          let activityRef: any = null;

          try {
            try {
              await updateDoc(d.ref, {
                [FLAG_SMS_LOGGED]: true,
                dashboardSmsLoggedAt: new Date().toISOString(),
              });
            } catch (flagErr: any) {
              console.error(
                '❌ Flag write failed for SMS (rules?):',
                flagErr?.code,
                flagErr?.message
              );
              try {
                await setDoc(
                  doc(
                    db,
                    TOMBSTONE_COLLECTION,
                    sourceKey.replace(/[:/]/g, '_')
                  ),
                  {
                    sourceKey,
                    reason: 'flag-write-failed',
                    createdAt: new Date().toISOString(),
                  }
                );
              } catch {
                /* ignore */
              }
              setTimeout(
                () => inFlightRef.current.delete(flightKey),
                30_000
              );
              return;
            }

            activityRef = doc(collection(db, 'activity_feed'));
            await setDoc(activityRef, {
              type: 'activity',
              icon: 'message-square',
              tone: 'gold',
              title: `📱 SMS Fallback — ${incidentType}`,
              meta: metaParts.join(' '),
              time: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              sourceKey,
            });

            inFlightRef.current.delete(flightKey);
          } catch (err: any) {
            console.error(
              'Failed to log SMS fallback:',
              err?.code,
              err?.message
            );
            if (activityRef) {
              try {
                await deleteDoc(activityRef);
              } catch {
                /* ignore */
              }
            }
            setTimeout(
              () => inFlightRef.current.delete(flightKey),
              err?.code === 'permission-denied' ? 30_000 : 5_000
            );
          }
        });
      },
      (error) =>
        console.warn('emergencyMessages listener:', error?.message || error)
    );

    return () => unsubSms();
  }, [hiddenKeys]);

  // ============================================================
  // ✅ LISTENER 7: lora_alerts → activity_feed
  // ============================================================
  useEffect(() => {
    const db = getFirestore();
    const loraQ = query(
      collection(db, 'lora_alerts'),
      orderBy('timestamp', 'desc')
    );

    const unsubLora = onSnapshot(
      loraQ,
      (snapshot) => {
        snapshot.docs.forEach(async (d) => {
          const data = d.data();

          const sourceKey = `lora:${d.id}`;

          // Skip if already logged
          if (data[FLAG_LORA_LOGGED] === true) return;
          // Skip if tombstoned (deleted by user)
          if (hiddenKeys.has(sourceKey)) return;

          const flightKey = `lora-${d.id}`;
          if (inFlightRef.current.has(flightKey)) return;
          inFlightRef.current.add(flightKey);

          // ── Incident type ──
          const incidentType = normalizeIncidentType(
            data.incidentType ||
              data.incident_type ||
              data.type ||
              'Emergency'
          );

          // ── Device ID ──
          const deviceId =
            data.deviceId ||
            data.device_id ||
            'Unknown Device';

          // ── Location ──
          const lat =
            data.latitude !== undefined && data.latitude !== null
              ? String(data.latitude)
              : '';
          const lon =
            data.longitude !== undefined && data.longitude !== null
              ? String(data.longitude)
              : '';

          const locationLabel =
            lat && lon && lat !== 'No GPS' && lon !== 'No GPS'
              ? `${lat}, ${lon}`
              : 'no GPS fix';

          // ── Signal info ──
          const rssi = data.rssi ?? null;
          const snr = data.snr ?? null;

          const metaParts: string[] = [];
          metaParts.push(
            `📡 LoRa ${incidentType} alert from ${deviceId}`
          );
          metaParts.push(`at ${locationLabel}`);
          if (rssi !== null || snr !== null) {
            const sigBits: string[] = [];
            if (rssi !== null) sigBits.push(`RSSI ${rssi} dBm`);
            if (snr !== null) sigBits.push(`SNR ${snr} dB`);
            metaParts.push(`· ${sigBits.join(', ')}`);
          }

          let activityRef: any = null;

          try {
            // 1️⃣ Write the flag FIRST on the source doc
            try {
              await updateDoc(d.ref, {
                [FLAG_LORA_LOGGED]: true,
                dashboardLoraLoggedAt: new Date().toISOString(),
              });
            } catch (flagErr: any) {
              console.error(
                '❌ Flag write failed for LoRa alert (rules?):',
                flagErr?.code,
                flagErr?.message
              );
              // Fallback → write a tombstone so this never re-logs
              try {
                await setDoc(
                  doc(
                    db,
                    TOMBSTONE_COLLECTION,
                    sourceKey.replace(/[:/]/g, '_')
                  ),
                  {
                    sourceKey,
                    reason: 'flag-write-failed',
                    createdAt: new Date().toISOString(),
                  }
                );
              } catch {
                /* ignore */
              }
              setTimeout(
                () => inFlightRef.current.delete(flightKey),
                30_000
              );
              return;
            }

            // 2️⃣ Only after the flag succeeds, create the activity entry
            activityRef = doc(collection(db, 'activity_feed'));
            await setDoc(activityRef, {
              type: 'activity',
              icon: 'radio',
              tone: 'clay',
              title: `📡 LoRa Alert — ${incidentType}`,
              meta: metaParts.join(' '),
              time: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              sourceKey,
            });

            inFlightRef.current.delete(flightKey);
          } catch (err: any) {
            console.error(
              'Failed to log LoRa alert:',
              err?.code,
              err?.message
            );
            if (activityRef) {
              try {
                await deleteDoc(activityRef);
              } catch {
                /* ignore */
              }
            }
            setTimeout(
              () => inFlightRef.current.delete(flightKey),
              err?.code === 'permission-denied' ? 30_000 : 5_000
            );
          }
        });
      },
      (error) =>
        console.warn('lora_alerts listener:', error?.message || error)
    );

    return () => unsubLora();
  }, [hiddenKeys]);

  // ============================================================
  // ✅ LISTENER 8: forwarded_incidents (LoRa forwarded) → activity_feed
  // ============================================================
  useEffect(() => {
    const db = getFirestore();
    const forwardQ = query(
      collection(db, 'forwarded_incidents'),
      orderBy('createdAt', 'desc')
    );

    const unsubForward = onSnapshot(
      forwardQ,
      (snapshot) => {
        snapshot.docs.forEach(async (d) => {
          const data = d.data();

          const sourceKey = `lora-forward:${d.id}`;

          // Skip if already logged
          if (data[FLAG_LORA_FORWARD_LOGGED] === true) return;
          // Skip if tombstoned (deleted by user)
          if (hiddenKeys.has(sourceKey)) return;

          // Only log LoRa-sourced forwards (skip other sources)
          const src = (data.source || '').toString().toLowerCase();
          if (!src.includes('lora')) return;

          const flightKey = `lora-fwd-${d.id}`;
          if (inFlightRef.current.has(flightKey)) return;
          inFlightRef.current.add(flightKey);

          // ── Incident type ──
          const incidentType = normalizeIncidentType(
            data.type ||
              data.incidentType ||
              data.incident_type ||
              'Emergency'
          );

          // ── Device ID ──
          const deviceId =
            data.deviceId ||
            data.device_id ||
            'Unknown Device';

          // ── Location ──
          const locationLabel =
            data.address ||
            data.location ||
            data.coordinates ||
            'unknown location';

          // ── Forwarded-by ──
          const forwardedBy =
            data.forwardedBy ||
            data.verifiedBy ||
            'EOC';

          const metaParts: string[] = [];
          metaParts.push(
            `🚀 LoRa ${incidentType} alert from ${deviceId} forwarded to Dispatch`
          );
          metaParts.push(`at ${locationLabel}`);
          metaParts.push(`· by ${forwardedBy}`);

          let activityRef: any = null;

          try {
            // 1️⃣ Write the flag FIRST on the forwarded doc
            try {
              await updateDoc(d.ref, {
                [FLAG_LORA_FORWARD_LOGGED]: true,
                dashboardLoRaForwardLoggedAt: new Date().toISOString(),
              });
            } catch (flagErr: any) {
              console.error(
                '❌ Flag write failed for LoRa forward (rules?):',
                flagErr?.code,
                flagErr?.message
              );
              try {
                await setDoc(
                  doc(
                    db,
                    TOMBSTONE_COLLECTION,
                    sourceKey.replace(/[:/]/g, '_')
                  ),
                  {
                    sourceKey,
                    reason: 'flag-write-failed',
                    createdAt: new Date().toISOString(),
                  }
                );
              } catch {
                /* ignore */
              }
              setTimeout(
                () => inFlightRef.current.delete(flightKey),
                30_000
              );
              return;
            }

            // 2️⃣ Only after the flag succeeds, create the activity entry
            activityRef = doc(collection(db, 'activity_feed'));
            await setDoc(activityRef, {
              type: 'activity',
              icon: 'send',
              tone: 'forest',
              title: `🚀 LoRa → Dispatch — ${incidentType}`,
              meta: metaParts.join(' '),
              time: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              sourceKey,
            });

            inFlightRef.current.delete(flightKey);
          } catch (err: any) {
            console.error(
              'Failed to log LoRa forward:',
              err?.code,
              err?.message
            );
            if (activityRef) {
              try {
                await deleteDoc(activityRef);
              } catch {
                /* ignore */
              }
            }
            setTimeout(
              () => inFlightRef.current.delete(flightKey),
              err?.code === 'permission-denied' ? 30_000 : 5_000
            );
          }
        });
      },
      (error) =>
        console.warn('forwarded_incidents listener:', error?.message || error)
    );

    return () => unsubForward();
  }, [hiddenKeys]);

  // ============================================================
  // ✅ CLEAR ALL ACTIVITY (WITH TOMBSTONES)
  // ============================================================
  const handleClearAllActivity = useCallback(async () => {
    if (
      !window.confirm(
        '⚠️ Clear all activity?\n\nThis will permanently delete every item AND write permanent "never show again" markers in Firestore.\n\nOld events will NOT come back — even if new data is added later.\n\nThis cannot be undone.'
      )
    )
      return;

    setIsClearing(true);
    try {
      const db = getFirestore();
      const colRef = collection(db, 'activity_feed');
      const snapshot = await getDocs(colRef);

      if (snapshot.empty) {
        showToast('Nothing to clear.', 'ok');
        return;
      }

      // 1) Write tombstones for every item that has a sourceKey
      const tombstoneWrites = snapshot.docs.map(async (d) => {
        const data = d.data();
        const sourceKey = data.sourceKey?.toString();
        if (!sourceKey) return;

        const tombstoneId = sourceKey.replace(/[:/]/g, '_');
        try {
          await setDoc(
            doc(db, TOMBSTONE_COLLECTION, tombstoneId),
            {
              sourceKey,
              reason: 'cleared-by-user',
              createdAt: new Date().toISOString(),
            },
            { merge: true }
          );
        } catch (e) {
          console.warn('Failed to write tombstone for', sourceKey, e);
        }
      });
      await Promise.all(tombstoneWrites);

      // 2) Delete every activity entry
      await Promise.all(snapshot.docs.map((d) => deleteDoc(d.ref)));

      activityCreatedAtCache.current.clear();
      setLiveActivity([]);
      showToast(
        `Cleared ${snapshot.size} activity item${snapshot.size === 1 ? '' : 's'}. They will not come back.`
      );
    } catch (err: any) {
      console.error('Failed to clear activity:', err);
      showToast(`Failed to clear activity: ${err.message}`, 'err');
    } finally {
      setIsClearing(false);
    }
  }, [showToast]);

  // ---------- User actions ----------
  const handleToggleStatus = useCallback(
    async (u: UserData) => {
      const newStatus = u.status === 'active' ? 'inactive' : 'active';
      const action = newStatus === 'inactive' ? 'deactivate' : 'activate';
      if (!window.confirm(`Are you sure you want to ${action} ${u.name}?`)) return;

      try {
        const db = getFirestore();
        const auth = getAuth();
        const currentUser = auth.currentUser;
        if (!currentUser) return showToast('You are not logged in.', 'err');

        const collectionName = u.isManagedUser ? 'manage_users' : 'users';
        await setDoc(
          doc(db, collectionName, u.id),
          {
            status: newStatus,
            updatedAt: new Date().toISOString(),
            updatedBy: currentUser.email || currentUser.uid,
          },
          { merge: true }
        );
        setUsers((prev) =>
          prev.map((x) => (x.id === u.id ? { ...x, status: newStatus } : x))
        );
        showToast(`User ${action}d successfully.`);
      } catch (err: any) {
        showToast(`Failed to update status: ${err.message}`, 'err');
      }
    },
    [showToast]
  );

  const handleDeleteUser = useCallback(
    async (u: UserData) => {
      if (
        !window.confirm(
          `⚠️ Delete this user?\n\nName: ${u.name}\nEmail: ${u.email}\n\nThis cannot be undone!`
        )
      )
        return;
      try {
        const db = getFirestore();
        const collectionName = u.isManagedUser ? 'manage_users' : 'users';
        await deleteDoc(doc(db, collectionName, u.id));
        setUsers((prev) => prev.filter((x) => x.id !== u.id));
        showToast(`User "${u.name}" deleted.`);
      } catch (err: any) {
        showToast(`Failed to delete user: ${err.message}`, 'err');
      }
    },
    [showToast]
  );

  const handleResetPassword = useCallback(
    async (u: UserData) => {
      if (!window.confirm(`Reset password for ${u.name} (${u.email})?`)) return;
      try {
        const auth = getAuth();
        const db = getFirestore();
        const currentUser = auth.currentUser;
        if (!currentUser) return showToast('You are not logged in.', 'err');

        const newPassword = generateStrongPassword();
        await sendPasswordResetEmail(auth, u.email);

        const collectionName = u.isManagedUser ? 'manage_users' : 'users';
        await updateDoc(doc(db, collectionName, u.id), {
          tempPassword: newPassword,
          passwordResetBy: currentUser.email || currentUser.uid,
          passwordResetAt: new Date().toISOString(),
          requirePasswordChange: false,
          resetRequested: false,
          resetStatus: 'completed',
        });

        showToast(`Password reset email sent to ${u.email}.`);
      } catch (err: any) {
        showToast(`Failed to reset password: ${err.message}`, 'err');
      }
    },
    [showToast]
  );

  void handleToggleStatus;
  void handleDeleteUser;
  void handleResetPassword;

  // ---------- Lucide ----------
  useEffect(() => {
    const init = () => window.lucide?.createIcons();
    if (window.lucide) {
      init();
      return;
    }
    const existing = document.querySelector('script[data-lucide-cdn]');
    if (existing) {
      existing.addEventListener('load', init, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/lucide@latest/dist/umd/lucide.js';
    script.async = true;
    script.setAttribute('data-lucide-cdn', 'true');
    script.onload = init;
    document.body.appendChild(script);
  }, []);

  useEffect(() => {
    window.lucide?.createIcons();
  }, [toast, liveActivity, pendingRequests, firestoreIncidents, isClearing, chartFilter, calendarOpen, selectedDate]);

  // Close the green "open" state if the native date picker is dismissed
  useEffect(() => {
    const el = dateInputRef.current;
    if (!el) return;
    const close = () => setCalendarOpen(false);
    el.addEventListener('cancel', close);
    return () => el.removeEventListener('cancel', close);
  }, []);

  // ============================================================
  // ✅ Effective incidents = base incident_reports MERGED with
  //    live status from responder_tracking + final_reports.
  // ============================================================
  const effectiveIncidents = useMemo<Incident[]>(() => {
    // ✅ Only incidents that really exist in Firebase (incident_reports).
    //    The `incidents` prop (local / cached data) is no longer used.
    const base = firestoreIncidents;

    const mapped = base.map((inc) => {
      const candidateIds = [
        inc.__docId,
        ...(inc.__altIds || []),
      ].filter(Boolean) as string[];

      for (const cid of candidateIds) {
        if (finalReportIds.has(normId(cid))) {
          return { ...inc, status: 'Resolved' };
        }
      }

      let liveStatus: string | null = null;
      for (const cid of candidateIds) {
        const s = responderTracking[normId(cid)];
        if (s) {
          liveStatus = s;
          break;
        }
      }

      if (liveStatus) {
        if (liveStatus === 'resolved' || liveStatus === 'completed') {
          return { ...inc, status: 'Resolved' };
        }
        if (liveStatus === 'enroute' || liveStatus === 'on_scene') {
          return { ...inc, status: 'En Route' };
        }
        if (liveStatus === 'dispatched') {
          return { ...inc, status: 'Dispatched' };
        }
      }

      return inc;
    });

    // ✅ Same incident = ONE incident, even if it was saved as 2 documents.
    //    1) Documents that share ANY id (doc id, incidentId, reportId, …) are merged.
    //    2) Documents with the same type + location reported within 5 minutes
    //       of each other are also treated as the same incident.
    //    A resolved copy wins over an open one.
    const groups: Incident[] = [];
    const idToGroup = new Map<string, number>();
    const FIVE_MIN = 5 * 60 * 1000;

    mapped.forEach((inc) => {
      const ids = [inc.__key, inc.__docId, ...(inc.__altIds || [])]
        .map(normId)
        .filter(Boolean);

      // 1) match by any shared id
      let idx = -1;
      for (const id of ids) {
        const found = idToGroup.get(id);
        if (found !== undefined) {
          idx = found;
          break;
        }
      }

      // 2) fallback: same type + same location + close in time
      if (idx === -1) {
        const loc = normId(inc.location);
        if (loc && loc !== 'unknown location') {
          const t = new Date(inc.reportedAt).getTime();
          idx = groups.findIndex(
            (g) =>
              normId(g.type) === normId(inc.type) &&
              normId(g.location) === loc &&
              Math.abs(new Date(g.reportedAt).getTime() - t) <= FIVE_MIN
          );
        }
      }

      if (idx === -1) {
        groups.push(inc);
        idx = groups.length - 1;
      } else if (groups[idx].status !== 'Resolved' && inc.status === 'Resolved') {
        groups[idx] = inc;
      }

      ids.forEach((id) => idToGroup.set(id, idx));
    });

    return groups;
  }, [firestoreIncidents, responderTracking, finalReportIds]);

  // 🔎 Debug: open the browser console (F12) to see which ids match
  useEffect(() => {
    if (!firestoreIncidents.length) return;
    console.log('[Dashboard] final_reports ids:', Array.from(finalReportIds));
    console.table(
      effectiveIncidents.map((i) => ({
        docId: i.__docId,
        altIds: (i.__altIds || []).join(', '),
        status: i.status,
      }))
    );
  }, [firestoreIncidents, finalReportIds, effectiveIncidents]);

  // ---------- KPIs ----------
  // ✅ Open incidents = Firebase incidents that are NOT resolved yet.
  //    When an incident is resolved it vanishes from Total + Active.
  const openIncidents = effectiveIncidents.filter(
    (i) => !['Resolved', 'Completed', 'Closed'].includes(i.status)
  ).length;
  const totalIncidents = openIncidents;
  const activeIncidents = openIncidents;

  // ✅ Resolved Cases = number of final reports submitted (matches the Final Reports page)
  const resolvedIncidents = finalReportCount;
  const resolvedRate =
    resolvedIncidents + openIncidents > 0
      ? Math.round((resolvedIncidents / (resolvedIncidents + openIncidents)) * 100)
      : null;

  // ✅ Count every account from the Manage Users collection (already in `users` state)
  const activeResponders = users.length;

  const totalDisplay = useCountUp(totalIncidents);
  const activeDisplay = useCountUp(activeIncidents);
  const resolvedDisplay = useCountUp(resolvedIncidents);
  const respondersDisplay = useCountUp(activeResponders);

  // ---------- Chart data based on filter & selected date ----------
  const chartData = useMemo(() => {
    const baseDate = selectedDate;

    if (chartFilter === 'daily') {
      const days: { key: string; label: string }[] = [];
      // Generate 7 days ending on selectedDate
      for (let i = 6; i >= 0; i--) {
        const d = new Date(baseDate);
        d.setDate(d.getDate() - i);
        days.push({
          key: d.toDateString(),
          label: d.toLocaleDateString('en-US', { weekday: 'short' }),
        });
      }
      const reported = days.map(
        (d) =>
          effectiveIncidents.filter(
            (inc) => new Date(inc.reportedAt).toDateString() === d.key
          ).length
      );
      const resolved = days.map(
        (d) =>
          effectiveIncidents.filter(
            (inc) =>
              new Date(inc.reportedAt).toDateString() === d.key &&
              inc.status === 'Resolved'
          ).length
      );
      return {
        labels: days.map((d) => d.label),
        reported,
        resolved,
        reportedTotal: reported.reduce((a, b) => a + b, 0),
        resolvedTotal: resolved.reduce((a, b) => a + b, 0),
      };
    } else if (chartFilter === 'weekly') {
      // Weekly view: 12 weeks ending on the week of selectedDate
      const buckets: { label: string; key: string; reported: number; resolved: number }[] = [];

      // Normalize baseDate to start of its week (Monday)
      // ✅ FIX: copy the date first so we never mutate `selectedDate` state
      const day = baseDate.getDay();
      const diff = baseDate.getDate() - day + (day === 0 ? -6 : 1);
      const startOfWeek = new Date(baseDate);
      startOfWeek.setDate(diff);
      startOfWeek.setHours(0, 0, 0, 0);

      for (let i = 11; i >= 0; i--) {
        const d = new Date(startOfWeek);
        d.setDate(d.getDate() - i * 7);
        buckets.push({
          label: `${d.getMonth() + 1}/${d.getDate()}`,
          key: d.toDateString(), // Use start of week as key
          reported: 0,
          resolved: 0,
        });
      }

      effectiveIncidents.forEach((inc) => {
        const incDate = new Date(inc.reportedAt);
        incDate.setHours(0, 0, 0, 0);

        for (let i = 0; i < buckets.length; i++) {
          const bucketStart = new Date(buckets[i].key);
          const bucketEnd = new Date(bucketStart);
          bucketEnd.setDate(bucketStart.getDate() + 6);
          if (incDate >= bucketStart && incDate <= bucketEnd) {
            buckets[i].reported += 1;
            if (inc.status === 'Resolved') {
              buckets[i].resolved += 1;
            }
            break;
          }
        }
      });

      return {
        labels: buckets.map((b) => b.label),
        reported: buckets.map((b) => b.reported),
        resolved: buckets.map((b) => b.resolved),
        reportedTotal: buckets.reduce((a, b) => a + b.reported, 0),
        resolvedTotal: buckets.reduce((a, b) => a + b.resolved, 0),
      };
    } else {
      // Monthly view: 12 months ending on selectedDate
      const now = selectedDate;
      const buckets: { label: string; key: string; reported: number; resolved: number }[] = [];

      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        buckets.push({
          label: MONTH_LABELS[d.getMonth()],
          key: `${d.getFullYear()}-${d.getMonth()}`,
          reported: 0,
          resolved: 0,
        });
      }
      effectiveIncidents.forEach((inc) => {
        const d = new Date(inc.reportedAt);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        const bucket = buckets.find((b) => b.key === key);
        if (bucket) {
          bucket.reported += 1;
          if (inc.status === 'Resolved') {
            bucket.resolved += 1;
          }
        }
      });
      return {
        labels: buckets.map((b) => b.label),
        reported: buckets.map((b) => b.reported),
        resolved: buckets.map((b) => b.resolved),
        reportedTotal: buckets.reduce((a, b) => a + b.reported, 0),
        resolvedTotal: buckets.reduce((a, b) => a + b.resolved, 0),
      };
    }
  }, [effectiveIncidents, chartFilter, selectedDate]);

  // ---------- Date-range label for the Calendar button ----------
  const rangeLabel = useMemo(() => {
    let end = new Date(selectedDate);
    end.setHours(0, 0, 0, 0);
    let start = new Date(end);

    if (chartFilter === 'daily') {
      start.setDate(end.getDate() - 6);
    } else if (chartFilter === 'weekly') {
      const day = end.getDay();
      const monday = new Date(end);
      monday.setDate(end.getDate() - day + (day === 0 ? -6 : 1));
      start = new Date(monday);
      start.setDate(monday.getDate() - 11 * 7);
      end = new Date(monday);
      end.setDate(monday.getDate() + 6);
    } else {
      start = new Date(end.getFullYear(), end.getMonth() - 11, 1);
      end = new Date(end.getFullYear(), end.getMonth() + 1, 0);
    }
    return formatRangeLabel(start, end);
  }, [selectedDate, chartFilter]);

  // ---------- Feed state ----------
  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all');

  const showFeed = (key: FeedFilter) => feedFilter === 'all' || feedFilter === key;


  // ---------- Charts ----------
  useEffect(() => {
    const initCharts = () => {
      if (!window.Chart) return;
      const charts: any[] = [];

      // Colours tuned for the navy analytics card (same navy as the header)
      const reported = cssVar('--chart-reported', '#6F9BFF');
      const resolved = cssVar('--chart-resolved', '#5EEAD4');
      const navy = cssVar('--navy', '#0B1A3E');
      const tickColor = 'rgba(255, 255, 255, 0.65)';
      const gridColor = 'rgba(255, 255, 255, 0.08)';

      const tooltipBase = {
        backgroundColor: '#ffffff',
        titleColor: navy,
        bodyColor: '#4a5675',
        borderColor: 'rgba(255, 255, 255, 0.2)',
        borderWidth: 1,
        padding: 10,
        cornerRadius: 10,
        displayColors: true,
        boxPadding: 4,
        titleFont: { family: 'Plus Jakarta Sans', size: 12, weight: '700' },
        bodyFont: { family: 'Plus Jakarta Sans', size: 11.5 },
      };

      if (weeklyChartRef.current) {
        const ctx = weeklyChartRef.current.getContext('2d');
        if (ctx) {
          const gradient = ctx.createLinearGradient(0, 0, 0, 260);
          gradient.addColorStop(0, 'rgba(111, 155, 255, 0.35)');
          gradient.addColorStop(1, 'rgba(111, 155, 255, 0)');

          charts.push(
            new window.Chart(ctx, {
              type: 'line',
              data: {
                labels: chartData.labels,
                datasets: [
                  {
                    label: 'Reported',
                    data: chartData.reported,
                    borderColor: reported,
                    backgroundColor: gradient,
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: navy,
                    pointBorderColor: reported,
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                  },
                  {
                    label: 'Resolved',
                    data: chartData.resolved,
                    borderColor: resolved,
                    borderDash: [5, 5],
                    borderWidth: 2,
                    fill: false,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                  },
                ],
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { display: false }, tooltip: tooltipBase },
                scales: {
                  y: {
                    beginAtZero: true,
                    ticks: {
                      precision: 0,
                      color: tickColor,
                      font: { family: 'Plus Jakarta Sans', size: 11 },
                    },
                    grid: { color: gridColor },
                    border: { display: false },
                  },
                  x: {
                    grid: { display: false },
                    ticks: {
                      color: tickColor,
                      font: { family: 'Plus Jakarta Sans', size: 11 },
                    },
                    border: { display: false },
                  },
                },
                animation: { duration: 900, easing: 'easeOutQuart' },
              },
            })
          );
        }
      }

      chartsRef.current = charts;
    };

    chartsRef.current.forEach((c) => c.destroy());
    chartsRef.current = [];

    if (window.Chart) {
      initCharts();
    } else {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
      script.async = true;
      script.onload = initCharts;
      document.body.appendChild(script);
    }

    return () => {
      chartsRef.current.forEach((c) => c.destroy());
      chartsRef.current = [];
    };
  }, [chartData]);

  // ---------- Tab keyboard navigation ----------
  const handleTabKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const next = (idx + dir + FEED_TABS.length) % FEED_TABS.length;
    setFeedFilter(FEED_TABS[next].key);
  };

  // ---------- Calendar Handler ----------
  const handleDateSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const dateVal = e.target.value;
    if (dateVal) {
      const [y, m, d] = dateVal.split('-').map(Number);
      setSelectedDate(new Date(y, m - 1, d)); // local time, no UTC shift
    }
    setCalendarOpen(false);
  };

  return (
    <div className="dashboard">
      <div className="dashboard-scroll">
        {/* KPI */}
        <div className="grid grid-kpi">
          <KpiCard
            label="Total Incidents"
            value={totalDisplay}
            icon="clipboard-list"
            iconBg="bg-gold-soft"
            trend={{ text: 'All time', tone: 'muted' }}
          />
          <KpiCard
            label="Active Incidents"
            value={activeDisplay}
            icon="shield-alert"
            iconBg="bg-forest-soft"
            trend={{
              text: activeIncidents > 0 ? 'Needs attention' : 'All clear',
              tone: activeIncidents > 0 ? 'gold' : 'forest',
              pulse: activeIncidents > 0,
            }}
          />
          <KpiCard
            label="Resolved Cases"
            value={resolvedDisplay}
            icon="check-circle-2"
            iconBg="bg-clay-soft"
            trend={{
              text: resolvedRate === null ? 'No cases yet' : `${resolvedRate}% rate`,
              tone: resolvedRate === null ? 'muted' : 'forest',
            }}
          />
          {/* ✅ Active Responders — counts every managed user account, no "On duty" pill */}
          <KpiCard
            label="Active Responders"
            value={respondersDisplay}
            icon="users"
            iconBg="bg-gold-soft"
          />
        </div>

        {/* FEED + ANALYTICS */}
        <div className="feed-layout">
          {/* LEFT */}
          <section className="feed-col" aria-label="System activity">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                flexWrap: 'wrap',
                flexShrink: 0,
              }}
            >
              <div className="feed-tabs" role="tablist" aria-label="Filter feed">
                {FEED_TABS.map((t, idx) => (
                  <button
                    key={t.key}
                    role="tab"
                    id={`feed-tab-${t.key}`}
                    aria-selected={feedFilter === t.key}
                    aria-controls={`feed-panel-${t.key}`}
                    tabIndex={feedFilter === t.key ? 0 : -1}
                    className={`feed-tab ${feedFilter === t.key ? 'on' : ''}`}
                    onClick={() => setFeedFilter(t.key)}
                    onKeyDown={(e) => handleTabKeyDown(e, idx)}
                  >
                    {t.label}
                    {t.key !== 'activity' && pendingRequests.length > 0 && (
                      <span style={{ marginLeft: 6, fontWeight: 800 }}>
                        {t.key === 'request' ? `(${pendingRequests.length})` : ''}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {liveActivity.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAllActivity}
                  disabled={isClearing}
                  title="Delete all recent activity items"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '7px 14px',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    fontFamily: 'inherit',
                    color: 'var(--alert)',
                    background: 'var(--alert-soft)',
                    border: '1px solid var(--alert-soft)',
                    borderRadius: 999,
                    cursor: isClearing ? 'not-allowed' : 'pointer',
                    opacity: isClearing ? 0.6 : 1,
                    whiteSpace: 'nowrap',
                    transition: 'background 140ms ease, color 140ms ease',
                  }}
                >
                  <i
                    data-lucide="trash-2"
                    style={{ width: 13, height: 13 }}
                  />
                  {isClearing ? 'Clearing…' : 'Clear All'}
                </button>
              )}
            </div>

            <div className="feed-scroll">
              <div
                id={`feed-panel-${feedFilter}`}
                role="tabpanel"
                aria-labelledby={`feed-tab-${feedFilter}`}
                className="feed-list"
              >
                {(() => {
                  type StreamItem =
                    | { kind: 'activity'; key: string; createdAt: number; data: any }
                    | { kind: 'request'; key: string; createdAt: number; data: PendingRequest };

                  const stream: StreamItem[] = [];

                  if (showFeed('activity')) {
                    liveActivity.forEach((a) =>
                      stream.push({
                        kind: 'activity',
                        key: `act-${a.id}`,
                        createdAt: a.createdAt,
                        data: a,
                      })
                    );
                  }

                  // ✅ New requests (password reset + profile update) from Manage Users
                  if (showFeed('request')) {
                    pendingRequests.forEach((r) =>
                      stream.push({
                        kind: 'request',
                        key: r.id,
                        createdAt: r.createdAt,
                        data: r,
                      })
                    );
                  }

                  // ✅ Pending requests are pinned to the top, then newest first
                  stream.sort((x, y) => {
                    if (x.kind !== y.kind) return x.kind === 'request' ? -1 : 1;
                    return y.createdAt - x.createdAt;
                  });

                  if (stream.length === 0) {
                    return (
                      <div className="glass-card card-pad">
                        <EmptyState
                          icon="inbox"
                          title="Nothing here yet"
                          body="When new items arrive, they'll appear in this feed."
                        />
                      </div>
                    );
                  }

                  return stream.map((item) => {
                    if (item.kind === 'request') {
                      const r = item.data;
                      return (
                        <article className="glass-card card-pad feed-post" key={item.key}>
                          <header className="feed-post-head">
                            <div className="feed-avatar bg-gold-soft" aria-hidden>
                              {getInitials(r.name)}
                            </div>
                            <div>
                              <p className="feed-author">{r.name}</p>
                              <p className="feed-time">{formatRelativeTime(r.createdAt)}</p>
                            </div>
                            <span className="feed-tag bg-gold-soft">New request</span>
                          </header>
                          <p className="feed-body">{r.detail}</p>
                          <div className="request-actions">
                            <button
                              className="btn btn-forest flex-fill"
                              onClick={() => onTabChange('users')}
                            >
                              <i data-lucide="arrow-right" style={{ width: 13, height: 13 }} /> Review in Manage Users
                            </button>
                          </div>
                        </article>
                      );
                    }

                    const a = item.data;
                    return (
                      <article className="glass-card card-pad feed-post" key={item.key}>
                        <header className="feed-post-head">
                          <div className={`feed-avatar bg-${a.tone}-soft`} aria-hidden>
                            <i data-lucide={a.icon} style={{ width: 16, height: 16 }} />
                          </div>
                          <div>
                            <p className="feed-author">{a.title}</p>
                            <p className="feed-time">{a.time}</p>
                          </div>
                          <span className="feed-tag bg-clay-soft">Activity</span>
                        </header>
                        <p className="feed-body-soft">{a.meta}</p>
                      </article>
                    );
                  });
                })()}
              </div>
            </div>
          </section>

          {/* RIGHT */}
          <aside className="analytics-col" aria-label="Analytics">
            <div className="glass-card card-pad">
              {/* ✅ CHART HEADER: title + subtitle on the left, buttons on the right (same row) */}
              <div className="chart-header">
                {/* LEFT: title + subtitle */}
                <div className="chart-header-text">
                  <h3 className="section-title">
                    Incidents &amp;{' '}
                    {chartFilter === 'daily'
                      ? 'Daily'
                      : chartFilter === 'weekly'
                      ? 'Weekly'
                      : 'Monthly'}{' '}
                    Activity
                  </h3>
                  <p className="section-sub">
                    {chartFilter === 'daily'
                      ? 'Reports logged over the past 7 days'
                      : chartFilter === 'weekly'
                      ? 'Reports logged over the past 12 weeks'
                      : 'Reports logged per month'}
                  </p>
                </div>

                {/* RIGHT: buttons, same row as the title */}
                <div className="chart-header-actions">
                  <div className="chart-cal-wrap" ref={calendarRef}>
                    <button
                      type="button"
                      className={`feed-tab chart-cal-btn ${calendarOpen ? 'on' : ''}`}
                      aria-label={`Select date. Showing ${rangeLabel}`}
                      aria-pressed={calendarOpen}
                      onClick={() => {
                        setCalendarOpen(true);
                        const el = dateInputRef.current;
                        if (!el) return;
                        el.focus();
                        try {
                          el.showPicker();
                        } catch {
                          /* focus fallback */
                        }
                      }}
                    >
                      <i data-lucide="calendar" style={{ width: 14, height: 14 }} />
                      <span>{rangeLabel}</span>
                    </button>

                    <input
                      ref={dateInputRef}
                      type="date"
                      className="chart-cal-input"
                      value={toInputValue(selectedDate)}
                      onChange={handleDateSelect}
                      onBlur={() => setCalendarOpen(false)}
                      tabIndex={-1}
                      aria-label="Select date"
                    />
                  </div>

                  <button
                    type="button"
                    className={`feed-tab ${chartFilter === 'daily' ? 'on' : ''}`}
                    onClick={() => setChartFilter('daily')}
                  >
                    Daily
                  </button>
                  <button
                    type="button"
                    className={`feed-tab ${chartFilter === 'weekly' ? 'on' : ''}`}
                    onClick={() => setChartFilter('weekly')}
                  >
                    Weekly
                  </button>
                  <button
                    type="button"
                    className={`feed-tab ${chartFilter === 'monthly' ? 'on' : ''}`}
                    onClick={() => setChartFilter('monthly')}
                  >
                    Monthly
                  </button>
                </div>
              </div>

              <div className="chart-stats">
                <div className="chart-stat">
                  <span className="chart-stat-dot reported" />
                  <span className="chart-stat-label">Reported</span>
                  <span className="chart-stat-value">{chartData.reportedTotal}</span>
                </div>
                <div className="chart-stat">
                  <span className="chart-stat-dot resolved" />
                  <span className="chart-stat-label">Resolved</span>
                  <span className="chart-stat-value">{chartData.resolvedTotal}</span>
                </div>
              </div>

              <div className="chart-box">
                <canvas
                  ref={weeklyChartRef}
                  id="weeklyChart"
                  aria-label={`Incidents reported and resolved`}
                  role="img"
                />
              </div>
            </div>
          </aside>
        </div>
      </div>

      {toast && (
        <div className={`toast toast-${toast.tone}`} role="status" aria-live="polite">
          <i
            data-lucide={toast.tone === 'ok' ? 'check-circle-2' : 'alert-circle'}
            style={{ width: 15, height: 15 }}
          />
          <span>{toast.msg}</span>
        </div>
      )}
    </div>
  );
};

export default DashboardHome;