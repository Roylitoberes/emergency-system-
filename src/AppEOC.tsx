// AppEOC.tsx - Dashboard Live Feed uses responder_notifications + responder_tracking.
// Clicking an incident in the Live Feed → map flies to pin AND opens the popup.
// When responder completes mission → Live Feed entry hidden AND
// the matching responder_notifications doc status is set to 'resolved' in Firestore.
//
// ✅ RESPONDER PIN PERSISTENCE — DEFINITIVE:
//    - A module-level store (`responderStore`) is the single source of truth.
//    - It writes to localStorage SYNCHRONOUSLY on every mutation.
//    - It NEVER removes a responder unless the Firestore doc explicitly
//      reports status === 'resolved' for that responder.
//    - The cache survives page reloads, browser restarts, tab close, logout,
//      and navigation to other EOC pages.
//    - Only the responder's own device can clear its pin, by going 'resolved'.
//
// ✅ SETTINGS DROPDOWN (top navbar, right side):
//    - <EOCSettings /> is defined in this file (see below).
//    - Title is "EOC Settings" (no header logo).
//    - Default view: profile card, Edit Profile, Logout.
//    - Clicking Edit Profile reveals the edit form AND the Change Password row.
//    - Shows the logged-in EOC account (email used in Manage Users) and
//      its profile from the Firestore `manage_users` document.
//    - Email AND contact number are masked (e.g. 0973•••••43).
//
// ✅ ABOUT NAGA READY (dropdown, not a modal):
//    - The info icon next to the gear toggles a dropdown under the icon.
//    - Closes on outside click, Esc, clicking the icon again, or opening Settings.
//
// ✅ FORGOT PASSWORD → "Send Request to Admin":
//    - Creates a 'pending' doc in `password_reset_requests`, which appears
//      in Manage Users › Password reset requests for the admin to act on.
//      (It also shows in the admin Dashboard under "New requests".)
//
// ✅ PASSWORD CHANGED → ADMIN DASHBOARD ANNOUNCEMENT:
//    - When the EOC successfully changes their password, an entry is written
//      to `activity_feed`, so it pops up in the admin Dashboard
//      under "All" and "Recent activity".
//
// ✅ ACTIVE INCIDENTS HEARTBEAT:
//    - The Active Incidents stat card gets the `has-active` class while
//      stats.activeIncidents > 0. The heartbeat animation lives in
//      css/EOCDashboard.css (see "ACTIVE INCIDENTS CARD" at the bottom).
//
// ✅ AVAILABLE UNITS (replaces "Personnel On Scene"):
//    - Uses the SAME rule as Dispatch Responders:
//        available = active responders in `manage_users` (userType !== 'eoc')
//                    minus busy responders.
//        busy = dispatched / enroute / on_scene on an incident that has
//               no final report yet.
//    - Listener 3 below keeps the count live via Firestore snapshots.

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  getFirestore,
  collection,
  onSnapshot,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import {
  onAuthStateChanged,
  updateProfile,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  type User,
} from 'firebase/auth';
import { auth } from './firebase';
import logo from './assets/logo (2).png';
import GoogleMap from './EOCcomponents/GoogleMap';
import MessageBox from './EOCcomponents/MessageBox';
import NotificationBox from './EOCcomponents/NotificationBox';
import DispatchResponder from './EOCcomponents/DispatchResponder';
import IncidentIntake from './EOCcomponents/IncidentIntake';
import LoraAlert from './EOCcomponents/LoraAlert';
import SmsIcon from './EOCcomponents/SmsIcon';
import LoraDevice from './EOCcomponents/LoraDevice';
import MonitorIncidentStatus from './EOCcomponents/MonitorIncidentStatus';
import './css/EOCDashboard.css';

// =====================================================
// ✅ PERSISTENT RESPONDER STORE (module-level, survives remounts)
// =====================================================
const RESPONDER_CACHE_KEY = 'eoc_responders_v3';

export interface ResponderLocation {
  lat: number;
  lng: number;
  status: string;
  responderName?: string;
  incidentId?: string;
  updatedAt?: number;
}

/** The in-memory cache. Initialized once per page-load from localStorage. */
const responderStore: {
  data: Record<string, ResponderLocation>;
  listeners: Set<(data: Record<string, ResponderLocation>) => void>;
} = {
  data: {},
  listeners: new Set(),
};

// Hydrate the store from localStorage ONCE at module load
(function hydrateResponderStore() {
  try {
    const raw = localStorage.getItem(RESPONDER_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        // Basic sanity check — must be an object of objects
        Object.entries(parsed).forEach(([id, loc]: [string, any]) => {
          if (
            loc &&
            typeof loc === 'object' &&
            typeof loc.lat === 'number' &&
            typeof loc.lng === 'number'
          ) {
            responderStore.data[id] = loc as ResponderLocation;
          }
        });
        console.log(
          `[ResponderStore] 💾 Hydrated ${Object.keys(responderStore.data).length} responders from localStorage`
        );
      }
    }
  } catch (e) {
    console.warn('[ResponderStore] Could not hydrate from localStorage:', e);
  }
})();

/** Persist the store to localStorage immediately. */
function persistResponderStore() {
  try {
    localStorage.setItem(RESPONDER_CACHE_KEY, JSON.stringify(responderStore.data));
  } catch (e) {
    console.warn('[ResponderStore] Could not persist to localStorage:', e);
  }
}

/** Notify all subscribers of the current store contents. */
function notifyResponderListeners() {
  const snapshot = { ...responderStore.data };
  responderStore.listeners.forEach((fn) => {
    try { fn(snapshot); } catch (e) { console.warn(e); }
  });
}

/**
 * Upsert a responder. NEVER removes existing entries — only updates them.
 * Persists to localStorage and notifies listeners.
 */
function upsertResponder(id: string, loc: ResponderLocation) {
  responderStore.data[id] = { ...loc, updatedAt: Date.now() };
  persistResponderStore();
  notifyResponderListeners();
}

/**
 * Remove a responder ONLY when the Firestore doc explicitly says 'resolved'.
 * This is the ONLY removal path.
 */
function removeResponder(id: string, reason: string) {
  if (responderStore.data[id]) {
    console.log(`[ResponderStore] 🧹 Removing ${id} — ${reason}`);
    delete responderStore.data[id];
    persistResponderStore();
    notifyResponderListeners();
  }
}

