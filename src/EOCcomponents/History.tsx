// History.tsx - Incident History view for EOC Dashboard
// Shows past/dispatched incidents from monitoring_status in a
// read-only list. Matches the EOC dark theme + filter bar layout.

import React, { useEffect, useMemo, useState } from 'react';
import {
  getFirestore,
  collection,
  onSnapshot,
  query,
  orderBy,
} from 'firebase/firestore';

interface HistoryIncident {
  id: string;
  incidentId?: string;
  type: string;
  location: string;
  status: string;
  description?: string;
  dispatchedUnits?: string;
  responder?: string;
  dispatchTime?: string;
  displayTime: string;
  displayDate: string;
  dateObj?: Date;
  severity?: 'HIGH' | 'MEDIUM' | 'LOW' | string;
  source: 'intake' | 'dispatch';
}

interface HistoryProps {
  sidebarOpen?: boolean;
}

const TYPE_ICON: Record<string, string> = {
  flood: '🌊',
  medical: '❤️',
  fire: '🔥',
  accident: '🚗',
  crime: '🚨',
};

const getTypeIcon = (type: string) => {
  const key = type.toLowerCase();
  return TYPE_ICON[key] || '⚠️';
};

const STATUS_COLORS: Record<string, string> = {
  resolved: '#28a745',
  closed: '#28a745',
  completed: '#28a745',
  on_scene: '#17a2b8',
  'on scene': '#17a2b8',
  enroute: '#ffc107',
  'en route': '#ffc107',
  dispatched: '#EB1616',
};

const statusColor = (status: string) =>
  STATUS_COLORS[status.toLowerCase()] || '#8A9BB0';

