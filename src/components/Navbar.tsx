import React, { useState, useEffect, useRef } from 'react';
import {
  signOut,
  updateProfile,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  sendPasswordResetEmail,
  verifyBeforeUpdateEmail,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection } from 'firebase/firestore';
import { auth } from '../firebase';
import logo from '../assets/logo (2).png';
import '../css/Navbar.css';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout?: () => void;
  /** Kept for backwards compatibility; no longer used by the settings menu. */
  onSettingsAction?: (action: string) => void;
}

/* ============================================================
   PASSWORD RULES (12+ chars, upper, lower, number, special)
   ============================================================ */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** adminnagaready@gmail.com -> admi••••@gmail.com */
const maskEmail = (email: string): string => {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const visible = local.slice(0, Math.min(4, Math.max(1, local.length - 1)));
  return `${visible}••••@${domain}`;
};

/** 09425362739 -> 0942•••••39 */
const maskPhone = (phone: string): string => {
  if (!phone) return '';
  if (phone.length <= 6) return phone.charAt(0) + '•'.repeat(phone.length - 1);
  return `${phone.slice(0, 4)}${'•'.repeat(phone.length - 6)}${phone.slice(-2)}`;
};

/** "Roylito Oberes" -> "RO" */
const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'AD';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

/** Posts an announcement to the Dashboard "Recent activity" feed */
const logAdminActivity = async (
  icon: string,
  tone: 'forest' | 'gold' | 'clay',
  title: string,
  meta: string
) => {
  try {
    const now = new Date().toISOString();
    await setDoc(doc(collection(getFirestore(), 'activity_feed')), {
      type: 'activity',
      icon,
      tone,
      title,
      meta,
      time: now,
      createdAt: now,
      sourceKey: `admin-account:${Date.now()}`,
    });
  } catch (err) {
    console.warn('Could not post dashboard announcement:', err);
  }
};

const PASSWORD_MIN_LENGTH = 12;

const validateNewPassword = (pw: string): string => {
  if (pw.length < PASSWORD_MIN_LENGTH)
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (!/[A-Z]/.test(pw)) return 'Include at least one uppercase letter.';
  if (!/[a-z]/.test(pw)) return 'Include at least one lowercase letter.';
  if (!/[0-9]/.test(pw)) return 'Include at least one number.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Include at least one special character.';
  return '';
};

/* ============================================================
   PASSWORD INPUT WITH SHOW / HIDE EYE
   ============================================================ */
interface PasswordInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  onFocus?: () => void;
  onBlur?: () => void;
}