/** React hook to subscribe to the persistent store. */
function useResponderStore() {
  const [data, setData] = useState<Record<string, ResponderLocation>>(
    () => ({ ...responderStore.data })
  );

  useEffect(() => {
    const listener = (next: Record<string, ResponderLocation>) => {
      setData(next);
    };
    responderStore.listeners.add(listener);
    // Sync in case the store changed between the initial render and effect
    listener({ ...responderStore.data });
    return () => {
      responderStore.listeners.delete(listener);
    };
  }, []);

  return data;
}

// =====================================================
// ✅ EOC SETTINGS DROPDOWN (gear icon in the top navbar)
// =====================================================
interface EOCSettingsProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  /** Called after the person confirms "Yes, Logout" (no extra confirm needed). */
  onLogout: () => void | Promise<void>;
}

/* ============================================================
   PASSWORD RULES (12+ chars, upper, lower, number, special)
   ============================================================ */
const PASSWORD_MIN_LENGTH = 12;


const validateNewPassword = (pw: string): string => {
  if (pw.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (!/[A-Z]/.test(pw)) return 'Include at least one uppercase letter.';
  if (!/[a-z]/.test(pw)) return 'Include at least one lowercase letter.';
  if (!/[0-9]/.test(pw)) return 'Include at least one number.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Include at least one special character.';
  return '';
};

// admin@gmail.com → admi••••@gmail.com
const maskEmail = (value: string): string => {
  const at = value.indexOf('@');
  if (at <= 0) return value;
  const local = value.slice(0, at);
  const domain = value.slice(at);
  const visible = local.length > 4 ? local.slice(0, 4) : local.slice(0, 1);
  return `${visible}••••${domain}`;
};

// 09737473743 → 0973•••••43
const maskPhone = (phone: string): string => {
  if (!phone) return '';
  if (phone.length <= 6) return phone.charAt(0) + '•'.repeat(phone.length - 1);
  return `${phone.slice(0, 4)}${'•'.repeat(phone.length - 6)}${phone.slice(-2)}`;
};

// Posts an announcement to the admin Dashboard "Recent activity" feed
const logEocActivity = async (
  icon: string,
  tone: 'forest' | 'gold' | 'clay',
  title: string,
  meta: string
) => {
  try {
    const now = new Date().toISOString();
    await addDoc(collection(getFirestore(), 'activity_feed'), {
      type: 'activity',
      icon,
      tone,
      title,
      meta,
      time: now,
      createdAt: now,
      sourceKey: `eoc-account:${Date.now()}`,
    });
  } catch (err) {
    console.warn('Could not post dashboard announcement:', err);
  }
};

/* ============================================================
   PASSWORD INPUT WITH EYE
   ============================================================ */
interface PasswordFieldProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  onFocus?: () => void;
  onBlur?: () => void;
}