const SOURCE_STYLE: Record<'intake' | 'dispatch', { color: string; icon: string; label: string }> = {
  intake: { color: '#28a745', icon: '📄', label: 'Intake' },
  dispatch: { color: '#EB1616', icon: '👥', label: 'Dispatch' },
};

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const History: React.FC<HistoryProps> = () => {
  const [incidents, setIncidents] = useState<HistoryIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'intake' | 'dispatch'>('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '7d' | '30d'>('today');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  useEffect(() => {
    const db = getFirestore();
    const ref = collection(db, 'monitoring_status');

    // Order newest first. If Firestore complains about a missing index,
    // remove orderBy and sort in JS instead.
    const q = query(ref, orderBy('createdAt', 'desc'));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: HistoryIncident[] = snap.docs.map((docSnap) => {
          const data = docSnap.data();

          const rawTime =
            data.dispatchTime ||
            data.dispatchedTime ||
            data.acceptedAt ||
            data.updatedAt ||
            data.createdAt ||
            data.timestamp;

          let displayTime = '--:--';
          let displayDate = '--';
          let dateObj: Date | undefined;

          if (rawTime) {
            try {
              const date =
                rawTime?.toDate
                  ? rawTime.toDate()
                  : typeof rawTime === 'object' && rawTime?.seconds
                  ? new Date(rawTime.seconds * 1000)
                  : new Date(rawTime);

              if (!isNaN(date.getTime())) {
                dateObj = date;
                displayTime = date.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                });
                displayDate = date.toLocaleDateString([], {
                  year: 'numeric',
                  month: 'short',
                  day: '2-digit',
                });
              }
            } catch {
              if (typeof rawTime === 'string') {
                displayTime = rawTime.slice(0, 5);
              }
            }
          }

          // Location: prefer an address string, fall back to lat/long
          let location = data.location || data.address || '';
          if (!location && data.latitude != null && data.longitude != null) {
            location = `Lat:${data.latitude}, Long:${data.longitude}`;
          } else if (!location && data.lat != null && data.lng != null) {
            location = `Lat:${data.lat}, Long:${data.lng}`;
          }
          if (!location) location = 'Unknown location';

          const source: 'intake' | 'dispatch' =
            data.source === 'intake' || data.status === 'unassigned' || !data.dispatchedUnits
              ? data.dispatchedUnits || data.responder
                ? 'dispatch'
                : 'intake'
              : 'dispatch';

          return {
            id: docSnap.id,
            incidentId: data.incidentId || data.incident_id || docSnap.id,
            type: data.type || data.incidentType || 'Emergency',
            location,
            status: data.status || 'unknown',
            description: data.description || '',
            dispatchedUnits: data.dispatchedUnits || data.units || '',
            responder: data.responder || data.responderName || '',
            dispatchTime: data.dispatchTime || data.createdAt,
            displayTime,
            displayDate,
            dateObj,
            severity: data.severity || 'HIGH',
            source,
          };
        });

        setIncidents(list);
        setLoading(false);
      },
      (err) => {
        console.error('❌ History listener error:', err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  const typeOptions = useMemo(
    () => Array.from(new Set(incidents.map((i) => i.type))).sort(),
    [incidents]
  );
  const statusOptions = useMemo(
    () => Array.from(new Set(incidents.map((i) => i.status))).sort(),
    [incidents]
  );

  const filtered = incidents.filter((i) => {
    if (sourceFilter !== 'all' && i.source !== sourceFilter) return false;
    if (typeFilter !== 'all' && i.type !== typeFilter) return false;
    if (statusFilter !== 'all' && i.status !== statusFilter) return false;

    if (dateFilter !== 'all' && i.dateObj) {
      const now = new Date();
      if (dateFilter === 'today' && !isSameDay(i.dateObj, now)) return false;
      if (dateFilter === '7d') {
        const diff = (now.getTime() - i.dateObj.getTime()) / (1000 * 60 * 60 * 24);
        if (diff > 7) return false;
      }
      if (dateFilter === '30d') {
        const diff = (now.getTime() - i.dateObj.getTime()) / (1000 * 60 * 60 * 24);
        if (diff > 30) return false;
      }
    }

    if (search.trim()) {
      const s = search.toLowerCase();
      const hay = `${i.type} ${i.location} ${i.status} ${i.responder || ''}`.toLowerCase();
      if (!hay.includes(s)) return false;
    }

    return true;
  });

  const selectStyle: React.CSSProperties = {
    background: '#101B2B',
    border: '1px solid #2A3B52',
    borderRadius: '8px',
    padding: '9px 12px',
    color: '#fff',
    fontSize: '13px',
    outline: 'none',
  };

  const pillBtnStyle = (active: boolean, activeColor: string): React.CSSProperties => ({
    padding: '8px 18px',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 700,
    cursor: 'pointer',
    border: `1px solid ${active ? activeColor : '#2A3B52'}`,
    background: active ? activeColor : 'transparent',
    color: active ? '#fff' : '#8A9BB0',
    transition: 'all 0.15s',
  });

  return (
    <div className="history-page" style={{ padding: '24px' }}>
      {/* Title */}
      <div style={{ marginBottom: '18px' }}>
        <h2 style={{ color: '#fff', margin: 0, fontSize: '28px', fontWeight: 800 }}>
          Incident History
        </h2>
        <p style={{ color: '#8A9BB0', margin: '4px 0 0 0', fontSize: '13px' }}>
          {filtered.length} record{filtered.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Filter bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '20px',
          flexWrap: 'wrap',
          marginBottom: '20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: '#8A9BB0', fontSize: '13px', fontWeight: 700 }}>Source:</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={pillBtnStyle(sourceFilter === 'all', '#2E6DF6')} onClick={() => setSourceFilter('all')}>
              All
            </button>
            <button style={pillBtnStyle(sourceFilter === 'intake', '#28a745')} onClick={() => setSourceFilter('intake')}>
              Intake
            </button>
            <button style={pillBtnStyle(sourceFilter === 'dispatch', '#EB1616')} onClick={() => setSourceFilter('dispatch')}>
              Dispatch
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: '#8A9BB0', fontSize: '13px', fontWeight: 700 }}>Type:</span>
          <select style={selectStyle} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">All Types</option>
            {typeOptions.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: '#8A9BB0', fontSize: '13px', fontWeight: 700 }}>Status:</span>
          <select style={selectStyle} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All Status</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>{s.replace('_', ' ')}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: '#8A9BB0', fontSize: '13px', fontWeight: 700 }}>Date:</span>
          <select
            style={selectStyle}
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as typeof dateFilter)}
          >
            <option value="today">Today</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="all">All time</option>
          </select>
        </div>

        <input
          type="text"
          placeholder="Search incidents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            ...selectStyle,
            padding: '10px 14px 10px 36px',
            minWidth: '240px',
            marginLeft: 'auto',
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' fill='%238A9BB0' viewBox='0 0 16 16'%3E%3Cpath d='M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0'/%3E%3C/svg%3E\")",
            backgroundRepeat: 'no-repeat',
            backgroundPosition: '12px center',
          }}
        />
      </div>

      {loading ? (
        <div style={{ color: '#8A9BB0', padding: '40px 0', textAlign: 'center' }}>
          Loading history...
        </div>
      ) : filtered.length === 0 ? (
        <div
          style={{
            color: '#8A9BB0',
            padding: '40px 0',
            textAlign: 'center',
            background: '#101B2B',
            borderRadius: '10px',
            border: '1px solid #2A3B52',
          }}
        >
          No history records found.
        </div>
      ) : (
        <div
          style={{
            background: '#101B2B',
            border: '1px solid #2A3B52',
            borderRadius: '10px',
            overflow: 'visible',
          }}
        >
          {/* Header row */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '95px 85px 110px 1.4fr 100px 1.1fr 110px 60px',
              gap: '12px',
              padding: '14px 18px',
              background: '#0D1726',
              borderBottom: '1px solid #2A3B52',
              borderRadius: '10px 10px 0 0',
              color: '#8A9BB0',
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.6px',
            }}
          >
            <div>Date</div>
            <div>Time</div>
            <div>Type</div>
            <div>Location</div>
            <div>Source</div>
            <div>Responder / Unit</div>
            <div>Status</div>
            <div>Actions</div>
          </div>

          {/* Rows */}
          {filtered.map((inc, idx) => {
            const src = SOURCE_STYLE[inc.source];
            return (
              <div
                key={inc.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '95px 85px 110px 1.4fr 100px 1.1fr 110px 60px',
                  gap: '12px',
                  padding: '14px 18px',
                  borderBottom:
                    idx === filtered.length - 1 ? 'none' : '1px solid #1E2A3D',
                  color: '#fff',
                  fontSize: '14px',
                  alignItems: 'center',
                  transition: 'background 0.2s',
                  position: 'relative',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#14243A')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ color: '#C5D0DE', fontSize: '13px' }}>{inc.displayDate}</div>
                <div style={{ color: '#8A9BB0', fontSize: '13px' }}>{inc.displayTime}</div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                  <span>{getTypeIcon(inc.type)}</span>
                  <span>{inc.type}</span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    color: '#C5D0DE',
                    overflow: 'hidden',
                  }}
                  title={inc.location}
                >
                  <span style={{ flexShrink: 0 }}>📍</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {inc.location}
                  </span>
                </div>

                <div>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '4px 10px',
                      borderRadius: '7px',
                      fontSize: '12px',
                      fontWeight: 700,
                      color: '#fff',
                      background: src.color,
                    }}
                  >
                    <span>{src.icon}</span>
                    {src.label}
                  </span>
                </div>

                <div style={{ color: '#C5D0DE', fontSize: '13px' }}>
                  {inc.responder || inc.dispatchedUnits || 'Not Assigned'}
                </div>

                <div>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '3px 10px',
                      borderRadius: '12px',
                      fontSize: '11px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.4px',
                      color: statusColor(inc.status),
                      background: `${statusColor(inc.status)}22`,
                      border: `1px solid ${statusColor(inc.status)}55`,
                    }}
                  >
                    {inc.status.replace('_', ' ')}
                  </span>
                </div>

                <div style={{ position: 'relative', textAlign: 'center' }}>
                  <button
                    onClick={() => setOpenMenuId(openMenuId === inc.id ? null : inc.id)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#8A9BB0',
                      fontSize: '18px',
                      cursor: 'pointer',
                      padding: '4px 8px',
                      borderRadius: '6px',
                      lineHeight: 1,
                    }}
                  >
                    ⋮
                  </button>
                  {openMenuId === inc.id && (
                    <div
                      style={{
                        position: 'absolute',
                        right: 0,
                        top: '28px',
                        background: '#182740',
                        border: '1px solid #2A3B52',
                        borderRadius: '8px',
                        minWidth: '140px',
                        zIndex: 10,
                        boxShadow: '0 8px 20px rgba(0,0,0,0.4)',
                        textAlign: 'left',
                      }}
                    >
                      <button
                        style={{
                          display: 'block',
                          width: '100%',
                          padding: '10px 14px',
                          background: 'transparent',
                          border: 'none',
                          color: '#fff',
                          fontSize: '13px',
                          textAlign: 'left',
                          cursor: 'pointer',
                        }}
                        onClick={() => setOpenMenuId(null)}
                      >
                        View details
                      </button>
                      <button
                        style={{
                          display: 'block',
                          width: '100%',
                          padding: '10px 14px',
                          background: 'transparent',
                          border: 'none',
                          color: '#fff',
                          fontSize: '13px',
                          textAlign: 'left',
                          cursor: 'pointer',
                        }}
                        onClick={() => setOpenMenuId(null)}
                      >
                        Export record
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default History;