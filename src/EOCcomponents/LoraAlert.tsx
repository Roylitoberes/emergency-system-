// web/src/EOCcomponents/LoraAlert.tsx
// MAIN DASHBOARD COMPONENT - Displays LoRa alerts from Firebase
// ✅ NEW: Plays sound + vibrates on new LoRa alert (stops after 20s)
// ✅ NEW: Alarm stops immediately when user clicks "Report"
// ✅ NEW: REMOVED toast pop-ups
// ✅ NEW: "Delete all" button with confirmation popup
// ✅ NEW: Per-card delete button with confirmation
// ✅ NEW: Date & time = real-time Philippine time at the moment the alert is received
// ✅ FIXED: Received time now comes from the FIRESTORE SERVER clock (serverTimestamp),
//           so a wrong PC / phone / web-server date can no longer produce a wrong date.
// ✅ NEW: Active-report guard (same as SmsIcon) — blocks opening another LoRa alert while
//         the current LoRa report has not been forwarded to Dispatch (warning modal → OK)
// ✅ FIXED (build): removed unused `lastClockSync` variable (TS6133 / noUnusedLocals)

import React, { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom"; // ✅ NEW
import "../css/lora.css";

import {
  collection,
  query,
  orderBy,
  doc,
  updateDoc,
  deleteDoc,
  limit,
  getDocs,
  getDoc, // ✅ FIXED: read back the server time
  addDoc,
  serverTimestamp, // ✅ FIXED: exact server time
  where // ✅ NEW
} from "firebase/firestore";

import { firestore } from "../firebase";
import { socket } from "../services/socketService";

// ===============================
// TYPES
// ===============================

interface Alert {
  id: string;
  deviceId: string;
  message: string;
  type: "danger" | "warning" | "info" | "success";
  incidentType: string;
  incidentCode: number;
  latitude: string;
  longitude: string;
  gpsLocked: boolean;
  rssi: number;
  snr: number;
  timestamp: string;
  read: boolean;
  source: string;
  firebaseId?: string;
}

interface LoraAlertProps {
  onNavigateToLoraDevice?: () => void;
}

// ===============================
// ✅ HELPER: Play notification sound (stops after 20 seconds)
// ===============================
let currentAudio: HTMLAudioElement | null = null;
let currentAudioTimeout: ReturnType<typeof setTimeout> | null = null;

const stopNotificationSound = () => {
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    } catch (e) {
      // ignore
    }
    currentAudio = null;
    console.log('🔇 LoRa sound stopped');
  }
  if (currentAudioTimeout) {
    clearTimeout(currentAudioTimeout);
    currentAudioTimeout = null;
  }
};

const playNotificationSound = () => {
  try {
    console.log('🔊 playNotificationSound (LoRa) called');

    // Stop any previous sound first (avoid overlap)
    stopNotificationSound();

    const audio = new Audio('/notification-sound.mp3');
    audio.volume = 0.5;
    audio.loop = true; // keep playing until we stop it
    currentAudio = audio;

    audio
      .play()
      .then(() => console.log('   ✅ audio playing (will stop after 20s)'))
      .catch((e) => console.log('   ❌ audio failed:', e?.message || e));

    // ✅ Automatically stop after 20 seconds
    currentAudioTimeout = setTimeout(() => {
      console.log('⏱️ 20 seconds elapsed — stopping LoRa sound');
      stopNotificationSound();
    }, 20000);
  } catch (error) {
    console.log('❌ Error playing LoRa sound:', error);
  }
};

// ===============================
// ✅ HELPER: Trigger vibration (Android only — silently no-ops on iOS/desktop)
// ===============================
const triggerVibration = () => {
  try {
    console.log('📳 triggerVibration (LoRa) called');
    const supported =
      typeof navigator !== 'undefined' && 'vibrate' in navigator;
    console.log('   navigator.vibrate exists?', supported);
    console.log('   document.hidden?', document.hidden);

    if (!supported) {
      console.log('   ❌ Vibration API not supported on this device/browser');
      return;
    }
    const ok = navigator.vibrate([200, 100, 200]);
    console.log('   vibrate() returned:', ok);
  } catch (error) {
    console.log('❌ Vibration error:', error);
  }
};

// ===============================
// ✅ HELPER: fire-and-forget delete (used by "Delete all" and per-card delete)
// ===============================
const deleteAlertDoc = (firebaseId: string) => {
  deleteDoc(doc(firestore, "lora_alerts", firebaseId)).catch((error) => {
    console.warn("Could not delete alert doc (offline?):", error?.message || error);
  });
};

// ===============================
// ✅ NEW: ACTIVE-REPORT GUARD HELPERS
// A LoRa report is "active" from the moment it is opened from this dropdown
// until it is forwarded to Dispatch from the LoRa Device page.
// ===============================
const LORA_ACTIVE_KEY = 'loraActiveReport';