const PasswordInput: React.FC<PasswordInputProps> = ({
  value,
  onChange,
  placeholder,
  autoComplete,
  onFocus,
  onBlur,
}) => {
  const [visible, setVisible] = useState(false);

  return (
    <div className="pw-input-wrap">
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
        className="pw-eye-btn"
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

const GEAR_PATH =
  'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z';

const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  onLogout,
}) => {
  const [showLogoutModal, setShowLogoutModal] = useState<boolean>(false);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [profileOpen, setProfileOpen] = useState<boolean>(false);
  const [aboutOpen, setAboutOpen] = useState<boolean>(false);
  const profileRef = useRef<HTMLDivElement>(null);

  // --- SIDEBAR COLLAPSE (desktop: icons only) ---
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('rops-sidebar-collapsed') === '1';
    } catch {
      return false;
    }
  });

  // --- PROFILE EDIT STATES ---
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [emailPw, setEmailPw] = useState('');
  const [emailError, setEmailError] = useState('');
  const [emailNotice, setEmailNotice] = useState('');

  // --- EMAIL VERIFICATION POP-UP FLOW ---
  const [emailStep, setEmailStep] = useState<'idle' | 'waiting' | 'newPassword' | 'done'>('idle');
  const [pendingEmail, setPendingEmail] = useState('');
  const pendingPwRef = useRef('');
  const checkingRef = useRef(false);
  const [vmError, setVmError] = useState('');
  const [mpNew, setMpNew] = useState('');
  const [mpConfirm, setMpConfirm] = useState('');
  const [mpFocused, setMpFocused] = useState(false);
  const [mpLoading, setMpLoading] = useState(false);
  const [currentName, setCurrentName] = useState<string>('Administrator');
  const [currentPhone, setCurrentPhone] = useState<string>('');

  // --- CHANGE PASSWORD (inline in dropdown) STATES ---
  const [pwOpen, setPwOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [newPwFocused, setNewPwFocused] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');

  // --- FORGOT PASSWORD STATES ---
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetSuccess, setResetSuccess] = useState('');

  const user = auth.currentUser;
  const userEmail = user?.email || 'admin';

  // Apply the collapsed class on <body> so the header + page content follow the sidebar width
  useEffect(() => {
    document.body.classList.toggle('rops-collapsed', collapsed);
    try {
      localStorage.setItem('rops-sidebar-collapsed', collapsed ? '1' : '0');
    } catch {
      /* ignore storage errors */
    }
    return () => document.body.classList.remove('rops-collapsed');
  }, [collapsed]);

  const handleToggleSidebar = () => {
    if (window.innerWidth <= 768) {
      setMenuOpen((v) => !v); // mobile: open/close drawer
    } else {
      setCollapsed((v) => !v); // desktop: collapse to icons only
    }
  };

  const resetPasswordForm = () => {
    setPwOpen(false);
    setCurrentPw('');
    setNewPw('');
    setConfirmPw('');
    setNewPwFocused(false);
    setPwError('');
    setPwSuccess('');
    setResetEmail('');
    setResetError('');
    setResetSuccess('');
  };

  useEffect(() => {
    if (!user) return;
    setEditName(user.displayName || 'Administrator');
    setEditEmail('');
    setCurrentName(user.displayName || 'Administrator');

    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(getFirestore(), 'manage_users', user.uid));
        if (cancelled || !snap.exists()) return;
        const data = snap.data();
        const phone = (data.phone as string) || '';
        setCurrentPhone(phone);
        if (!user.displayName && data.name) setCurrentName(data.name);
        if (user.email && data.email !== user.email) {
          await setDoc(doc(getFirestore(), 'manage_users', user.uid), { email: user.email }, { merge: true });
        }
      } catch (err) {
        console.error('Error loading profile from Firestore:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, profileOpen]);

  /* ---------- SIDEBAR ITEMS ---------- */
  const mainItems = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 10.5 12 3l9 7.5V21H3z" />
          <path d="M9.5 21v-6h5v6" />
        </svg>
      ),
    },
    {
      id: 'incidents',
      label: 'Final Reports',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="12" width="4" height="9" rx="1" />
          <rect x="10" y="4" width="4" height="17" rx="1" />
          <rect x="17" y="9" width="4" height="12" rx="1" />
        </svg>
      ),
    },
    {
      id: 'users',
      label: 'Manage Users',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
          <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" />
          <path d="M18 14.3c2.1.7 3.5 2.6 3.5 5.7" />
        </svg>
      ),
    },
  ];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest && target.closest('[data-settings-trigger]')) return;
      if (profileRef.current && !profileRef.current.contains(target as Node)) {
        setProfileOpen(false);
        setAboutOpen(false);
        setIsEditing(false);
        setEmailPw('');
        setEmailError('');
        setEmailNotice('');
        resetPasswordForm();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!aboutOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAboutOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [aboutOpen]);

  const toggleSettings = () => {
    setAboutOpen(false);
    if (profileOpen) {
      setIsEditing(false);
      setEmailPw('');
      setEmailError('');
      setEmailNotice('');
      resetPasswordForm();
    }
    setProfileOpen((v) => !v);
    setMenuOpen(false);
  };

  const handleNavClick = (id: string) => {
    if (id === 'settings') {
      toggleSettings();
      return;
    }
    setActiveTab(id);
    setMenuOpen(false);
  };

  const openLogoutModal = () => {
    setProfileOpen(false);
    setShowLogoutModal(true);
  };
  const closeLogoutModal = () => setShowLogoutModal(false);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setShowLogoutModal(false);
      if (onLogout) onLogout();
    } catch (error) {
      console.error('Logout error:', error);
      alert('Error logging out. Please try again.');
    }
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    setEmailError('');
    setEmailNotice('');

    const newEmail = editEmail.trim();
    const emailChanged = newEmail !== '' && newEmail.toLowerCase() !== (user.email || '').toLowerCase();

    if (emailChanged) {
      if (!user.email) return setEmailError('No email is linked to this account.');
      if (!EMAIL_RE.test(newEmail)) return setEmailError('Enter a valid email address.');
      if (!emailPw) return setEmailError('Enter your current password to change your email.');
    }

    const finalPhone = editPhone.trim() !== '' ? editPhone.trim() : currentPhone;

    setLoading(true);
    try {
      if (emailChanged) {
        const credential = EmailAuthProvider.credential(user.email!, emailPw);
        await reauthenticateWithCredential(user, credential);
      }

      await updateProfile(user, { displayName: editName });

      const db = getFirestore();
      await setDoc(doc(db, 'manage_users', user.uid), {
        name: editName,
        phone: finalPhone,
        userType: 'admin',
        updatedAt: new Date().toISOString()
      }, { merge: true });

      if (emailChanged) {
        await verifyBeforeUpdateEmail(user, newEmail);

        await logAdminActivity(
          'mail',
          'gold',
          '📧 Email Change Requested',
          `${editName || currentName} requested to change the admin email to ${maskEmail(newEmail)}. Waiting for verification.`
        );

        pendingPwRef.current = emailPw;
        setPendingEmail(newEmail);
        setVmError('');
        setMpNew('');
        setMpConfirm('');
        setEmailStep('waiting');
        setProfileOpen(false);
      } else {
        alert('✅ Profile updated successfully!');
      }

      setCurrentName(editName || 'Administrator');
      setCurrentPhone(finalPhone);
      setEmailPw('');
      setIsEditing(false);
    } catch (err: any) {
      console.error('Error saving profile:', err);
      switch (err.code) {
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
          setEmailError('Current password is incorrect.');
          break;
        case 'auth/email-already-in-use':
          setEmailError('This email is already used by another account.');
          break;
        case 'auth/invalid-email':
          setEmailError('Invalid email address.');
          break;
        case 'auth/requires-recent-login':
          setEmailError('Please log out and log in again, then retry.');
          break;
        case 'auth/too-many-requests':
          setEmailError('Too many attempts. Please try again later.');
          break;
        default:
          alert(`❌ Failed to update profile: ${err.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const checkEmailVerified = async (manual = false): Promise<boolean> => {
    if (checkingRef.current) return false;
    checkingRef.current = true;
    try {
      let sessionExpired = false;
      const current = auth.currentUser;
      if (current) {
        try {
          await current.reload();
          if ((auth.currentUser?.email || '').toLowerCase() === pendingEmail.toLowerCase()) {
            setVmError('');
            setEmailStep('newPassword');
            return true;
          }
        } catch (err: any) {
          sessionExpired = [
            'auth/user-token-expired',
            'auth/invalid-user-token',
            'auth/requires-recent-login',
          ].includes(err.code);
        }
      } else {
        sessionExpired = true;
      }

      if (sessionExpired || manual) {
        try {
          await signInWithEmailAndPassword(auth, pendingEmail, pendingPwRef.current);
          setVmError('');
          setEmailStep('newPassword');
          return true;
        } catch {
          if (manual) setVmError(`Not verified yet. Open the link sent to ${pendingEmail}, then try again.`);
        }
      }
      return false;
    } finally {
      checkingRef.current = false;
    }
  };

  useEffect(() => {
    if (emailStep !== 'waiting') return;
    const id = setInterval(() => {
      checkEmailVerified(false);
    }, 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailStep, pendingEmail]);

  const closeEmailFlow = () => {
    setEmailStep('idle');
    setPendingEmail('');
    pendingPwRef.current = '';
    setVmError('');
    setMpNew('');
    setMpConfirm('');
    setMpFocused(false);
  };

  const handleSetNewPassword = async () => {
    setVmError('');
    const ruleError = validateNewPassword(mpNew);
    if (ruleError) return setVmError(ruleError);
    if (mpNew !== mpConfirm) return setVmError('Passwords do not match.');
    if (mpNew === pendingPwRef.current) return setVmError('New password must be different.');

    setMpLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, pendingEmail, pendingPwRef.current);
      await updatePassword(cred.user, mpNew);
      await setDoc(
        doc(getFirestore(), 'manage_users', cred.user.uid),
        { email: pendingEmail, userType: 'admin', updatedAt: new Date().toISOString() },
        { merge: true }
      );

      await logAdminActivity(
        'check-circle-2',
        'forest',
        '✅ Admin Email Updated',
        `${currentName} verified the new email ${maskEmail(pendingEmail)} and set a new password.`
      );

      pendingPwRef.current = '';
      setEmailStep('done');
      setTimeout(closeEmailFlow, 2500);
    } catch (err: any) {
      if (err.code === 'auth/too-many-requests') setVmError('Too many attempts. Please try again later.');
      else if (err.code === 'auth/weak-password') setVmError('Password is too weak.');
      else setVmError(err.message || 'Failed to update password.');
    } finally {
      setMpLoading(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    resetPasswordForm();
    setEmailPw('');
    setEmailError('');
    if (user) {
      setEditName(user.displayName || 'Administrator');
      setEditEmail('');
      setEditPhone('');
    }
  };

  const handleUpdatePassword = async () => {
    if (!user || !user.email) return;
    setPwError('');
    setPwSuccess('');

    if (!currentPw) return setPwError('Please enter your current password.');
    const ruleError = validateNewPassword(newPw);
    if (ruleError) return setPwError(ruleError);
    if (newPw !== confirmPw) return setPwError('Passwords do not match.');
    if (newPw === currentPw) return setPwError('New password must be different.');

    setPwLoading(true);
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPw);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPw);

      await logAdminActivity(
        'lock',
        'forest',
        '🔒 Password Changed',
        `${currentName} changed the admin account password.`
      );

      setPwSuccess('✅ Password updated successfully!');
      setTimeout(resetPasswordForm, 1800);
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

  const handleSendResetLink = async () => {
    setResetError('');
    setResetSuccess('');
    const email = resetEmail.trim();
    if (!email) return setResetError('Please enter your registered email address.');

    setResetLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);

      await logAdminActivity(
        'key-round',
        'clay',
        '🔑 Password Reset Link Sent',
        `A password reset link was sent to ${maskEmail(email)} (forgot password).`
      );

      setResetSuccess(`✅ Reset link sent to ${email}. Check your inbox (and spam).`);
    } catch (err: any) {
      if (err.code === 'auth/invalid-email') setResetError('Invalid email address.');
      else if (err.code === 'auth/user-not-found') setResetError('No account found with this email.');
      else if (err.code === 'auth/too-many-requests') setResetError('Too many requests. Try again later.');
      else setResetError('Failed to send reset link. Please try again.');
    } finally {
      setResetLoading(false);
    }
  };

  const renderNavItem = (item: { id: string; label: string; icon: React.ReactNode }) => {
    const isActive = item.id === 'settings' ? profileOpen : activeTab === item.id;
    return (
      <button
        key={item.id}
        data-id={item.id}
        title={item.label}
        className={`rops-nav-item ${isActive ? 'active' : ''}`}
        onClick={() => handleNavClick(item.id)}
        {...(item.id === 'settings' ? { 'data-settings-trigger': 'true' } : {})}
      >
        {item.icon}
        <span>{item.label}</span>
      </button>
    );
  };

  return (
    <>
      {/* ============ LEFT SIDEBAR ============ */}
      <aside className={`rops-sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="rops-brand">
          <div className="rops-brand-mark rops-brand-avatar">
            <img src={logo} alt="Logo" />
          </div>
          <div className="rops-brand-text">
            <div className="rops-brand-name">{currentName}</div>
            <div className="rops-brand-sub">Admin console</div>
          </div>

          {/* SIDEBAR TOGGLE (same row as the brand) */}
          <button
            type="button"
            className="rops-sidebar-toggle"
            onClick={handleToggleSidebar}
            aria-label="Toggle sidebar"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {menuOpen ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>

        <nav className="rops-nav">
          {mainItems.map(renderNavItem)}
        </nav>

        {/* LOGOUT CARD (bottom of sidebar) */}
        <button
          type="button"
          className="rops-logout-card"
          onClick={openLogoutModal}
          aria-label="Logout"
          title="Logout"
        >
          <span className="rops-logout-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="m16 17 5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
          </span>
          <span className="rops-user-text">
            <span className="rops-user-name">Logout</span>
          </span>
        </button>
      </aside>

      {menuOpen && <div className="rops-sidebar-backdrop" onClick={() => setMenuOpen(false)} />}

      {/* ============ TOP BAR ============ */}
      <header className="rops-header">
        <button
          className="rops-menu-toggle"
          onClick={handleToggleSidebar}
          aria-label="Open navigation"
          title="Open menu"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {menuOpen ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>

        <div className="rops-right">
          <div className="rops-profile" ref={profileRef}>
            <button
              className={`rops-icon-btn rops-settings-btn ${profileOpen ? 'open' : ''}`}
              data-settings-trigger="true"
              onClick={toggleSettings}
              aria-haspopup="menu"
              aria-expanded={profileOpen}
              aria-label="Settings"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d={GEAR_PATH} />
              </svg>
            </button>

            <button
              type="button"
              className={`rops-icon-btn rops-about-btn ${aboutOpen ? 'open' : ''}`}
              onClick={() => {
                setProfileOpen(false);
                setIsEditing(false);
                setEmailPw('');
                setEmailError('');
                setEmailNotice('');
                resetPasswordForm();
                setAboutOpen((v) => !v);
              }}
              aria-haspopup="dialog"
              aria-expanded={aboutOpen}
              aria-label="About NAGA READY"
              title="About NAGA READY"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 11v5" />
                <path d="M12 8h.01" />
              </svg>
            </button>

            {profileOpen && (
              <div className="rops-profile-menu rops-settings-menu" role="menu">
                {!isEditing ? (
                  <div className="rops-set-section">
                    <div className="rops-set-title">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3" />
                        <path d={GEAR_PATH} />
                      </svg>
                      Admin Settings
                    </div>
                    <div className="rops-set-desc">Manage administrator information.</div>

                    <div className="rops-profile-hero" style={{ flexDirection: 'column', textAlign: 'center' }}>
                      <div className="rops-hero-text" style={{ alignItems: 'center' }}>
                        <div className="rops-hero-name">{currentName}</div>
                        <span className="rops-hero-badge">Administrator</span>
                      </div>
                    </div>

                    <ul className="rops-set-list">
                      <li>
                        <span className="rops-set-label">Email Address</span>
                        <span className="rops-set-value">{maskEmail(userEmail)}</span>
                      </li>
                      <li>
                        <span className="rops-set-label">Contact Number</span>
                        <span className="rops-set-value">{currentPhone ? maskPhone(currentPhone) : 'Not set'}</span>
                      </li>
                    </ul>

                    {emailNotice && <div className="rops-pw-success rops-email-notice">{emailNotice}</div>}

                    <button
                      className="rops-set-action"
                      role="menuitem"
                      onClick={() => {
                        setIsEditing(true);
                        setEmailNotice('');
                        setEmailError('');
                        setEmailPw('');
                        setEditEmail('');
                        setEditName(currentName);
                        setEditPhone('');
                      }}
                    >
                      Edit Profile
                    </button>
                  </div>
                ) : pwOpen ? (
                  <div className="rops-set-section">
                    <div className="pw-inline">
                      <div className="pw-heading">1. Change Password</div>
                      <div className="pw-card">
                        <label>Current Password</label>
                        <PasswordInput
                          value={currentPw}
                          onChange={setCurrentPw}
                          placeholder="Enter your current password"
                          autoComplete="current-password"
                        />

                        <label>New Password</label>
                        <PasswordInput
                          value={newPw}
                          onChange={setNewPw}
                          placeholder="Enter your new password"
                          autoComplete="new-password"
                          onFocus={() => setNewPwFocused(true)}
                          onBlur={() => setNewPwFocused(false)}
                        />
                        {newPwFocused && (
                          <div className="pw-hint">
                            12+ characters with uppercase, lowercase, number, and symbol.
                          </div>
                        )}

                        <label>Confirm New Password</label>
                        <PasswordInput
                          value={confirmPw}
                          onChange={setConfirmPw}
                          placeholder="Re-enter your new password"
                          autoComplete="new-password"
                        />
                        {confirmPw && newPw !== confirmPw && (
                          <div className="rops-pw-error">Passwords do not match.</div>
                        )}

                        {pwError && <div className="rops-pw-error">{pwError}</div>}
                        {pwSuccess && <div className="rops-pw-success">{pwSuccess}</div>}

                        <div className="rops-edit-actions">
                          <button className="rops-btn-cancel" onClick={resetPasswordForm} disabled={pwLoading}>
                            Cancel
                          </button>
                          <button className="rops-btn-save" onClick={handleUpdatePassword} disabled={pwLoading}>
                            {pwLoading ? 'Updating...' : 'Update Password'}
                          </button>
                        </div>
                      </div>

                      <div className="pw-heading">2. Forgot Password (Admin cannot remember current password)</div>
                      <div className="pw-card">
                        <div className="pw-reset-row">
                          <input
                            className="pw-plain-input"
                            type="email"
                            value={resetEmail}
                            onChange={(e) => setResetEmail(e.target.value)}
                            placeholder="Registered admin email"
                            autoComplete="email"
                          />
                          <button className="rops-btn-save" onClick={handleSendResetLink} disabled={resetLoading}>
                            {resetLoading ? 'Sending...' : 'Send Link'}
                          </button>
                        </div>

                        {resetError && <div className="rops-pw-error">{resetError}</div>}
                        {resetSuccess && <div className="rops-pw-success">{resetSuccess}</div>}
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="rops-set-section">
                      <div className="rops-set-title">Edit Profile</div>
                      <div className="rops-edit-profile-form">
                        <div className="rops-edit-fields">
                          <div className="rops-edit-group">
                            <label>Full Name</label>
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              placeholder="Enter full name"
                            />
                          </div>
                          <div className="rops-edit-group">
                            <label>Email Address</label>
                            <input
                              type="email"
                              value={editEmail}
                              onChange={(e) => setEditEmail(e.target.value)}
                              placeholder="Leave blank to keep current email"
                              autoComplete="email"
                            />
                          </div>
                          {editEmail.trim() !== '' && editEmail.trim().toLowerCase() !== (user?.email || '').toLowerCase() && (
                            <div className="rops-edit-group">
                              <label>Current Password (to confirm email change)</label>
                              <PasswordInput
                                value={emailPw}
                                onChange={setEmailPw}
                                placeholder="Enter your current password"
                                autoComplete="current-password"
                              />
                              <div className="pw-hint">A verification link will be sent to the new email.</div>
                            </div>
                          )}
                          <div className="rops-edit-group">
                            <label>Contact Number</label>
                            <input
                              type="tel"
                              value={editPhone}
                              onChange={(e) => setEditPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                              placeholder={currentPhone ? `${maskPhone(currentPhone)} (leave blank to keep)` : '09XXXXXXXXX'}
                            />
                          </div>
                        </div>

                        {emailError && <div className="rops-pw-error">{emailError}</div>}

                        <div className="rops-edit-actions">
                          <button className="rops-btn-cancel" onClick={handleCancelEdit} disabled={loading}>
                            Cancel
                          </button>
                          <button className="rops-btn-save" onClick={handleSaveProfile} disabled={loading}>
                            {loading ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="rops-set-divider" />

                    <div className="rops-set-section">
                      <button
                        className="rops-set-action rops-set-action-row"
                        role="menuitem"
                        onClick={() => setPwOpen(true)}
                      >
                        Change Password
                      </button>
                    </div>
                  </>
                )}

                <div className="rops-set-divider" />

                <button className="rops-profile-logout" onClick={openLogoutModal} role="menuitem">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <path d="m16 17 5-5-5-5" />
                    <path d="M21 12H9" />
                  </svg>
                  Logout
                </button>
              </div>
            )}

            {aboutOpen && (
              <div className="rops-about-menu" role="dialog" aria-label="About NAGA READY">
                <div className="rops-about-head">
                  <img src={logo} alt="NAGA READY" className="rops-about-logo" />
                  <div className="rops-about-title">About NAGA READY</div>
                </div>

                <div className="rops-about-body">
                  <p>
                    <strong>NAGA READY</strong> is an administrative management portal developed for the City of Naga
                    CDRRMO to support emergency response administration, user management, and incident documentation.
                  </p>

                  <h4>Key Features</h4>
                  <ol className="rops-about-features">
                    <li>
                      <strong>Dashboard</strong>
                      <span>View system activities, incident statistics, and emergency response updates.</span>
                    </li>
                    <li>
                      <strong>Manage Users</strong>
                      <span>Manage EOC and emergency responder accounts.</span>
                    </li>
                    <li>
                      <strong>Final Reports</strong>
                      <span>Access and review completed incident reports and records.</span>
                    </li>
                  </ol>

                  <div className="rops-about-info">
                    <div className="rops-about-row"><span>Developed for</span><strong>City of Naga CDRRMO</strong></div>
                    <div className="rops-about-row"><span>Version</span><strong>1.0.0</strong></div>
                  </div>

                  <div className="rops-about-foot">© 2026 NAGA READY. All Rights Reserved.</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {showLogoutModal && (
        <div className="logout-modal-overlay" onClick={closeLogoutModal}>
          <div className="logout-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-warning-icon">
              <div className="modal-warning-circle">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
            </div>

            <h2>Confirm Logout</h2>
            <p>Are you sure you want to logout?</p>
            <p className="sub-text">You will be redirected to the login page.</p>

            <div className="modal-actions">
              <button className="btn-cancel" onClick={closeLogoutModal}>
                Cancel
              </button>
              <button className="btn-logout" onClick={handleLogout}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <path d="m16 17 5-5-5-5" />
                  <path d="M21 12H9" />
                </svg>
                Yes, Logout
              </button>
            </div>
          </div>
        </div>
      )}

      {emailStep !== 'idle' && (
        <div className="logout-modal-overlay">
          <div className="logout-modal-content em-modal" onClick={(e) => e.stopPropagation()}>
            {emailStep === 'waiting' && (
              <>
                <h2>Verify your new email</h2>
                <p>
                  We sent a verification link to <strong>{maskEmail(pendingEmail)}</strong>. Open the link in
                  your inbox (check spam too), then come back here.
                </p>
                <p className="sub-text">⏳ Waiting for verification…</p>
                {vmError && <div className="rops-pw-error em-modal-msg">{vmError}</div>}
                <div className="modal-actions">
                  <button className="btn-cancel" onClick={closeEmailFlow}>
                    Cancel
                  </button>
                  <button className="btn-logout" onClick={() => checkEmailVerified(true)}>
                    I verified it
                  </button>
                </div>
              </>
            )}

            {emailStep === 'newPassword' && (
              <>
                <h2>Set a new password</h2>
                <p>
                  <strong>{maskEmail(pendingEmail)}</strong> is verified. Create a new password for this account.
                </p>
                <div className="pw-card em-modal-card">
                  <label>New Password</label>
                  <PasswordInput
                    value={mpNew}
                    onChange={setMpNew}
                    placeholder="Enter your new password"
                    autoComplete="new-password"
                    onFocus={() => setMpFocused(true)}
                    onBlur={() => setMpFocused(false)}
                  />
                  {mpFocused && (
                    <div className="pw-hint">
                      12+ characters with uppercase, lowercase, number, and symbol.
                    </div>
                  )}

                  <label>Confirm New Password</label>
                  <PasswordInput
                    value={mpConfirm}
                    onChange={setMpConfirm}
                    placeholder="Re-enter your new password"
                    autoComplete="new-password"
                  />
                  {mpConfirm && mpNew !== mpConfirm && (
                    <div className="rops-pw-error">Passwords do not match.</div>
                  )}
                  {vmError && <div className="rops-pw-error">{vmError}</div>}
                </div>
                <div className="modal-actions">
                  <button className="btn-cancel" onClick={closeEmailFlow} disabled={mpLoading}>
                    Skip
                  </button>
                  <button className="btn-logout" onClick={handleSetNewPassword} disabled={mpLoading}>
                    {mpLoading ? 'Saving...' : 'Save Password'}
                  </button>
                </div>
              </>
            )}

            {emailStep === 'done' && (
              <>
                <h2>All set ✅</h2>
                <p>Your email and password were updated. Use <strong>{maskEmail(pendingEmail)}</strong> next time you log in.</p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default Navbar;