const PasswordField: React.FC<PasswordFieldProps> = ({ value, onChange, placeholder, autoComplete, onFocus, onBlur }) => {
  const [visible, setVisible] = useState(false);
  return (
    <div className="eocs-pw-wrap">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      <button
        type="button"
        className="eocs-eye"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        title={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
};

// Remembers which "reset link sent" notices the person already dismissed
const RESET_SEEN_KEY = 'eoc_reset_seen_v1';
const readSeenResets = (): string[] => {
  try { return JSON.parse(localStorage.getItem(RESET_SEEN_KEY) || '[]'); } catch { return []; }
};
const markResetSeen = (id: string) => {
  try {
    const seen = readSeenResets();
    if (!seen.includes(id)) localStorage.setItem(RESET_SEEN_KEY, JSON.stringify([...seen, id].slice(-50)));
  } catch {}
};

type Section = 'none' | 'password';

const EOCSettings: React.FC<EOCSettingsProps> = ({ isOpen, onToggle, onClose, onLogout }) => {
  const wrapRef = useRef<HTMLDivElement>(null);

  // --- logged-in account ---
  const [authUser, setAuthUser] = useState<User | null>(auth.currentUser);
  const [docCollection, setDocCollection] = useState<'manage_users' | 'users'>('manage_users');
  const [profile, setProfile] = useState({ name: '', phone: '', photo: '', role: 'EOC Personnel' });

  // --- UI state ---
  const [openSection, setOpenSection] = useState<Section>('none');
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [showAbout, setShowAbout] = useState(false);

  // --- edit profile ---
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [profileMsg, setProfileMsg] = useState<{ type: 'error' | 'success' | ''; text: string }>({ type: '', text: '' });

  // --- change password ---
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPwFocused, setNewPwFocused] = useState(false);
  const [confirmPw, setConfirmPw] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');

  // --- forgot password (request to admin) ---
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetSuccess, setResetSuccess] = useState('');
  // Shown when the admin has clicked "Send Reset Link" in Manage Users
  const [linkNotice, setLinkNotice] = useState<{ id: string; email: string } | null>(null);

  const email = authUser?.email || '';
  const maskedEmail = maskEmail(email);

  /* ---------- follow the logged-in user ---------- */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setAuthUser(u));
    return () => unsub();
  }, []);

  /* ---------- load profile of the logged-in EOC account ---------- */
  useEffect(() => {
    if (!authUser) return;
    let cancelled = false;

    const fallbackName = authUser.displayName || (authUser.email || 'EOC User').split('@')[0];

    (async () => {
      try {
        const db = getFirestore();
        let snap = await getDoc(doc(db, 'manage_users', authUser.uid));
        let col: 'manage_users' | 'users' = 'manage_users';
        if (!snap.exists()) {
          snap = await getDoc(doc(db, 'users', authUser.uid));
          col = 'users';
        }
        if (cancelled) return;

        const d: any = snap.exists() ? snap.data() : {};
        setDocCollection(snap.exists() ? col : 'manage_users');
        setProfile({
          name: d.name || d.fullName || fallbackName,
          phone: d.phone || '',
          photo: d.profile || authUser.photoURL || '',
          role: d.role || 'EOC Personnel',
        });
      } catch (err) {
        console.error('Error loading EOC profile:', err);
        if (cancelled) return;
        setProfile({
          name: fallbackName,
          phone: '',
          photo: authUser.photoURL || '',
          role: 'EOC Personnel',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authUser]);

  /* ---------- admin sent the reset link → pop up in Settings ---------- */
  useEffect(() => {
    if (!authUser) return;
    const q = query(
      collection(getFirestore(), 'password_reset_requests'),
      where('requesterUid', '==', authUser.uid)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const seen = readSeenResets();
        snap.docs.forEach((d) => {
          const data: any = d.data();
          if (data.status === 'link_sent' && !seen.includes(d.id)) {
            setLinkNotice({ id: d.id, email: data.email || authUser.email || '' });
          }
        });
      },
      (err) => console.error('Reset-link notice listener error:', err)
    );
    return () => unsub();
  }, [authUser]);

  /* ---------- open the Settings menu automatically when the notice arrives ---------- */
  useEffect(() => {
    if (!linkNotice) return;
    setResetSuccess('');   // replace "Request sent to admin..." with the new message
    if (!isOpen) onToggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkNotice]);

  const dismissLinkNotice = () => {
    if (linkNotice) markResetSeen(linkNotice.id);
    setLinkNotice(null);
  };

  /* ---------- reset everything when the menu closes ---------- */
  useEffect(() => {
    if (isOpen) return;
    setOpenSection('none');
    setIsEditing(false);
    setProfileMsg({ type: '', text: '' });
    setCurrentPw('');
    setNewPw('');
    setNewPwFocused(false);
    setConfirmPw('');
    setPwError('');
    setPwSuccess('');
    setResetEmail('');
    setResetError('');
    setResetSuccess('');
  }, [isOpen]);

  /* ---------- click outside closes the menu ---------- */
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, onClose]);

  /* ---------- Esc closes the About dropdown ---------- */
  useEffect(() => {
    if (!showAbout) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowAbout(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showAbout]);

  /* ---------- click outside closes the About dropdown ---------- */
  useEffect(() => {
    if (!showAbout) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setShowAbout(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAbout]);

  /* ---------- opening Settings closes About ---------- */
  useEffect(() => {
    if (isOpen) setShowAbout(false);
  }, [isOpen]);

  /* ---------- handlers ---------- */
  const toggleSection = (s: Section) => {
    setOpenSection((cur) => (cur === s ? 'none' : s));
  };

  const startEdit = () => {
    setEditName(profile.name);
    setEditPhone('');   // blank = keep the current number (it stays masked)
    setProfileMsg({ type: '', text: '' });
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setProfileMsg({ type: '', text: '' });
    setOpenSection('none');
  };

  const handleSaveProfile = async () => {
    if (!authUser) return;
    if (editPhone && !/^\d{11}$/.test(editPhone)) {
      setProfileMsg({ type: 'error', text: 'Contact number must be exactly 11 digits.' });
      return;
    }

    // Blank contact field = keep the current number
    const finalPhone = editPhone.trim() !== '' ? editPhone.trim() : profile.phone;

    setSaving(true);
    setProfileMsg({ type: '', text: '' });
    try {
      const photo = profile.photo;

      const name = editName.trim() || profile.name;

      await updateProfile(authUser, {
        displayName: name,
        photoURL: photo || undefined,
      });

      const payload: Record<string, any> = {
        name,
        phone: finalPhone,
        updatedAt: new Date().toISOString(),
      };
      if (photo) payload.profile = photo;

      await setDoc(doc(getFirestore(), docCollection, authUser.uid), payload, { merge: true });

      setProfile((p) => ({ ...p, name, phone: finalPhone, photo }));
      setIsEditing(false);
      setOpenSection('none');
      setProfileMsg({ type: 'success', text: 'Profile updated successfully.' });
      setTimeout(() => setProfileMsg({ type: '', text: '' }), 3000);
    } catch (err: any) {
      console.error('Error saving EOC profile:', err);
      setProfileMsg({ type: 'error', text: err?.message || 'Failed to update profile.' });
    } finally {
      setSaving(false);
    }
  };

  const handleUpdatePassword = async () => {
    if (!authUser || !authUser.email) return;
    setPwError('');
    setPwSuccess('');

    if (!currentPw) return setPwError('Please enter your current password.');
    const ruleError = validateNewPassword(newPw);
    if (ruleError) return setPwError(ruleError);
    if (newPw !== confirmPw) return setPwError('Passwords do not match.');
    if (newPw === currentPw) return setPwError('New password must be different.');

    setPwLoading(true);
    try {
      const credential = EmailAuthProvider.credential(authUser.email, currentPw);
      await reauthenticateWithCredential(authUser, credential);
      await updatePassword(authUser, newPw);

      // 📣 Announce on the admin Dashboard
      await logEocActivity(
        'lock',
        'forest',
        '🔒 EOC Password Changed',
        `${profile.name || 'An EOC user'} (EOC) changed their account password.`
      );

      setPwSuccess('Password updated successfully.');
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      setTimeout(() => {
        setPwSuccess('');
        setOpenSection('none');
      }, 1800);
    } catch (err: any) {
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setPwError('Current password is incorrect.');
      } else if (err.code === 'auth/too-many-requests') {
        setPwError('Too many attempts. Please try again later.');
      } else {
        setPwError(err.message || 'Failed to update password.');
      }
    } finally {
      setPwLoading(false);
    }
  };

  // ✅ Sends a request to the admin instead of emailing a reset link directly.
  //    Creates a 'pending' doc in `password_reset_requests`, which appears in
  //    Manage Users › "Password reset requests" with Send Reset Link / Dismiss.
  const handleSendResetLink = async () => {
    setResetError('');
    setResetSuccess('');
    const target = resetEmail.trim();
    if (!target) return setResetError('Please enter your registered email address.');

    setResetLoading(true);
    try {
      await addDoc(collection(getFirestore(), 'password_reset_requests'), {
        email: target,
        status: 'pending',
        requestedAt: serverTimestamp(),
        requestedBy: 'eoc-portal',
        userAgent: 'eoc-portal',
        requesterUid: authUser?.uid || '',
      });
      setResetSuccess(`Request sent to admin for ${target}. Please wait for the reset link in your email.`);
    } catch (err: any) {
      console.error('Failed to send reset request:', err);
      if (err.code === 'permission-denied') setResetError('Permission denied. Please contact the admin.');
      else setResetError('Failed to send request. Please try again.');
    } finally {
      setResetLoading(false);
    }
  };

  const openLogoutModal = () => {
    onClose();
    setShowLogoutModal(true);
  };

  const confirmLogout = async () => {
    setLoggingOut(true);
    try {
      await onLogout();
    } finally {
      setLoggingOut(false);
      setShowLogoutModal(false);
    }
  };

  const linkNoticeEl = linkNotice ? (
    <div className="eocs-success" style={{ margin: '0 4px 8px' }}>
      <strong>✅ The admin has sent your reset link.</strong>
      <div style={{ marginTop: 4 }}>
        Please check your inbox or spam folder at <strong>{linkNotice.email}</strong>.
      </div>
      <button
        type="button"
        className="eocs-btn eocs-btn-ghost"
        style={{ marginTop: 8 }}
        onClick={dismissLinkNotice}
      >
        Got it
      </button>
    </div>
  ) : null;

  return (
    <div className="eocs-wrap" ref={wrapRef}>
      {/* ---------- SETTINGS BUTTON ---------- */}
      <button
        type="button"
        className={`eocs-trigger ${isOpen ? 'open' : ''}`}
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="Settings"
        title="Settings"
      >
        <span className="eocs-gear">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
          </svg>
        </span>
      </button>

      {/* ---------- ABOUT PORTAL ICON (toggles the About dropdown) ---------- */}
      <button
        type="button"
        className={`eocs-about-btn ${showAbout ? 'open' : ''}`}
        onClick={() => {
          onClose();                       // close the Settings menu
          setShowAbout((v) => !v);         // toggle the About dropdown
        }}
        aria-haspopup="dialog"
        aria-expanded={showAbout}
        aria-label="About NAGA READY"
        title="About NAGA READY"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5" />
          <path d="M12 8h.01" />
        </svg>
      </button>

      {/* ---------- DROPDOWN ---------- */}
      {isOpen && (
        <div className="eocs-menu" role="menu">
          {/* header (no logo) */}
          <div className="eocs-head">
            <div>
              <div className="eocs-head-title">EOC Settings</div>
              <div className="eocs-head-sub">Manage your account information.</div>
            </div>
          </div>

          {linkNoticeEl}

          {profileMsg.text && (
            <div className={profileMsg.type === 'error' ? 'eocs-error' : 'eocs-success'} style={{ margin: '0 4px 8px' }}>
              {profileMsg.text}
            </div>
          )}

          {!isEditing ? (
            <>
              {/* profile card */}
              <div className="eocs-hero">
                <div className="eocs-avatar">
                  <img src={logo} alt="EOC" style={{ objectFit: 'contain', padding: 4 }} />
                </div>
                <div className="eocs-hero-text">
                  <div className="eocs-hero-name">{profile.name || 'EOC User'}</div>
                  <span className="eocs-badge">{profile.role}</span>
                </div>
              </div>

              {/* info rows */}
              <div className="eocs-info">
                <div className="eocs-info-row">
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v.5l8 5 8-5V6H4zm16 3-8 5-8-5v9h16V9z" /></svg>
                  <span className="eocs-info-label">Email Address</span>
                  <span className="eocs-info-value">{maskedEmail || 'Not available'}</span>
                </div>
                <div className="eocs-info-row">
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" /></svg>
                  <span className="eocs-info-label">Contact Number</span>
                  <span className="eocs-info-value">{profile.phone ? maskPhone(profile.phone) : 'Not set'}</span>
                </div>
              </div>

              <button type="button" className="eocs-edit-btn" onClick={startEdit}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
                Edit Profile
              </button>
            </>
          ) : openSection === 'password' ? null : (
            /* ---------- EDIT MODE (hidden while Change Password is open, so everything fits) ---------- */
            <div className="eocs-edit">
              <div className="eocs-field">
                <label>Full Name</label>
                <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Enter full name" />
              </div>

              <div className="eocs-field">
                <label>Email Address</label>
                <input type="text" value={maskedEmail} readOnly className="eocs-readonly" />
              </div>

              <div className="eocs-field">
                <label>Contact Number</label>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                  placeholder={profile.phone ? `${maskPhone(profile.phone)} (leave blank to keep)` : '09XXXXXXXXX'}
                />
              </div>

              <div className="eocs-actions">
                <button type="button" className="eocs-btn eocs-btn-ghost" onClick={cancelEdit} disabled={saving}>Cancel</button>
                <button type="button" className="eocs-btn eocs-btn-primary" onClick={handleSaveProfile} disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          )}

          {/* ---------- CHANGE PASSWORD (only visible in Edit Profile mode) ---------- */}
          {isEditing && (
            <>
              <button
                type="button"
                className={`eocs-row ${openSection === 'password' ? 'open' : ''}`}
                onClick={() => toggleSection('password')}
                aria-expanded={openSection === 'password'}
              >
                <span className="eocs-row-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="11" width="16" height="10" rx="2" />
                    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                  </svg>
                </span>
                <span className="eocs-row-label">Change Password</span>
                <svg className="eocs-row-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </button>

              {openSection === 'password' && (
                <div className="eocs-panel">
                  {/* 1. change */}
                  <div className="eocs-panel-title">1. Change Password</div>
                  <div className="eocs-card">
                    <label>Current Password</label>
                    <PasswordField value={currentPw} onChange={setCurrentPw} placeholder="Enter your current password" autoComplete="current-password" />

                    <label>New Password</label>
                    <PasswordField
                      value={newPw}
                      onChange={setNewPw}
                      placeholder="Enter your new password"
                      autoComplete="new-password"
                      onFocus={() => setNewPwFocused(true)}
                      onBlur={() => setNewPwFocused(false)}
                    />
                    {newPwFocused && (
                      <div className="eocs-pw-hint">12+ characters with uppercase, lowercase, number, and symbol.</div>
                    )}

                    <label>Confirm New Password</label>
                    <PasswordField value={confirmPw} onChange={setConfirmPw} placeholder="Re-enter your new password" autoComplete="new-password" />
                    {confirmPw && newPw !== confirmPw && <div className="eocs-error">Passwords do not match.</div>}

                    {pwError && <div className="eocs-error">{pwError}</div>}
                    {pwSuccess && <div className="eocs-success">{pwSuccess}</div>}

                    <button type="button" className="eocs-btn eocs-btn-primary eocs-full" onClick={handleUpdatePassword} disabled={pwLoading}>
                      {pwLoading ? 'Updating...' : 'Update Password'}
                    </button>
                  </div>

                  {/* 2. forgot */}
                  <div className="eocs-panel-title">2. Forgot Password</div>
                  <div className="eocs-card">
                    <label>Registered Email Address</label>
                    <input
                      className="eocs-plain-input"
                      type="text"
                      inputMode="email"
                      name="eoc-reset-request-email"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      placeholder="Enter your email"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      data-lpignore="true"
                      data-1p-ignore="true"
                      readOnly
                      onFocus={(e) => e.currentTarget.removeAttribute('readonly')}
                    />

                    {resetError && <div className="eocs-error">{resetError}</div>}
                    {resetSuccess && !linkNotice && <div className="eocs-success">{resetSuccess}</div>}

                    <button type="button" className="eocs-btn eocs-btn-primary eocs-full" onClick={handleSendResetLink} disabled={resetLoading}>
                      {resetLoading ? 'Sending...' : 'Send Request to Admin'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ---------- LOGOUT ---------- */}
          <button type="button" className="eocs-row eocs-row-logout" onClick={openLogoutModal}>
            <span className="eocs-row-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="m16 17 5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
            </span>
            <span className="eocs-row-label">Logout</span>
          </button>
        </div>
      )}

      {/* ---------- ABOUT NAGA READY (dropdown) ---------- */}
      {showAbout && (
        <div className="eocs-about-menu" role="dialog" aria-label="About NAGA READY">
          <div className="eocs-aboutm-head">
            <img src={logo} alt="NAGA READY" className="eocs-aboutm-logo" />
            <div className="eocs-aboutm-headtext">
              <div className="eocs-aboutm-title">About NAGA READY</div>
            </div>
          </div>

          <div className="eocs-aboutm-body">
            <p>
              <strong>NAGA READY</strong> is an Emergency Response Management System designed for the City of Naga
              CDRRMO to improve emergency coordination, incident management, and responder monitoring.
            </p>

            <h4>Key Features</h4>
            <ol className="eocs-aboutm-features">
              <li>
                <strong>Dashboard</strong>
                <span>View incidents, dispatch activities, and ambulance operations.</span>
              </li>
              <li>
                <strong>Incident Intake</strong>
                <span>Receive and verify emergency reports.</span>
              </li>
              <li>
                <strong>Dispatch Responders</strong>
                <span>Assign and deploy emergency response units.</span>
              </li>
              <li>
                <strong>Monitor Status</strong>
                <span>Track incident progress and responder locations.</span>
              </li>
              <li>
                <strong>LoRa Incident Intake</strong>
                <span>Receive and verify LoRa-based emergency alerts.</span>
              </li>
            </ol>

            <div className="eocs-aboutm-info" style={{ marginTop: 12 }}>
              <div className="eocs-aboutm-row"><span>Developed for</span><strong>City of Naga CDRRMO</strong></div>
              <div className="eocs-aboutm-row"><span>Version</span><strong>1.0.0</strong></div>
            </div>

            <div className="eocs-aboutm-foot">© 2026 NAGA READY. All Rights Reserved.</div>
          </div>
        </div>
      )}

      {/* ---------- LOGOUT CONFIRM (portal: escapes the navbar's blur) ---------- */}
      {showLogoutModal &&
        createPortal(
          <div className="eocs-modal-overlay" onClick={() => !loggingOut && setShowLogoutModal(false)}>
            <div className="eocs-modal" onClick={(e) => e.stopPropagation()}>
              <div className="eocs-modal-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <div className="eocs-modal-title">Confirm Logout</div>
              <p className="eocs-modal-text">Are you sure you want to logout?</p>
              <p className="eocs-modal-sub">You will be redirected to the login page.</p>
              <div className="eocs-modal-actions">
                <button type="button" className="eocs-modal-cancel" onClick={() => setShowLogoutModal(false)} disabled={loggingOut}>
                  Cancel
                </button>
                <button type="button" className="eocs-modal-logout" onClick={confirmLogout} disabled={loggingOut}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <path d="m16 17 5-5-5-5" />
                    <path d="M21 12H9" />
                  </svg>
                  {loggingOut ? 'Logging out...' : 'Yes, Logout'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};


// =====================================================
// OTHER TYPES
// =====================================================
interface LiveIncident {
  id: string;
  incidentId?: string;
  time: string;
  title: string;
  location: string;
  severity?: 'HIGH' | 'MEDIUM' | 'LOW';
  dispatched?: boolean;
  lat?: number;
  lng?: number;
  description?: string;
  dispatchedUnits?: string;
  dispatchTime?: string;
  type?: string;
  status?: string;
  _source?: 'notification' | 'tracking';
  _trackingId?: string;
  isBackup?: boolean;        // ✅ NEW
  responderUid?: string;     // ✅ NEW
}

// ✅ personnelOnScene → availableUnits
interface DashboardStats {
  activeIncidents: number;
  respondersDeployed: number;
  availableUnits: number;
}

interface AppEOCProps {
  onLogout?: () => void | Promise<void>;
}

const normalizeStatus = (raw?: string): string => {
  const s = (raw || '').toLowerCase().trim().replace(/[\s-]/g, '_');
  if (s === 'enroute' || s === 'en_route') return 'enroute';
  if (s === 'onscene' || s === 'on_scene') return 'on_scene';
  if (s === 'dispatched') return 'dispatched';
  if (s === 'backup') return 'backup';
  if (s === 'resolved' || s === 'completed') return 'resolved';
  return s;
};

const isActiveStatus = (raw?: string): boolean => {
  const s = normalizeStatus(raw);
  return s === 'dispatched' || s === 'enroute' || s === 'on_scene' || s === 'backup';
};

const AppEOC: React.FC<AppEOCProps> = ({ onLogout }) => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [activePage, setActivePage] = useState('dashboard');
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const [focusIncidentId] = useState<string | null>(null);
  const [focusNonce] = useState(0);

  const [monitorHighlightId, setMonitorHighlightId] = useState<string | null>(null);

  const [notificationDocs, setNotificationDocs] = useState<LiveIncident[]>([]);
  const [trackingDocs, setTrackingDocs] = useState<LiveIncident[]>([]);

  const [completedIncidentIds, setCompletedIncidentIds] = useState<Set<string>>(new Set());

  const updatedNotificationIdsRef = useRef<Set<string>>(new Set());
  const notificationDocIdMapRef = useRef<Map<string, string[]>>(new Map());

  const [stats, setStats] = useState<DashboardStats>({
    activeIncidents: 0,
    respondersDeployed: 0,
    availableUnits: 0,
  });

  // ✅ Map type state
  const [mapType, setMapType] = useState<'street' | 'satellite'>('street');

  // ✅ Subscribes to the module-level persistent store.
  const responderLocations = useResponderStore();

  // =====================================================
  // LISTENER 1 — responder_notifications
  // =====================================================
  useEffect(() => {
    const db = getFirestore();
    const notifRef = collection(db, 'responder_notifications');

    const unsub = onSnapshot(
      notifRef,
      (snapshot) => {
        const list: LiveIncident[] = [];
        const newDocIdMap = new Map<string, string[]>();

        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data();

          let displayTime = '--:--';
          const rawTime = data.dispatchedAt || data.createdAt || data.timestamp;
          if (rawTime) {
            try {
              const date = rawTime?.toDate ? rawTime.toDate() : new Date(rawTime);
              if (!isNaN(date.getTime())) {
                displayTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              }
            } catch {}
          }

          const incidentId = data.incidentId || data.incident_id || docSnap.id;

          if (incidentId) {
            const existing = newDocIdMap.get(incidentId) || [];
            existing.push(docSnap.id);
            newDocIdMap.set(incidentId, existing);
          }

          list.push({
            id: docSnap.id,
            incidentId,
            time: displayTime,
            title: data.type || data.incidentType || 'Emergency Response',
            location: data.location || data.address || 'Unknown location',
            dispatched: true,
            lat: data.lat || data.latitude || 0,
            lng: data.lng || data.longitude || 0,
            description: data.description || '',
            dispatchedUnits: data.unitName || data.dispatchedUnits || '',
            dispatchTime: data.dispatchedAt || data.createdAt || new Date().toISOString(),
            type: data.type || data.incidentType || 'Emergency',
            severity: data.severity || 'HIGH',
            status: data.status || 'dispatched',
            isBackup: data.isBackup === true,
            responderUid: data.responderUid || data.userId || '',
            _source: 'notification',
          } as LiveIncident);
        });

        notificationDocIdMapRef.current = newDocIdMap;
        setNotificationDocs(list);
      },
      (error) => console.error('❌ responder_notifications error:', error)
    );

    return () => unsub();
  }, []);

  // =====================================================
  // LISTENER 2 — responder_tracking
  // Uses upsertResponder / removeResponder on the persistent store.
  // =====================================================
  useEffect(() => {
    const db = getFirestore();
    const trackingRef = collection(db, 'responder_tracking');

    const unsub = onSnapshot(
      trackingRef,
      (snap) => {
        const list: LiveIncident[] = [];
        const completedIds = new Set<string>();
        const seenIds = new Set<string>();

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

          const status = normalizeStatus(data.status);

          // ---- RESOLVED: the ONLY path that removes a pin ----
          if (status === 'resolved') {
            completedIds.add(incidentId);
            seenIds.add(docSnap.id);
            removeResponder(docSnap.id, `responder_tracking/${docSnap.id} → resolved`);

            if (!updatedNotificationIdsRef.current.has(incidentId)) {
              updatedNotificationIdsRef.current.add(incidentId);

              const notifDocIds = notificationDocIdMapRef.current.get(incidentId) || [];
              if (notifDocIds.length > 0) {
                (async () => {
                  try {
                    await Promise.all(
                      notifDocIds.map((docId) =>
                        updateDoc(doc(db, 'responder_notifications', docId), {
                          status: 'resolved',
                          resolvedAt: serverTimestamp(),
                          updatedAt: serverTimestamp(),
                        })
                      )
                    );
                  } catch (err) {
                    console.error('❌ Failed to mark notification resolved:', err);
                  }
                })();
              }
            }
            return;
          }

          // ---- ACTIVE: upsert into the persistent store ----
          if (
            status === 'enroute' ||
            status === 'on_scene' ||
            status === 'backup' ||
            status === 'dispatched'
          ) {
            seenIds.add(docSnap.id);
            upsertResponder(docSnap.id, {
              lat,
              lng,
              status,
              responderName: data.responderName || data.name || 'Responder',
              incidentId,
            });
          }

          let displayTime = '--:--';
          const rawTime = data.acceptedAt || data.updatedAt || data.createdAt;
          if (rawTime) {
            try {
              const date = rawTime?.toDate ? rawTime.toDate() : new Date(rawTime);
              if (!isNaN(date.getTime())) {
                displayTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              }
            } catch {}
          }

          if (
            status === 'enroute' ||
            status === 'on_scene' ||
            status === 'backup' ||
            status === 'dispatched'
          ) {
            list.push({
              id: docSnap.id,
              incidentId,
              time: displayTime,
              title: data.type || data.incidentType || 'Emergency Response',
              location: data.location || data.address || 'Unknown location',
              dispatched: true,
              lat, lng,
              description: data.description || '',
              dispatchedUnits: data.dispatchedUnits || data.units || '',
              dispatchTime: data.acceptedAt || data.updatedAt || new Date().toISOString(),
              type: data.type || data.incidentType || 'Emergency',
              severity: data.severity || 'HIGH',
              status,
              _source: 'tracking',
              _trackingId: docSnap.id,
            });
          }
        });

        // ✅ IMPORTANT: Do NOT remove responders that are simply missing
        //    from this snapshot. Firestore snapshots may omit docs briefly
        //    during reconnects, and we want the pin to persist regardless.
        //    Only 'resolved' removes pins (handled above).

        console.log(
          `[AppEOC] 📡 Snapshot: active=${seenIds.size}, resolved=${completedIds.size}, store=${Object.keys(responderStore.data).length}`
        );

        setTrackingDocs(list);
        setCompletedIncidentIds(completedIds);
      },
      (err) => console.error('❌ responder_tracking error:', err)
    );

    return () => unsub();
  }, []);

  // =====================================================
  // LISTENER 3 — AVAILABLE UNITS (same rule as Dispatch Responders)
  // available = active responders in manage_users − busy responders
  // busy = dispatched / enroute / on_scene with no final report yet
  // =====================================================
  useEffect(() => {
    const db = getFirestore();

    let responderIds: string[] = [];
    let notifs: any[] = [];
    let tracking: Array<{ id: string; data: any }> = [];
    const finished = new Set<string>();

    const recompute = () => {
      const busy = new Set<string>();

      notifs.forEach((d) => {
        const s = normalizeStatus(d.status);
        if (s !== 'dispatched' && s !== 'enroute' && s !== 'on_scene') return;
        const uid = d.userId || d.responderUid;
        const incId = d.incidentId ? String(d.incidentId) : '';
        if (uid && !finished.has(incId)) busy.add(uid);
      });

      tracking.forEach(({ id, data }) => {
        const s = normalizeStatus(data.status);
        if (s !== 'enroute' && s !== 'on_scene') return;
        const uid = data.responderId;
        const incId = String(data.incidentId || id);
        if (uid && !finished.has(incId)) busy.add(uid);
      });

      const available = responderIds.filter((id) => !busy.has(id)).length;
      setStats((prev) =>
        prev.availableUnits === available ? prev : { ...prev, availableUnits: available }
      );
    };

    const unsubs = [
      onSnapshot(
        collection(db, 'manage_users'),
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

      onSnapshot(
        collection(db, 'responder_notifications'),
        (snap) => {
          notifs = snap.docs.map((d) => d.data());
          recompute();
        },
        (e) => console.error('❌ notifications (available units) error:', e)
      ),

      onSnapshot(
        collection(db, 'responder_tracking'),
        (snap) => {
          tracking = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
          recompute();
        },
        (e) => console.error('❌ tracking (available units) error:', e)
      ),

      onSnapshot(
        collection(db, 'final_reports'),
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

  // =====================================================
  // MERGE LIVE FEED → DERIVE STATS ONLY
  // (The Live Feed list itself is no longer rendered in the JSX,
  //  so we only compute stats here. No setLiveIncidents state needed.)
  // availableUnits is NOT touched here — Listener 3 owns it.
  // =====================================================
  useEffect(() => {
    const trackedIncidentIds = new Set<string>();
    trackingDocs.forEach((t) => {
      const key = t.incidentId || t.id;
      if (!key) return;
      if (t.title === 'Emergency Response' || t.location === 'Unknown location') return;
      if (isActiveStatus(t.status)) trackedIncidentIds.add(key);
    });

    const merged = new Map<string, LiveIncident>();

    trackingDocs.forEach((t) => {
      const key = t.incidentId || t.id;
      if (!key) return;
      if (t.title === 'Emergency Response' || t.location === 'Unknown location') return;
      if (!isActiveStatus(t.status)) return;
      if (completedIncidentIds.has(key)) return;
      merged.set(key, t);
    });

    notificationDocs.forEach((n) => {
      const key = n.incidentId || n.id;
      if (!key) return;
      if (n.title === 'Emergency Response' || n.location === 'Unknown location') return;
      if (completedIncidentIds.has(key)) return;
      if (trackedIncidentIds.has(key) || merged.has(key)) return;
      if (!isActiveStatus(n.status)) return;
      merged.set(key, n);
    });

    const toMillis = (val: any): number => {
      if (!val) return 0;
      if (typeof val?.toDate === 'function') return val.toDate().getTime();
      if (typeof val?.seconds === 'number') return val.seconds * 1000;
      const d = new Date(val);
      return isNaN(d.getTime()) ? 0 : d.getTime();
    };

    let list = Array.from(merged.values());

    const locationMap = new Map<string, LiveIncident>();
    list.forEach((incident) => {
      const key = `${incident.title}_${incident.location}`;
      const existing = locationMap.get(key);
      if (existing) {
        if (toMillis(incident.dispatchTime) > toMillis(existing.dispatchTime)) {
          locationMap.set(key, incident);
        }
      } else {
        locationMap.set(key, incident);
      }
    });

    list = Array.from(locationMap.values());
    list.sort((a, b) => toMillis(b.dispatchTime) - toMillis(a.dispatchTime));

    // ✅ Count every distinct responder on an active incident (original + backup)
    const activeKeys = new Set(list.map((i) => i.incidentId || i.id));
    const uniqueResponders = new Set<string>();
    notificationDocs.forEach((n) => {
      const key = n.incidentId || n.id;
      if (!activeKeys.has(key)) return;
      if (!isActiveStatus(n.status)) return;
      uniqueResponders.add(n.responderUid || n.id);
    });

    const baseDeployed = list.reduce(
      (sum, i) => sum + (i.dispatchedUnits ? i.dispatchedUnits.split(',').length : 4),
      0
    );

    setStats((prev) => ({
      ...prev,
      activeIncidents: list.length,
      respondersDeployed: Math.max(baseDeployed, uniqueResponders.size),
    }));
  }, [notificationDocs, trackingDocs, completedIncidentIds]);

  useEffect(() => {
    localStorage.setItem('dashboardStats', JSON.stringify(stats));
  }, [stats]);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1000);
    return () => clearTimeout(timer);
  }, []);

  // =====================================================
  // HANDLERS
  // =====================================================

  // Runs the actual logout (no confirm). Used by the Settings dropdown,
  // which shows its own navy "Confirm Logout" popup first.
  const performLogout = async () => {
    const sidebar = document.querySelector('.eoc-sidebar');
    const body = document.body;
    sidebar?.classList.add('logging-out');
    body?.classList.add('logging-out');

    try {
      sessionStorage.removeItem('selectedIncidentForMap');
      // ✅ DO NOT clear the responder store on logout.
      //    Pins must persist until each responder is resolved.

      if (onLogout) {
        await onLogout();
      } else {
        window.location.href = '/';
      }
    } catch (error) {
      console.error('❌ Logout error:', error);
      alert('Error logging out. Please try again.');
      sidebar?.classList.remove('logging-out');
      body?.classList.remove('logging-out');
    }
  };

  // Sidebar logout keeps the browser confirm popup
  const handleLogout = async () => {
    const confirmed = window.confirm('Are you sure you want to logout from EOC Dashboard?');
    if (!confirmed) return;
    await performLogout();
  };

  const handleSmsIconClick = () => console.log('SMS icon clicked');
  const handleForwardToDispatch = () => setActivePage('dispatchResponders');

  const handleOpenIncidentFromMessage = (incidentId: string) => {
    setMonitorHighlightId(incidentId);
    setOpenDropdown(null);
    setActivePage('monitorIncident');
    setTimeout(() => {
      setMonitorHighlightId((prev) => (prev === incidentId ? null : prev));
    }, 8000);
  };

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);

  // ✅ UPDATED: Also dispatches an event so IncidentIntake re-reads SMS data
  //    even when the user is ALREADY on the Incident Intake page.
  const handleNavigateToIncidentIntake = () => {
    setActivePage('incidentIntake');
    // Give React a tick to mount/switch pages, then notify IncidentIntake
    // to re-read sessionStorage (SMS data) — it already listens for this event.
    setTimeout(() => {
      window.dispatchEvent(new Event('newIncidentNotification'));
    }, 0);
  };

  const handleSidebarNavigation = (page: string) => setActivePage(page);

  const toggleDropdown = (dropdownName: string) => {
    setOpenDropdown(openDropdown === dropdownName ? null : dropdownName);
  };

  const handleDispatchComplete = () => setActivePage('dashboard');
  const handleNavigateToDashboard = () => setActivePage('dashboard');

  if (loading) {
    return (
      <div className="fullscreen-spinner">
        <div className="spinner-border text-primary" style={{ width: '3rem', height: '3rem' }} role="status">
          <span className="visually-hidden">Loading map...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="eoc-fullscreen-container">
      {/* SIDEBAR */}
      <div className={`eoc-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <a href="#" className="sidebar-brand">
            <h3 className="text-primary"><img src={logo} alt="EOC" style={{ height: 24, width: 24, objectFit: 'contain', marginRight: 8 }} />EOC</h3>
          </a>
          <button className="sidebar-toggler" onClick={toggleSidebar}><i className="fa fa-bars"></i></button>
        </div>
        <div className="user-info position-relative">
          <div className="position-relative">
            <img src="https://randomuser.me/api/portraits/men/1.jpg" alt="User" />
            <div className="online-status"></div>
          </div>
          <div className="ms-3">
            <h6 className="mb-0 text-white">John Doe</h6>
            <span className="text-light small">EOC Commander</span>
          </div>
        </div>
        <div className="sidebar-nav">
          <div className="nav-section-label">Overview</div>
          <a href="#" className={`nav-link ${activePage === 'dashboard' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); handleSidebarNavigation('dashboard'); }}><i className="fa fa-home"></i>Dashboard</a>
          <a href="#" className={`nav-link ${activePage === 'incidentIntake' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); handleSidebarNavigation('incidentIntake'); }}><i className="fa fa-clipboard-list"></i>Incident Intake</a>
          <a href="#" className={`nav-link ${activePage === 'dispatchResponders' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); handleSidebarNavigation('dispatchResponders'); }}><i className="fa fa-ambulance"></i>Dispatch Responders</a>
          <a href="#" className={`nav-link ${activePage === 'monitorIncident' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); handleSidebarNavigation('monitorIncident'); }}><i className="fa fa-chart-line"></i>Monitor Incidents</a>
          <div className="nav-section-label with-divider">Operations</div>
          <a href="#" className={`nav-link ${activePage === 'loraDevice' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); handleSidebarNavigation('loraDevice'); }}><i className="fa fa-wifi"></i>LoRa Devices</a>
          <div className="sidebar-logout">
            <a href="#" className="nav-link logout-link" onClick={(e) => { e.preventDefault(); handleLogout(); }}><i className="fa fa-sign-out-alt"></i>Logout</a>
          </div>
        </div>
      </div>

      {!sidebarOpen && (
        <button className="sidebar-toggler-floating" onClick={toggleSidebar}><i className="fa fa-bars"></i></button>
      )}

      <div className={`eoc-top-navbar ${sidebarOpen ? '' : 'sidebar-closed'}`}>
        <div className="navbar-actions">
          <div className="nav-item"><LoraAlert onNavigateToLoraDevice={() => setActivePage('loraDevice')} /></div>
          <div className="nav-divider"></div>
          <div className="nav-item"><SmsIcon onClick={handleSmsIconClick} onNavigateToIncidentIntake={handleNavigateToIncidentIntake} /></div>
          <div className="nav-divider"></div>
          <div className="nav-item">
            <MessageBox
              isOpen={openDropdown === 'message'}
              onToggle={() => toggleDropdown('message')}
              onClose={() => setOpenDropdown(null)}
              onOpenIncident={handleOpenIncidentFromMessage}
            />
          </div>
          <div className="nav-divider"></div>
          <div className="nav-item"><NotificationBox onNavigateToIncidentIntake={handleNavigateToIncidentIntake} isOpen={openDropdown === 'notification'} onToggle={() => toggleDropdown('notification')} onClose={() => setOpenDropdown(null)} /></div>
          <div className="nav-divider"></div>

          {/* ✅ SETTINGS (shows the logged-in EOC account) */}
          <div className="nav-item">
            <EOCSettings
              isOpen={openDropdown === 'settings'}
              onToggle={() => toggleDropdown('settings')}
              onClose={() => setOpenDropdown(null)}
              onLogout={performLogout}
            />
          </div>
        </div>
      </div>

      {activePage === 'dashboard' && (
        <div className={`dashboard-content ${sidebarOpen ? '' : 'sidebar-closed'}`}>
          
          {/* ✅ Centered Top Stats Overlay */}
          <div className="top-stats-overlay">
            {/* ✅ HEARTBEAT: the `has-active` class pumps the border while incidents > 0 */}
            <div className={`stat-card-item ${stats.activeIncidents > 0 ? 'has-active' : ''}`}>
              <div className="stat-icon-small"><i className="fa fa-exclamation-triangle"></i></div>
              <div className="stat-info-small"><p>Active Incidents</p><h4>{stats.activeIncidents}</h4></div>
            </div>
            <div className="stat-card-item">
              <div className="stat-icon-small"><i className="fa fa-truck"></i></div>
              <div className="stat-info-small"><p>Responders Deployed</p><h4>{stats.respondersDeployed}</h4></div>
            </div>
            {/* ✅ Available Units (based on Dispatch Responders' available list) */}
            <div className="stat-card-item">
              <div className="stat-icon-small"><i className="fa fa-users"></i></div>
              <div className="stat-info-small"><p>Available Units</p><h4>{stats.availableUnits}</h4></div>
            </div>
          </div>

          {/* ✅ Map Type Toggle */}
          <div className="map-type-toggle-external">
            <button className={mapType === 'street' ? 'active' : ''} onClick={() => setMapType('street')} title="Street View">
              <i className="fa fa-map"></i><span className="tooltip">Street</span>
            </button>
            <div className="divider"></div>
            <button className={mapType === 'satellite' ? 'active' : ''} onClick={() => setMapType('satellite')} title="Satellite View">
              <i className="fa fa-satellite"></i><span className="tooltip">Satellite</span>
            </button>
          </div>

          {/* ✅ UPDATED: LIVE Badge */}
          <div className="legend-overlay-left">
            <div className="live-status">
              <i className="fa fa-circle"></i>
              <span>LIVE</span>
            </div>
          </div>

          <GoogleMap
            responderLocations={responderLocations}
            focusIncidentId={focusIncidentId}
            focusNonce={focusNonce}
            mapType={mapType}
          />
        </div>
      )}

      {activePage === 'incidentIntake' && (
        <div className={`page-content ${sidebarOpen ? '' : 'sidebar-closed'}`}>
          <IncidentIntake onNavigateToDispatch={() => setActivePage('dispatchResponders')} />
        </div>
      )}

      {activePage === 'dispatchResponders' && (
        <div className={`page-content ${sidebarOpen ? '' : 'sidebar-closed'}`}>
          <DispatchResponder onDispatchComplete={handleDispatchComplete} onNavigateToDashboard={handleNavigateToDashboard} />
        </div>
      )}

      {activePage === 'monitorIncident' && (
        <div className={`page-content ${sidebarOpen ? '' : 'sidebar-closed'}`}>
          <MonitorIncidentStatus
            sidebarOpen={sidebarOpen}
            highlightIncidentId={monitorHighlightId}
          />
        </div>
      )}

      {activePage === 'loraDevice' && (
        <div className={`page-content ${sidebarOpen ? '' : 'sidebar-closed'}`}>
          <LoraDevice onForwardToDispatch={handleForwardToDispatch} />
        </div>
      )}
    </div>
  );
};

export default AppEOC;