interface ActiveLoraReport {
  deviceId: string;
  coordinates: string;
  type: string;
}

const alertToActiveReport = (a: {
  deviceId: string;
  latitude: string;
  longitude: string;
  incidentType: string;
}): ActiveLoraReport => ({
  deviceId: a.deviceId,
  coordinates: `${a.latitude}, ${a.longitude}`,
  type: a.incidentType,
});

// Compares coordinates numerically so "10.2216" and "10.221600" count as equal
const normalizeCoords = (c: string): string =>
  String(c)
    .split(',')
    .map((p) => {
      const n = parseFloat(p);
      return isNaN(n) ? p.trim() : n.toFixed(5);
    })
    .join(',');

const isSameReport = (a: ActiveLoraReport, b: ActiveLoraReport): boolean =>
  a.deviceId === b.deviceId &&
  a.type === b.type &&
  normalizeCoords(a.coordinates) === normalizeCoords(b.coordinates);

// Returns the opened LoRa report that has NOT been forwarded to Dispatch yet, or null.
const getActiveUnforwardedLoraReport = async (): Promise<ActiveLoraReport | null> => {
  try {
    const raw = localStorage.getItem(LORA_ACTIVE_KEY);
    if (!raw) return null;

    const active = JSON.parse(raw) as ActiveLoraReport;

    // 1) Already forwarded from the LoRa Device page (it saves this list on forward)
    try {
      const forwarded = JSON.parse(localStorage.getItem('forwardedIncidents') || '[]');
      if (
        Array.isArray(forwarded) &&
        forwarded.some(
          (f: any) =>
            f?.deviceId === active.deviceId &&
            normalizeCoords(f?.coordinates || '') === normalizeCoords(active.coordinates)
        )
      ) {
        localStorage.removeItem(LORA_ACTIVE_KEY);
        return null;
      }
    } catch {
      // ignore a corrupt list
    }

    // 2) Already forwarded / finished according to Firestore
    const snap = await getDocs(
      query(collection(firestore, 'lora_incidents'), where('deviceId', '==', active.deviceId))
    );
    const finished = snap.docs.some((d) => {
      const x: any = d.data();
      return (
        normalizeCoords(x.coordinates || '') === normalizeCoords(active.coordinates) &&
        ['forwarded', 'dispatched', 'resolved', 'rejected'].includes(x.status)
      );
    });
    if (finished) {
      localStorage.removeItem(LORA_ACTIVE_KEY);
      return null;
    }

    return active;
  } catch (error) {
    console.error('Error checking active LoRa report:', error);
    return null; // on error, never lock the EOC out
  }
};

// ===============================
// ✅ FIXED: TRUSTED CLOCK
// The PC / phone / web-server clock can be wrong. We keep an offset so that
// getNow() returns the REAL time. The offset comes from:
//   1) an online time service (timeapi.io) at startup, and
//   2) the Firestore server time, every time an alert is saved (most reliable).
// ===============================
let serverClockOffset = 0; // ms to ADD to Date.now() to get the real time

const syncClock = async (): Promise<void> => {
  try {
    const t0 = Date.now();
    const res = await fetch(
      'https://timeapi.io/api/time/current/zone?timeZone=Asia%2FManila',
      { cache: 'no-store' }
    );
    const t1 = Date.now();
    if (!res.ok) return;

    const json = await res.json();
    // dateTime is Philippine local time, e.g. "2026-11-17T01:47:11.1234567"
    const raw: string | undefined = json?.dateTime;
    if (!raw) return;

    const realMs = new Date(raw.slice(0, 19) + '+08:00').getTime();
    if (isNaN(realMs)) return;

    // Compensate for half of the network round-trip
    const mid = (t0 + t1) / 2;
    serverClockOffset = realMs - mid;
    console.log(`🕒 Clock synced. Device clock is off by ${Math.round(serverClockOffset / 1000)}s`);
  } catch (error) {
    console.log('🕒 Clock sync failed (will use Firestore time on save):', error);
  }
};

// Real current time (device clock corrected by the offset)
const getNow = (): Date => new Date(Date.now() + serverClockOffset);

// ===============================
// 🇵🇭 PHILIPPINE TIME HELPERS
// ===============================

/**
 * Returns the current time formatted as a Philippine-time string.
 * Output: "YYYY-MM-DD HH:mm:ss"
 * ✅ FIXED: uses getNow() (corrected clock) instead of new Date()
 */
const getPhilippineNow = (): string => {
  const now = getNow();

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23', // ✅ was hour12: false (could output "24" at midnight)
  }).formatToParts(now);

  const get = (t: string) => parts.find(p => p.type === t)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
};

