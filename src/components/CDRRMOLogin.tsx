import React, { useState, useEffect } from 'react';
import { getFirestore, collection, addDoc, doc, onSnapshot, serverTimestamp, query, where, getDocs } from 'firebase/firestore';
import { getAuth, sendPasswordResetEmail } from 'firebase/auth';
import '../css/cdrrmo.css';
import logo from '../assets/logo (2).png';

interface LoginProps {
  onLogin: (username: string, password: string) => Promise<boolean> | boolean;
  onForgotPassword?: (email: string) => Promise<void>;
}

const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 60;
const ANIMATION_MS = 900;
// Original admin email (fallback only). Once the admin changes their email in
// Admin Settings, their Firestore doc (manage_users/{uid}) has userType: 'admin',
// which is what identifies them from then on.
const ADMIN_EMAIL = 'adminnagaready@gmail.com';

const RESET_PENDING_KEY = 'login_reset_pending_v1';
interface PendingReset { id: string; email: string; }

const readPendingResets = (): PendingReset[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(RESET_PENDING_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writePendingResets = (list: PendingReset[]) => {
  try { localStorage.setItem(RESET_PENDING_KEY, JSON.stringify(list.slice(-20))); } catch {}
};

const CDRRMOLogin: React.FC<LoginProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Fields stay read-only until the user clicks into them.
  // This stops Chrome from auto-filling saved logins and showing the suggestion dropdown.
  const [fieldsUnlocked, setFieldsUnlocked] = useState(false);

  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [resetError, setResetError] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  const [resetStatus, setResetStatus] = useState<'idle' | 'checking' | 'admin' | 'user' | 'notfound' | 'error'>('idle');

  const [pendingResets, setPendingResets] = useState<PendingReset[]>(readPendingResets);
  const [linkNotice, setLinkNotice] = useState<PendingReset | null>(null);

  const [failedAttempts, setFailedAttempts] = useState<number>(0);
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [showLockoutModal, setShowLockoutModal] = useState<boolean>(false);
  const [attemptsLeft, setAttemptsLeft] = useState<number>(MAX_ATTEMPTS);
  const [lockoutSeconds, setLockoutSeconds] = useState<number>(0);

  const [showWrongPasswordModal, setShowWrongPasswordModal] = useState(false);

  const clearLockStorage = () => {
    localStorage.removeItem('loginLocked');
    localStorage.removeItem('loginLockTime');
    localStorage.removeItem('loginFailedAttempts');
  };

  const validatePassword = (pass: string): { valid: boolean; message: string } => {
    if (pass.length < 12) {
      return { valid: false, message: 'Password must be at least 12 characters long.' };
    }
    if (!/[A-Z]/.test(pass)) {
      return { valid: false, message: 'Password must contain at least one uppercase letter.' };
    }
    if (!/[a-z]/.test(pass)) {
      return { valid: false, message: 'Password must contain at least one lowercase letter.' };
    }
    if (!/[0-9]/.test(pass)) {
      return { valid: false, message: 'Password must contain at least one number.' };
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(pass)) {
      return { valid: false, message: 'Password must contain at least one special character (!@#$%^&* etc.).' };
    }
    return { valid: true, message: '' };
  };

  useEffect(() => {
    const savedAttempts = localStorage.getItem('loginFailedAttempts');
    const savedLocked = localStorage.getItem('loginLocked');
    const savedLockTime = localStorage.getItem('loginLockTime');

    if (savedAttempts) {
      const n = parseInt(savedAttempts, 10) || 0;
      setFailedAttempts(n);
      setAttemptsLeft(Math.max(0, MAX_ATTEMPTS - n));
    }

    if (savedLocked === 'true' && savedLockTime) {
      const elapsedSeconds = Math.floor((Date.now() - parseInt(savedLockTime, 10)) / 1000);
      const remaining = LOCKOUT_SECONDS - elapsedSeconds;

      if (remaining > 0) {
        setIsLocked(true);
        setLockoutSeconds(remaining);
        setShowLockoutModal(true);
      } else {
        clearLockStorage();
        setFailedAttempts(0);
        setAttemptsLeft(MAX_ATTEMPTS);
        setIsLocked(false);
        setLockoutSeconds(0);
      }
    }
  }, []);

  useEffect(() => {
    if (!isLocked) return;

    const interval = setInterval(() => {
      setLockoutSeconds(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          setIsLocked(false);
          setFailedAttempts(0);
          setAttemptsLeft(MAX_ATTEMPTS);
          setShowLockoutModal(false);
          clearLockStorage();
          setError('✅ Account unlocked. You can now try to login again.');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isLocked]);

  // Detect whether the typed email belongs to the admin or to a normal (EOC) user.
  // The admin is identified by userType/type === 'admin' in manage_users, so it keeps
  // working even after the admin changes their Gmail in Admin Settings.
  useEffect(() => {
    const target = resetEmail.trim();

    if (!/^\S+@\S+\.\S+$/.test(target)) {
      setResetStatus('idle');
      return;
    }

    const isOriginalAdminEmail = target.toLowerCase() === ADMIN_EMAIL.toLowerCase();

    let cancelled = false;
    setResetStatus('checking');

    const timer = setTimeout(async () => {
      try {
        const snap = await getDocs(
          query(
            collection(getFirestore(), 'manage_users'),
            where('email', 'in', [target, target.toLowerCase()])
          )
        );

        if (cancelled) return;

        if (!snap.empty) {
          const isAdminDoc = snap.docs.some((d) => {
            const data: any = d.data();
            return (data.userType || data.type) === 'admin';
          });
          setResetStatus(isAdminDoc || isOriginalAdminEmail ? 'admin' : 'user');
          return;
        }

        // No Firestore record: fall back to the original admin email
        setResetStatus(isOriginalAdminEmail ? 'admin' : 'notfound');
      } catch (err) {
        console.error('Email check error:', err);
        if (!cancelled) setResetStatus(isOriginalAdminEmail ? 'admin' : 'error');
      }
    }, 500);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [resetEmail]);

  useEffect(() => {
    if (pendingResets.length === 0) return;

    const removePending = (id: string) => {
      setPendingResets(prev => {
        const next = prev.filter(p => p.id !== id);
        writePendingResets(next);
        return next;
      });
    };

    const db = getFirestore();
    const unsubs = pendingResets.map(p =>
      onSnapshot(
        doc(db, 'password_reset_requests', p.id),
        (snap) => {
          if (!snap.exists()) { removePending(p.id); return; }
          const data: any = snap.data();
          if (data.status === 'link_sent') {
            setLinkNotice(prev => prev ?? { id: p.id, email: data.email || p.email });
          } else if (data.status === 'dismissed') {
            removePending(p.id);
          }
        },
        (err) => console.error('Reset request listener error:', err)
      )
    );

    return () => unsubs.forEach(u => u());
  }, [pendingResets]);

  const dismissLinkNotice = () => {
    if (linkNotice) {
      const id = linkNotice.id;
      setPendingResets(prev => {
        const next = prev.filter(p => p.id !== id);
        writePendingResets(next);
        return next;
      });
    }
    setLinkNotice(null);
  };

  const formatTime = (totalSeconds: number): string => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const registerFailedAttempt = (): { locked: boolean; left: number } => {
    const newFailedCount = failedAttempts + 1;
    const left = Math.max(0, MAX_ATTEMPTS - newFailedCount);
    setFailedAttempts(newFailedCount);
    setAttemptsLeft(left);
    localStorage.setItem('loginFailedAttempts', newFailedCount.toString());

    if (newFailedCount >= MAX_ATTEMPTS) {
      setIsLocked(true);
      setLockoutSeconds(LOCKOUT_SECONDS);
      setShowLockoutModal(true);
      localStorage.setItem('loginLocked', 'true');
      localStorage.setItem('loginLockTime', Date.now().toString());
      return { locked: true, left: 0 };
    }
    return { locked: false, left };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isLocked) {
      setError(`🔒 Account is locked. Please wait ${lockoutSeconds} second(s) before trying again.`);
      return;
    }

    // Password standard is checked ONLY when the user clicks Sign in.
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      const r = registerFailedAttempt();
      setError('');
      if (!r.locked) setShowWrongPasswordModal(true);
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const success = await onLogin(username, password);

      if (!success) {
        const r = registerFailedAttempt();
        setError('');
        if (!r.locked) setShowWrongPasswordModal(true);
        setIsLoading(false);
        return;
      }

      setFailedAttempts(0);
      setAttemptsLeft(MAX_ATTEMPTS);
      clearLockStorage();
      setIsLocked(false);
      setShowLockoutModal(false);
      setLockoutSeconds(0);

      setIsTransitioning(true);
      await new Promise(resolve => setTimeout(resolve, ANIMATION_MS));
    } catch (err) {
      console.error('Login error:', err);
      const r = registerFailedAttempt();
      setError('');
      if (!r.locked) setShowWrongPasswordModal(true);
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError('');
    setResetMessage('');

    const target = resetEmail.trim();
    if (!target) {
      setResetError('Please enter your email address.');
      return;
    }
    if (resetStatus !== 'admin' && resetStatus !== 'user') return;

    setIsResetting(true);

    try {
      if (resetStatus === 'admin') {
        await sendPasswordResetEmail(getAuth(), target);
        setResetMessage('✅ Reset link sent. Please check your inbox or spam folder.');
      } else {
        const ref = await addDoc(collection(getFirestore(), 'password_reset_requests'), {
          email: target,
          status: 'pending',
          requestedAt: serverTimestamp(),
          requestedBy: 'eoc-portal',
          userAgent: 'eoc-portal',
        });

        setPendingResets(prev => {
          const next = [...prev.filter(p => p.id !== ref.id), { id: ref.id, email: target }];
          writePendingResets(next);
          return next;
        });

        setResetMessage('✅ Request sent to the admin. You will be notified here once the reset link is sent.');
      }

      setResetEmail('');
      setTimeout(() => {
        setShowForgotPassword(false);
        setResetMessage('');
      }, 3000);
    } catch (error: any) {
      console.error('Forgot password error:', error);
      if (error?.code === 'permission-denied') {
        setResetError('Permission denied. Please contact the admin.');
      } else if (error?.code === 'auth/too-many-requests') {
        setResetError('Too many requests. Please try again later.');
      } else if (error?.code === 'auth/user-not-found') {
        setResetError('No account found with this email address.');
      } else {
        setResetError('Failed. Please try again.');
      }
    } finally {
      setIsResetting(false);
    }
  };

  const openForgotPassword = () => {
    setShowForgotPassword(true);
    setResetEmail('');
    setResetError('');
    setResetMessage('');
    setResetStatus('idle');
  };

  const closeForgotPassword = () => {
    setShowForgotPassword(false);
    setResetEmail('');
    setResetError('');
    setResetMessage('');
    setResetStatus('idle');
  };

  return (
    <div className={`meridian-stage ${isTransitioning ? 'transitioning' : ''}`}>
      <div className="meridian-dashboard-preview">
        <div className="dashboard-preview-content">
          <div className="dashboard-preview-logo">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2L4 5v6c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V5l-8-3z" stroke="#4F46C1" strokeWidth="1.6" strokeLinejoin="round"/>
            </svg>
            <span>CDRRMO</span>
          </div>
          <div className="dashboard-preview-loader">
            <div className="preview-spinner"></div>
            <p>Loading Operations Console...</p>
          </div>
        </div>
      </div>

      <div className="meridian-login-layer">
        <div className="meridian-panel meridian-panel-brand">
          <div className="meridian-brand-content">
            <div className="meridian-brand-mark">
              <img
                src={logo}
                alt="CDRRMO Logo"
                className="meridian-brand-logo"
              />
            </div>
            <h1 className="meridian-brand-name">CDRRMO</h1>
            <p className="meridian-brand-city">NAGA CITY, CEBU</p>
            <div className="meridian-brand-badge">PORTAL</div>
            <p className="meridian-brand-tagline">Emergency Operations Center</p>
          </div>
          <div className="meridian-brand-footer">
            <span>🔒 Secure access · Authorized personnel only</span>
          </div>
        </div>

        <div className="meridian-panel meridian-panel-form">
          <div className="meridian-form-card">
            {isLocked && (
              <div className="meridian-lockout-timer">
                <div className="meridian-lockout-icon">🔒</div>
                <div className="meridian-lockout-content">
                  <div className="meridian-lockout-title">Account Temporarily Locked</div>
                  <div className="meridian-lockout-countdown">
                    <span className="meridian-timer-value">{formatTime(lockoutSeconds)}</span>
                  </div>
                  <div className="meridian-lockout-sub">
                    Too many failed login attempts. Please wait before trying again.
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="meridian-error-message">
                {error}
              </div>
            )}

            <div className="meridian-form-container">
              <form onSubmit={handleSubmit} className="meridian-login-form" autoComplete="off">
                <h2 className="meridian-form-title">Sign in</h2>
                <p className="meridian-form-desc">Enter your credentials to access the operations console.</p>

                <div className="meridian-input-group">
                  <label className="meridian-input-label">Email or username</label>
                  <div className="meridian-input-wrapper">
                    <svg className="meridian-input-icon" width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <path d="M20 21V19C20 16.7909 18.2091 15 16 15H8C5.79086 15 4 16.7909 4 19V21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M12 11C14.2091 11 16 9.20914 16 7C16 4.79086 14.2091 3 12 3C9.79086 3 8 4.79086 8 7C8 9.20914 9.79086 11 12 11Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <input
                      type="text"
                      inputMode="email"
                      name="cdrrmo-user-field"
                      className="meridian-input"
                      placeholder="eoc@gmail.com"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      autoComplete="off"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      readOnly={!fieldsUnlocked}
                      onFocus={() => setFieldsUnlocked(true)}
                      disabled={isLoading || isLocked || isTransitioning}
                    />
                  </div>
                </div>

                <div className="meridian-input-group">
                  <label className="meridian-input-label">Password</label>
                  <div className="meridian-input-wrapper">
                    <svg className="meridian-input-icon" width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M7 11V7C7 4.23858 9.23858 2 12 2C14.7614 2 17 4.23858 17 7V11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <input
                      type={showPassword ? "text" : "password"}
                      name="cdrrmo-pass-field"
                      className="meridian-input"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="new-password"
                      readOnly={!fieldsUnlocked}
                      onFocus={() => setFieldsUnlocked(true)}
                      disabled={isLoading || isLocked || isTransitioning}
                    />
                    <button
                      type="button"
                      className="meridian-toggle-password"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label="Toggle password visibility"
                      disabled={isLocked || isTransitioning}
                    >
                      {showPassword ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                          <path d="M1 12C1 12 5 4 12 4C19 4 23 12 23 12C23 12 19 20 12 20C5 20 1 12 1 12Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                          <path d="M17.94 17.94C16.2306 19.243 14.1491 19.9649 12 20C5 20 1 12 1 12C2.24389 9.68189 3.96914 7.65651 6.06 6.06M9.9 4.24C10.5883 4.07888 11.293 4 12 4C19 4 23 12 23 12C22.393 13.1356 21.6691 14.2047 20.84 15.19M14.12 14.12C13.8454 14.4147 13.5141 14.6512 13.1462 14.8151C12.7782 14.9791 12.3809 15.0673 11.9781 15.0744C11.5753 15.0815 11.1752 15.0074 10.8016 14.8565C10.4281 14.7056 10.0887 14.481 9.80385 14.1962C9.51897 13.9113 9.29439 13.5719 9.14351 13.1984C8.99262 12.8248 8.91853 12.4247 8.92563 12.0219C8.93274 11.6191 9.02091 11.2218 9.18488 10.8538C9.34884 10.4859 9.58525 10.1546 9.88 9.88" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M1 1L23 23" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                <div className="meridian-form-options">
                  <label className="meridian-checkbox-label">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      disabled={isLocked || isTransitioning}
                    />
                    <span className="meridian-checkmark"></span>
                    Remember me
                  </label>
                  <button
                    type="button"
                    className="meridian-forgot-btn"
                    onClick={openForgotPassword}
                    disabled={isLocked || isTransitioning}
                  >
                    Forgot password?
                  </button>
                </div>

                <button
                  type="submit"
                  className={`meridian-submit-btn ${isLoading || isTransitioning ? 'loading' : ''}`}
                  disabled={isLoading || isLocked || isTransitioning}
                >
                  <span className="meridian-btn-label">Sign in</span>
                  <span className="meridian-spinner"></span>
                </button>

                {!isLocked && !isTransitioning && failedAttempts > 0 && (
                  <div className="meridian-attempts-info">
                    {attemptsLeft > 0 ? (
                      <span>You have {attemptsLeft} attempt{attemptsLeft === 1 ? '' : 's'} left</span>
                    ) : (
                      <span style={{ color: '#DC2626' }}>No attempts remaining</span>
                    )}
                  </div>
                )}
              </form>
            </div>

            <div className="meridian-security-footer">
              <div className="meridian-security-item">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.8"/>
                  <path d="M3 9H21" stroke="currentColor" strokeWidth="1.8"/>
                </svg>
                <span>Secure Connection</span>
                <span className="meridian-footer-badge">HTTPS Encrypted</span>
              </div>
              <div className="meridian-footer-divider"></div>
              <div className="meridian-security-item">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8"/>
                  <path d="M12 6V12L16 14" stroke="currentColor" strokeWidth="1.8"/>
                </svg>
                <span>24/7 Emergency Operations</span>
              </div>
            </div>

            <p className="meridian-form-hint">Authorized personnel only. All login activities are monitored.</p>
          </div>
        </div>
      </div>

      {showForgotPassword && (
        <div className="meridian-modal-overlay" onClick={closeForgotPassword}>
          <div className="meridian-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="meridian-modal-header">
              <div className="meridian-modal-header-left">
                <div className="meridian-modal-icon meridian-forgot-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5z" />
                    <path d="M2 17l10 5 10-5" />
                    <path d="M2 12l10 5 10-5" />
                  </svg>
                </div>
                <div className="meridian-modal-title-section">
                  <h3>Forgot Password</h3>
                  <p>Enter your registered email address.</p>
                </div>
              </div>
              <button className="meridian-close-btn" onClick={closeForgotPassword}>✕</button>
            </div>

            <form onSubmit={handleForgotPassword} className="meridian-forgot-form" autoComplete="off">
              <div className="meridian-input-group">
                <label className="meridian-input-label">Registered Email Address</label>
                <div className="meridian-input-wrapper">
                  <svg className="meridian-input-icon" width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="currentColor" strokeWidth="1.8"/>
                    <polyline points="22,6 12,13 2,6" stroke="currentColor" strokeWidth="1.8"/>
                  </svg>
                  <input
                    type="text"
                    inputMode="email"
                    name="cdrrmo-reset-email"
                    className="meridian-input"
                    placeholder="Enter your email address"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    required
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={isResetting}
                  />
                </div>
              </div>

              {resetStatus === 'checking' && (
                <div className="meridian-modal-title-section"><p>Checking email...</p></div>
              )}
              {resetStatus === 'notfound' && (
                <div className="meridian-error-message" style={{ marginBottom: '10px' }}>
                  This email is not registered.
                </div>
              )}
              {resetStatus === 'error' && (
                <div className="meridian-error-message" style={{ marginBottom: '10px' }}>
                  Could not check this email. Please try again.
                </div>
              )}

              {resetError && (
                <div className="meridian-error-message" style={{ marginBottom: '10px' }}>
                  {resetError}
                </div>
              )}

              {resetMessage && (
                <div className="meridian-success-message">
                  {resetMessage}
                </div>
              )}

              <div className="meridian-modal-actions">
                <button type="button" className="meridian-cancel-btn" onClick={closeForgotPassword} disabled={isResetting}>
                  Cancel
                </button>
                {(resetStatus === 'admin' || resetStatus === 'user') && (
                  <button type="submit" className="meridian-send-btn" disabled={isResetting}>
                    {isResetting
                      ? 'Sending...'
                      : resetStatus === 'admin'
                        ? 'Send Reset Link'
                        : 'Send Request to Admin'}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {showWrongPasswordModal && (
        <div className="meridian-modal-overlay" onClick={() => setShowWrongPasswordModal(false)}>
          <div className="meridian-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="meridian-modal-header">
              <div className="meridian-modal-header-left">
                <div className="meridian-modal-icon meridian-lockout-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M15 9l-6 6M9 9l6 6" />
                  </svg>
                </div>
                <div className="meridian-modal-title-section">
                  <h3 style={{ color: '#DC2626' }}>Incorrect Password</h3>
                  <p>The password you entered is incorrect. Please try again.</p>
                </div>
              </div>
            </div>
            <div className="meridian-forgot-form">
              <div className="meridian-modal-actions" style={{ marginTop: 0 }}>
                <button
                  type="button"
                  className="meridian-send-btn"
                  onClick={() => setShowWrongPasswordModal(false)}
                >
                  Try Again
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showLockoutModal && (
        <div className="meridian-modal-overlay" onClick={() => {}}>
          <div className="meridian-modal-box meridian-lockout-modal" onClick={(e) => e.stopPropagation()}>
            <div className="meridian-modal-header">
              <div className="meridian-modal-header-left">
                <div className="meridian-modal-icon meridian-lockout-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    <circle cx="12" cy="16" r="1" />
                  </svg>
                </div>
                <div className="meridian-modal-title-section">
                  <h3 style={{ color: '#DC2626' }}>🔒 Account Locked</h3>
                  <p>Too many failed login attempts. Security measure activated.</p>
                </div>
              </div>
            </div>

            <div className="meridian-lockout-modal-body">
              <div className="meridian-lockout-alert">
                <div className="meridian-lockout-alert-icon">⚠️</div>
                <div>
                  <p className="meridian-lockout-alert-title">Account temporarily locked</p>
                  <p className="meridian-lockout-alert-sub">Multiple failed login attempts detected</p>
                </div>
              </div>

              <div className="meridian-lockout-timer-display">
                <p className="meridian-lockout-timer-label">⏳ Time remaining</p>
                <p className="meridian-lockout-timer-value">
                  {lockoutSeconds > 0 ? formatTime(lockoutSeconds) : 'Unlocking...'}
                </p>
              </div>

              <div className="meridian-lockout-note">
                <p>
                  🔐 Your account has been locked for security reasons.
                  Please wait {lockoutSeconds} second(s) before trying again.
                  <br /><br />
                  <span>If you believe this is a mistake, please contact your system administrator.</span>
                </p>
              </div>

              <div className="meridian-modal-actions">
                <button
                  className="meridian-cancel-btn"
                  onClick={() => setShowLockoutModal(false)}
                  style={{ flex: 1 }}
                >
                  Close
                </button>
                <button
                  className="meridian-send-btn"
                  onClick={() => {
                    setShowLockoutModal(false);
                    openForgotPassword();
                  }}
                  style={{ flex: 1, background: '#3B82F6' }}
                >
                  <span>📧</span> Reset Password
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {linkNotice && (
        <div className="meridian-modal-overlay" onClick={dismissLinkNotice}>
          <div className="meridian-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="meridian-modal-header">
              <div className="meridian-modal-header-left">
                <div className="meridian-modal-icon meridian-forgot-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                </div>
                <div className="meridian-modal-title-section">
                  <h3>Reset Link Sent</h3>
                  <p>The admin has approved your request.</p>
                </div>
              </div>
              <button className="meridian-close-btn" onClick={dismissLinkNotice}>✕</button>
            </div>
            <div className="meridian-forgot-form">
              <div className="meridian-success-message">
                ✅ The admin has sent your reset link. Please check your inbox or spam folder at <strong>{linkNotice.email}</strong>.
              </div>
              <div className="meridian-modal-actions">
                <button type="button" className="meridian-send-btn" onClick={dismissLinkNotice}>
                  Got it
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="meridian-bottom-footer">
        <p>City Disaster Risk Reduction and Management Office</p>
        <p>City Government of Naga</p>
      </div>
    </div>
  );
};

export default CDRRMOLogin;