/**
 * ✅ NEW: Converts a Date into the same "YYYY-MM-DD HH:mm:ss" Philippine-time
 * format used by getPhilippineNow(), so it is always parsed correctly.
 */
const toPhilippineStamp = (date: Date): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const get = (t: string) => parts.find(p => p.type === t)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
};

/**
 * Format any date/timestamp into Philippine time display string.
 * Example: "Sep 29, 2026, 03:45:12 PM"
 */
const formatPhilippineTime = (input?: string | Date | null): string => {
  if (!input) return getPhilippineNow();

  let date: Date;
  if (input instanceof Date) {
    date = input;
  } else {
    const str = String(input).trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str)) {
      date = new Date(str.replace(' ', 'T') + '+08:00');
    } else {
      date = new Date(str);
    }
  }

  if (isNaN(date.getTime())) return String(input);

  return date.toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
};

// ===============================
// COMPONENT
// ===============================

const LoraAlert: React.FC<LoraAlertProps> = ({ onNavigateToLoraDevice }) => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  // ✅ NEW: controls the "Are you sure you want to delete all?" popup
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  // ✅ NEW: warning shown when an active report hasn't been forwarded yet
  const [showActiveReportWarning, setShowActiveReportWarning] = useState(false);

  const processedAlertIds = useRef<Set<string>>(new Set());

  // =================================
  // ✅ FIXED: keep the clock synced
  // =================================
  useEffect(() => {
    syncClock();
    const interval = setInterval(syncClock, 10 * 60 * 1000); // every 10 minutes
    return () => clearInterval(interval);
  }, []);

  // =================================
  // ✅ AUDIO UNLOCK: browsers block audio until user interacts.
  // =================================
  useEffect(() => {
    const unlockAudio = () => {
      try {
        const audio = new Audio('/notification-sound.mp3');
        audio.volume = 0;
        audio
          .play()
          .then(() => {
            audio.pause();
            audio.currentTime = 0;
            console.log('🔓 Audio unlocked for future LoRa notifications');
          })
          .catch((err) => {
            console.log('Audio unlock failed:', err?.message || err);
          });
      } catch (err) {
        console.log('Audio unlock error:', err);
      }
      document.removeEventListener('click', unlockAudio);
      document.removeEventListener('keydown', unlockAudio);
      document.removeEventListener('touchstart', unlockAudio);
    };

    document.addEventListener('click', unlockAudio);
    document.addEventListener('keydown', unlockAudio);
    document.addEventListener('touchstart', unlockAudio);

    return () => {
      document.removeEventListener('click', unlockAudio);
      document.removeEventListener('keydown', unlockAudio);
      document.removeEventListener('touchstart', unlockAudio);
      // ✅ Stop any playing sound when component unmounts
      stopNotificationSound();
    };
  }, []);

  // =================================
  // PLAY ALERT TONE (existing beep — kept as-is)
  // =================================

  const playAlertTone = () => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.16, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.55);
    } catch {
      // Audio unavailable or blocked — non-critical, ignore.
    }
  };

  // =================================
  // HELPERS
  // =================================

  const getIncidentEmoji = (type: string) => {
    switch (type.toUpperCase()) {
      case "FIRE": return "🔥";
      case "MEDICAL": return "🏥";
      case "FLOOD": return "🌊";
      case "EARTHQUAKE": return "🌋";
      case "TYPHOON": return "🌀";
      case "ACCIDENT": return "🚗";
      default: return "🚨";
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "danger": return "fa-exclamation-circle";
      case "warning": return "fa-exclamation-triangle";
      case "success": return "fa-check-circle";
      default: return "fa-info-circle";
    }
  };

  const getBadgeColor = (type: string) => {
    switch (type) {
      case "danger": return "#dc3545";
      case "warning": return "#ffc107";
      case "success": return "#28a745";
      default: return "#17a2b8";
    }
  };

  const getSignalStrength = (rssi: number) => {
    if (rssi > -50) return { label: "Excellent", color: "#00cc00" };
    if (rssi > -65) return { label: "Good", color: "#8bc34a" };
    if (rssi > -80) return { label: "Fair", color: "#ffc107" };
    if (rssi > -100) return { label: "Poor", color: "#ff9800" };
    return { label: "Very Poor", color: "#dc3545" };
  };

  // =================================
  // ✅ CONVERT INCIDENT TO ALERT
  // ✅ CHANGED: always use the REAL-TIME Philippine date & time at the
  //    moment the dashboard receives the alert (not the sender's timestamp).
  // ✅ FIXED: this is only a provisional time shown instantly; it is replaced by
  //    the exact Firestore server time as soon as the alert is saved.
  // =================================

  const convertIncidentToAlert = (incident: any): Alert => {
    const alertId = String(incident.id) || `alert-${Date.now()}`;

    // ✅ Provisional received time (Philippine time, corrected clock)
    const timestamp = getPhilippineNow();

    return {
      id: alertId,
      deviceId: incident.device_id || "Unknown Device",
      message: `🚨 LoRa ${incident.incident_type || 'Emergency'} alert`,
      type: "danger",
      incidentType: incident.incident_type || "UNKNOWN",
      incidentCode: incident.incident_code || 0,
      latitude: String(incident.latitude) || "No GPS",
      longitude: String(incident.longitude) || "No GPS",
      gpsLocked: true,
      rssi: incident.rssi || 0,
      snr: incident.snr || 0,
      timestamp,
      read: false,
      source: "LoRa",
      firebaseId: undefined
    };
  };

  // =================================
  // MARK AS READ
  // =================================

  const markAsRead = async (id: string) => {
    try {
      console.log(`📖 Marking alert ${id} as read...`);

      const alert = alerts.find(a => a.id === id);
      if (!alert) {
        console.error(`❌ Alert ${id} not found in list`);
        return;
      }

      if (alert.firebaseId) {
        await updateDoc(
          doc(firestore, "lora_alerts", alert.firebaseId),
          { read: true }
        );
      }

      setAlerts((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, read: true } : a
        )
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));

      console.log(`✅ Alert ${id} marked as read`);
    } catch (error) {
      console.error("❌ Error marking alert as read:", error);
      setAlerts((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, read: true } : a
        )
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    }
  };

  const markAllAsRead = async () => {
    try {
      const unreadAlerts = alerts.filter((alert) => !alert.read);
      if (unreadAlerts.length === 0) {
        console.log("No unread alerts to mark");
        return;
      }

      console.log(`📖 Marking ${unreadAlerts.length} alerts as read...`);

      for (const alert of unreadAlerts) {
        if (alert.firebaseId) {
          try {
            await updateDoc(
              doc(firestore, "lora_alerts", alert.firebaseId),
              { read: true }
            );
          } catch (error) {
            console.error(`❌ Failed to update alert ${alert.id}:`, error);
          }
        }
      }

      setAlerts((prev) =>
        prev.map((alert) => ({ ...alert, read: true }))
      );
      setUnreadCount(0);
      console.log(`✅ Marked ${unreadAlerts.length} alerts as read`);
    } catch (error) {
      console.error("❌ Mark all error:", error);
      setAlerts((prev) =>
        prev.map((alert) => ({ ...alert, read: true }))
      );
      setUnreadCount(0);
    }
  };

  // =================================
  // ✅ NEW: DELETE ALL (runs only after the user confirms in the popup)
  // =================================
  const handleDeleteAll = () => {
    const toDelete = alerts
      .map((a) => a.firebaseId)
      .filter((id): id is string => Boolean(id));

    setAlerts([]);
    setUnreadCount(0);
    setShowDeleteAllConfirm(false);

    toDelete.forEach((id) => deleteAlertDoc(id));
  };

  // =================================
  // ✅ NEW: DELETE ONE CARD
  // =================================
  const handleDelete = (alert: Alert, event: React.MouseEvent) => {
    event.stopPropagation();

    if (!window.confirm("Are you sure you want to delete this alert?")) {
      return;
    }

    setAlerts((prev) => prev.filter((a) => a.id !== alert.id));

    if (!alert.read) {
      setUnreadCount((prev) => Math.max(0, prev - 1));
    }

    if (alert.firebaseId) {
      deleteAlertDoc(alert.firebaseId);
    }
  };

  // =================================
  // ✅ SAVE ALERT TO FIREBASE
  // ✅ FIXED: the received time is now written by the FIRESTORE SERVER
  //    (receivedAt: serverTimestamp()). After the save we read that exact time
  //    back, show it on the card, and store it as timestamp / philippineTime,
  //    so it is identical after a refresh.
  // =================================

  const saveAlertToFirebase = async (alert: Alert) => {
    try {
      console.log(`💾 Saving alert to Firebase: ${alert.id}`);
      const alertsRef = collection(firestore, "lora_alerts");

      const t0 = Date.now();
      const docRef = await addDoc(alertsRef, {
        deviceId: alert.deviceId,
        message: alert.message,
        type: alert.type,
        incidentType: alert.incidentType,
        incidentCode: alert.incidentCode,
        latitude: alert.latitude,
        longitude: alert.longitude,
        gpsLocked: alert.gpsLocked,
        rssi: alert.rssi,
        snr: alert.snr,
        timestamp: alert.timestamp,
        read: false,
        source: "LoRa",
        createdAt: getNow().toISOString(),
        philippineTime: alert.timestamp,
        receivedAt: serverTimestamp(), // ✅ FIXED: exact server time
      });
      const t1 = Date.now();

      console.log(`✅ Alert saved to Firebase with ID: ${docRef.id}`);

      let updatedAlert: Alert = { ...alert, firebaseId: docRef.id };

      // Show the firebaseId right away (so delete / mark-as-read work)
      setAlerts((prev) =>
        prev.map((a) =>
          a.id === alert.id ? updatedAlert : a
        )
      );

      // ✅ FIXED: read back the exact server time and use it everywhere
      try {
        const snap = await getDoc(docRef);
        const receivedAt: any = snap.data()?.receivedAt;

        if (receivedAt && typeof receivedAt.toDate === 'function') {
          const serverDate: Date = receivedAt.toDate();
          const exactStamp = toPhilippineStamp(serverDate);

          // Re-sync the clock from the Firestore server time
          serverClockOffset = serverDate.getTime() - (t0 + t1) / 2;

          // Save the exact time so it is the same after a refresh
          updateDoc(docRef, {
            timestamp: exactStamp,
            philippineTime: exactStamp,
          }).catch((e) =>
            console.warn('Could not store exact server time:', e?.message || e)
          );

          updatedAlert = { ...updatedAlert, timestamp: exactStamp };
          setAlerts((prev) =>
            prev.map((a) =>
              a.id === alert.id ? updatedAlert : a
            )
          );
          console.log(`🕒 Exact received time (server): ${exactStamp}`);
        }
      } catch (timeError) {
        console.warn('Could not read exact server time:', timeError);
      }

      return updatedAlert;
    } catch (error) {
      console.error("❌ Error saving alert to Firebase:", error);
      return null;
    }
  };

  // =================================
  // FETCH INITIAL ALERTS FROM FIREBASE
  // =================================

  const fetchInitialAlerts = useCallback(async () => {
    try {
      console.log("🔄 Fetching initial alerts from Firebase...");
      const q = query(
        collection(firestore, "lora_alerts"),
        orderBy("timestamp", "desc"),
        limit(50)
      );
      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        setAlerts([]);
        setUnreadCount(0);
        setLoading(false);
        return;
      }

      const firebaseAlerts: Alert[] = snapshot.docs.map((document) => {
        const data = document.data();

        let lat = "No GPS";
        let lon = "No GPS";

        if (data.latitude !== undefined && data.latitude !== null) {
          if (typeof data.latitude === 'number' && !isNaN(data.latitude)) {
            lat = data.latitude.toFixed(6);
          } else if (typeof data.latitude === 'string') {
            lat = data.latitude;
          }
        }

        if (data.longitude !== undefined && data.longitude !== null) {
          if (typeof data.longitude === 'number' && !isNaN(data.longitude)) {
            lon = data.longitude.toFixed(6);
          } else if (typeof data.longitude === 'string') {
            lon = data.longitude;
          }
        }

        let timestamp = "Waiting...";
        if (data.receivedAt && typeof data.receivedAt.toDate === 'function') {
          // ✅ FIXED: exact Firestore SERVER time of when the alert was received
          timestamp = toPhilippineStamp(data.receivedAt.toDate());
        } else if (data.philippineTime) {
          // Older alerts (saved before this fix)
          timestamp = data.philippineTime;
        } else if (data.createdAt) {
          const created =
            typeof data.createdAt === 'string'
              ? new Date(data.createdAt)
              : data.createdAt.toDate?.();
          if (created && !isNaN(created.getTime())) {
            timestamp = toPhilippineStamp(created);
          }
        }
        if (timestamp === "Waiting..." && data.timestamp) {
          if (typeof data.timestamp === 'string') {
            timestamp = data.timestamp;
          } else if (data.timestamp.toDate) {
            timestamp = toPhilippineStamp(data.timestamp.toDate());
          } else if (data.timestamp instanceof Date) {
            timestamp = toPhilippineStamp(data.timestamp);
          }
        }

        return {
          id: document.id,
          firebaseId: document.id,
          deviceId: data.deviceId || data.device_id || "Unknown Device",
          message: data.message || `🚨 LoRa ${data.incidentType || data.incident_type || 'Emergency'} alert`,
          type: (data.type || "danger") as "danger" | "warning" | "info" | "success",
          incidentType: data.incidentType || data.incident_type || "UNKNOWN",
          incidentCode: data.incidentCode || data.incident_code || 0,
          latitude: lat,
          longitude: lon,
          gpsLocked: data.gpsLocked || data.gps_locked || false,
          rssi: data.rssi || 0,
          snr: data.snr || 0,
          timestamp,
          read: data.read || false,
          source: data.source || "LoRa"
        };
      });

      setAlerts(firebaseAlerts);
      const unread = firebaseAlerts.filter((alert) => !alert.read).length;
      setUnreadCount(unread);
      setLoading(false);
      console.log(`✅ Loaded ${firebaseAlerts.length} alerts from Firebase, ${unread} unread`);
    } catch (error) {
      console.error("❌ Error fetching initial alerts:", error);
      setError("Failed to load alerts");
      setLoading(false);
    }
  }, []);

  // =================================
  // HANDLE REPORT CLICK - Navigate to Lora Device
  // =================================

  const handleReportClick = (alert: Alert) => {
    // ✅ Stop the alarm immediately
    stopNotificationSound();

    console.log(`📋 Reporting alert: ${alert.id}`);

    localStorage.removeItem('loraIncidentData');
    localStorage.removeItem('loraSelectedIncident');
    localStorage.removeItem('loraIncidentFormData');

    const incidentData = {
      id: Date.now(),
      deviceId: alert.deviceId,
      type: alert.incidentType,
      coordinates: `${alert.latitude}, ${alert.longitude}`,
      latitude: parseFloat(alert.latitude) || 0,
      longitude: parseFloat(alert.longitude) || 0,
      signal: getSignalStrength(alert.rssi).label,
      gpsStatus: alert.gpsLocked ? 'Locked' : 'Unlocked',
      snr: `${alert.snr} dB`,
      receivedAt: alert.timestamp,
      status: 'verified',
      incident_type: alert.incidentType,
      message: alert.message,
      rssi: alert.rssi,
      source: alert.source,
      timestamp: alert.timestamp
    };

    localStorage.setItem('loraIncidentData', JSON.stringify(incidentData));
    localStorage.setItem('loraSelectedIncident', JSON.stringify(incidentData));

    markAsRead(alert.id);
    setIsOpen(false);

    window.dispatchEvent(
      new CustomEvent('newLoraIncident', { detail: incidentData })
    );

    if (onNavigateToLoraDevice) {
      onNavigateToLoraDevice();
    } else {
      console.warn('⚠️ onNavigateToLoraDevice prop not provided');
    }

    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('newLoraIncident', { detail: incidentData })
      );
    }, 0);
  };

  // =================================
  // ✅ NEW: guard that runs BEFORE the existing handleReportClick.
  // Blocks opening a DIFFERENT LoRa alert while the current report is
  // not yet forwarded to Dispatch.
  // =================================
  const handleReportItemClick = async (alert: Alert) => {
    // Stop the alarm the INSTANT the alert is clicked
    stopNotificationSound();

    const active = await getActiveUnforwardedLoraReport();
    const clicked = alertToActiveReport(alert);

    // Block only when a DIFFERENT report is still waiting to be forwarded
    if (active && !isSameReport(active, clicked)) {
      stopNotificationSound();
      setIsOpen(false);
      setShowActiveReportWarning(true);
      return;
    }

    // Remember this report as the active one until it is forwarded
    try {
      localStorage.setItem(LORA_ACTIVE_KEY, JSON.stringify(clicked));
    } catch {
      // ignore storage errors
    }

    handleReportClick(alert);
  };

  // ✅ NEW: OK on the warning → go straight to the LoRa Device page
  const handleActiveWarningOk = () => {
    setShowActiveReportWarning(false);
    setIsOpen(false);
    if (onNavigateToLoraDevice) {
      onNavigateToLoraDevice();
    }
  };

  // =================================
  // RETRY CONNECTION
  // =================================

  const retryConnection = () => {
    setError(null);
    setLoading(true);
    processedAlertIds.current.clear();
    fetchInitialAlerts();
  };

  // =================================
  // TOGGLE DROPDOWN
  // =================================

  const toggleDropdown = () => {
    setIsOpen(!isOpen);
  };

  // =================================
  // WEBSOCKET LISTENER
  // =================================

  useEffect(() => {
    const handleNewAlert = async (incident: any) => {
      console.log('🔔 LoraAlert received new LoRa alert via WebSocket:', incident);

      const alert = convertIncidentToAlert(incident);

      if (processedAlertIds.current.has(alert.id)) {
        console.log(`⏳ Alert ${alert.id} already processed, skipping`);
        return;
      }

      processedAlertIds.current.add(alert.id);

      // ✅ Removed showToast(alert) so it doesn't pop up anymore
      playAlertTone();
      playNotificationSound();
      triggerVibration();

      if (Notification.permission === 'granted') {
        new Notification('📡 LoRa Emergency Alert!', {
          body: `${alert.message} - ${alert.deviceId}`,
          icon: '/logo.png'
        });
      }

      setIsAnimating(true);
      setTimeout(() => setIsAnimating(false), 1000);

      setAlerts((prev) => [alert, ...prev]);
      setUnreadCount((prev) => prev + 1);

      try {
        await saveAlertToFirebase(alert);
      } catch (error) {
        console.error('❌ Failed to save alert to Firebase:', error);
      }
    };

    const handleValidated = (data: any) => {
      console.log('✅ Incident validated:', data);
    };

    const handleDispatched = (data: any) => {
      console.log('🚒 Incident dispatched:', data);
    };

    socket.on('new_lora_alert', handleNewAlert);
    socket.on('incident_validated', handleValidated);
    socket.on('responder_dispatched', handleDispatched);

    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }

    fetchInitialAlerts();

    return () => {
      socket.off('new_lora_alert', handleNewAlert);
      socket.off('incident_validated', handleValidated);
      socket.off('responder_dispatched', handleDispatched);

      // ✅ Stop any playing sound when component unmounts
      stopNotificationSound();
    };
  }, [fetchInitialAlerts]);

  // =================================
  // RENDER
  // =================================

  return (
    <>
      {/* ✅ NotificationBox-style container */}
      <div className="notification-box-container">
        <div className="nav-item dropdown">
          <a
            href="#"
            className={`nav-link dropdown-toggle ${isAnimating ? 'alert-animate' : ''}`}
            onClick={(e) => {
              e.preventDefault();
              toggleDropdown();
            }}
            title="LoRa Alerts"
          >
            <i className="fa fa-satellite-dish"></i>
            {unreadCount > 0 && (
              <span className="badge pulse-badge">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </a>

          {isOpen && (
            <>
              <div
                className="dropdown-backdrop"
                onClick={() => setIsOpen(false)}
              ></div>

              <div className="notification-dropdown">
                {/* Header */}
                <div className="dropdown-header">
                  <h6>
                    <i className="fa fa-satellite-dish me-2"></i>
                    LoRa Alerts
                  </h6>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {unreadCount > 0 && (
                      <button
                        className="mark-all-read"
                        onClick={markAllAsRead}
                      >
                        Mark all as read
                      </button>
                    )}
                    {!loading && alerts.length > 0 && (
                      <button
                        className="lora-delete-all"
                        onClick={() => setShowDeleteAllConfirm(true)}
                      >
                        Delete all
                      </button>
                    )}
                    <button
                      className="lora-refresh-btn"
                      onClick={retryConnection}
                      title="Refresh"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#6C7293',
                        cursor: 'pointer',
                        fontSize: '14px',
                        padding: '4px 6px',
                        borderRadius: '6px',
                        transition: 'all 0.3s'
                      }}
                    >
                      <i className="fa fa-refresh"></i>
                    </button>
                  </div>
                </div>

                {/* Body */}
                <div className="notification-list">
                  {loading ? (
                    <div className="no-notifications">
                      <i className="fa fa-spinner fa-spin" style={{ color: '#EB1616' }}></i>
                      <p>Loading alerts...</p>
                    </div>
                  ) : error ? (
                    <div className="no-notifications">
                      <i className="fa fa-exclamation-triangle" style={{ color: '#dc3545' }}></i>
                      <p style={{ color: '#dc3545' }}>Error loading alerts</p>
                      <small style={{ color: '#6C7293', display: 'block', marginTop: '5px' }}>
                        {error}
                      </small>
                      <button
                        onClick={retryConnection}
                        style={{
                          marginTop: '10px',
                          padding: '8px 20px',
                          background: '#EB1616',
                          color: 'white',
                          border: 'none',
                          borderRadius: '5px',
                          cursor: 'pointer'
                        }}
                      >
                        Retry
                      </button>
                    </div>
                  ) : alerts.length === 0 ? (
                    <div className="no-notifications">
                      <i className="fa fa-check-circle" style={{ color: '#28a745' }}></i>
                      <p>No LoRa alerts received yet</p>
                      <small>Waiting for transmissions from ESP32 sender...</small>
                    </div>
                  ) : (
                    alerts.map((alert) => {
                      const signal = getSignalStrength(alert.rssi);
                      const emoji = getIncidentEmoji(alert.incidentType);
                      const exactPHTime = formatPhilippineTime(alert.timestamp);

                      return (
                        <div
                          key={alert.id}
                          className={`notification-item ${!alert.read ? 'unread' : ''} notification-critical`}
                          onClick={() => handleReportItemClick(alert)}
                        >
                          {!alert.read && (
                            <div className="unread-indicator">
                              <div className="unread-dot"></div>
                              <div className="unread-pulse"></div>
                            </div>
                          )}

                          {alert.read && (
                            <div className="read-indicator">
                              <i className="fa fa-check-circle"></i>
                            </div>
                          )}

                          <div
                            className="notification-icon"
                            style={{ background: `${getBadgeColor(alert.type)}15` }}
                          >
                            <i
                              className={`fa ${getIcon(alert.type)}`}
                              style={{ color: getBadgeColor(alert.type) }}
                            ></i>
                          </div>

                          <div className="notification-content">
                            <div className="notification-header">
                              <span className="notification-title">
                                {emoji} LoRa {alert.incidentType} Alert
                              </span>
                              <div className="notification-actions">
                                {!alert.read && (
                                  <span className="unread-badge">🔴 UNREAD</span>
                                )}
                                {alert.read && (
                                  <span className="read-badge">🟢 READ</span>
                                )}
                                <button
                                  className="lora-card-delete-btn"
                                  title="Delete alert"
                                  onClick={(e) => handleDelete(alert, e)}
                                >
                                  <i className="fa fa-trash"></i>
                                </button>
                              </div>
                            </div>

                            <p className="notification-message">
                              <strong>{alert.deviceId}</strong> reported a{' '}
                              <strong>{alert.incidentType}</strong> incident
                            </p>

                            <p className="notification-description">
                              {alert.message}
                            </p>

                            {/* Location */}
                            <div className="notification-casualties">
                              <span className="casualties-label">
                                <i className="fa fa-map-marker"></i> Location:
                              </span>
                              <span className="casualties-details">
                                {alert.latitude}, {alert.longitude}
                                {alert.gpsLocked && ' • 🛰️ GPS Locked'}
                              </span>
                            </div>

                            {/* Signal info */}
                            <div className="notification-casualties">
                              <span className="casualties-label">
                                <i className="fa fa-signal"></i> Signal:
                              </span>
                              <span className="casualties-details">
                                <span style={{ color: signal.color, fontWeight: 600 }}>
                                  {signal.label}
                                </span>
                                {' • '}RSSI: {alert.rssi} dBm{' • '}SNR: {alert.snr} dB
                              </span>
                            </div>

                            {/* Specific type line for consistency */}
                            <p className="notification-specific-type">
                              <i className="fa fa-tag"></i>{' '}
                              <span className="specific-type-label">Incident Code:</span>{' '}
                              <strong>{alert.incidentCode || 'N/A'}</strong>
                            </p>

                            {/* ✅ Real-time Philippine date & time row */}
                            <div className="notification-casualties">
                              <span className="casualties-label">
                                <i className="fa fa-clock-o"></i> Time (PHT):
                              </span>
                              <span className="casualties-details">
                                {exactPHTime}
                              </span>
                            </div>

                            <div className="notification-click-hint">
                              <i className="fa fa-arrow-right"></i> Click to view details
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Footer */}
                {alerts.length > 0 && (
                  <div className="dropdown-footer">
                    <a
                      href="#"
                      className="view-all"
                      onClick={(e) => {
                        e.preventDefault();
                        window.location.reload();
                      }}
                    >
                      Refresh Alerts ({alerts.length})
                    </a>
                  </div>
                )}

                {/* ✅ NEW: Delete-all confirmation popup */}
                {showDeleteAllConfirm && (
                  <div
                    className="lora-confirm-overlay"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="lora-confirm-box">
                      <i className="fa fa-trash lora-confirm-icon"></i>
                      <h6>Are you sure you want to delete all?</h6>
                      <p>This will permanently remove all LoRa alerts.</p>
                      <div className="lora-confirm-actions">
                        <button
                          className="lora-confirm-cancel"
                          onClick={() => setShowDeleteAllConfirm(false)}
                        >
                          Cancel
                        </button>
                        <button
                          className="lora-confirm-delete"
                          onClick={handleDeleteAll}
                        >
                          Yes, delete all
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ✅ NEW: Active-report warning modal (portal so it sits above everything) */}
      {showActiveReportWarning &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.55)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 100000,
            }}
          >
            <div
              role="alertdialog"
              aria-modal="true"
              aria-label="Active report warning"
              style={{
                background: '#ffffff',
                borderRadius: 12,
                padding: '24px 28px',
                maxWidth: 440,
                width: '90%',
                textAlign: 'center',
                boxShadow: '0 10px 40px rgba(0,0,0,0.35)',
              }}
            >
              <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
              <h3
                style={{
                  margin: '0 0 10px',
                  color: '#1F2937',
                  fontSize: '1.1rem',
                }}
              >
                Active Report in Progress
              </h3>
              <p
                style={{
                  margin: '0 0 20px',
                  color: '#4B5563',
                  fontSize: '0.95rem',
                  lineHeight: 1.5,
                }}
              >
                You have an active report in Incident Intake that has not yet
                been forwarded to Dispatch. Please forward the current report
                before opening a new report.
              </p>
              <button
                type="button"
                onClick={handleActiveWarningOk}
                autoFocus
                style={{
                  background: '#2563EB',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '10px 32px',
                  fontSize: '0.95rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                OK
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

export default LoraAlert;