import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { verifyPasswordResetCode, confirmPasswordReset } from 'firebase/auth';
import { auth } from '../firebase';
import '../css/ResetPassword.css';

const ResetPassword: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [oobCode, setOobCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isValidCode, setIsValidCode] = useState(false);
  const [isVerifying, setIsVerifying] = useState(true);

  // Password requirements
  const requirements = {
    length: newPassword.length >= 12,
    uppercase: /[A-Z]/.test(newPassword),
    lowercase: /[a-z]/.test(newPassword),
    number: /[0-9]/.test(newPassword),
    special: /[!@#$%^&*(),.?":{}|<>]/.test(newPassword),
  };

  const allRequirementsMet = Object.values(requirements).every(Boolean);

  useEffect(() => {
    const code = searchParams.get('oobCode');
    if (code) {
      setOobCode(code);
      verifyCode(code);
    } else {
      setIsVerifying(false);
      setError('Invalid reset link. Please request a new password reset.');
    }
  }, [searchParams]);

  const verifyCode = async (code: string) => {
    try {
      await verifyPasswordResetCode(auth, code);
      setIsValidCode(true);
      setIsVerifying(false);
    } catch (error: any) {
      setIsVerifying(false);
      if (error.code === 'auth/expired-action-code') {
        setError('The reset link has expired. Please request a new one.');
      } else if (error.code === 'auth/invalid-action-code') {
        setError('Invalid reset link. Please request a new one.');
      } else {
        setError('Failed to verify reset link. Please try again.');
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (!allRequirementsMet) {
      setError('Please meet all password requirements.');
      return;
    }

    setIsLoading(true);

    try {
      await verifyPasswordResetCode(auth, oobCode);
      await confirmPasswordReset(auth, oobCode, newPassword);
      setSuccess(true);
      setTimeout(() => {
        navigate('/login');
      }, 3000);
    } catch (error: any) {
      if (error.code === 'auth/expired-action-code') {
        setError('The reset link has expired. Please request a new one.');
      } else if (error.code === 'auth/invalid-action-code') {
        setError('Invalid reset link. Please request a new one.');
      } else {
        setError('Failed to reset password. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const getStrengthLevel = () => {
    const met = Object.values(requirements).filter(Boolean).length;
    if (met === 0) return { level: 'None', color: '#e5e7eb', width: '0%' };
    if (met <= 2) return { level: 'Weak', color: '#ef4444', width: '20%' };
    if (met <= 3) return { level: 'Fair', color: '#f59e0b', width: '40%' };
    if (met <= 4) return { level: 'Good', color: '#3b82f6', width: '70%' };
    return { level: 'Strong', color: '#22c55e', width: '100%' };
  };

  const strength = getStrengthLevel();

  if (isVerifying) {
    return (
      <div className="reset-password-container">
        <div className="reset-password-card">
          <div className="loading-spinner-container">
            <div className="loading-spinner"></div>
            <p>Verifying reset link...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isValidCode) {
    return (
      <div className="reset-password-container">
        <div className="reset-password-card">
          <div className="error-icon">🔒</div>
          <h2>Invalid Reset Link</h2>
          <p className="error-description">{error || 'The reset link is invalid or has expired.'}</p>
          <button className="return-btn" onClick={() => navigate('/login')}>
            Return to Login
          </button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="reset-password-container">
        <div className="reset-password-card success-card">
          <div className="success-icon">✅</div>
          <h2>Password Reset Successful</h2>
          <p className="success-description">
            Your password has been changed successfully.<br />
            You can now sign in with your new password.
          </p>
          <button className="return-btn" onClick={() => navigate('/login')}>
            Return to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="reset-password-container">
      <div className="reset-password-card">
        <div className="reset-header">
          <div className="lock-icon">🔐</div>
          <h2>Reset Password</h2>
          <p>Create a new password for your account.</p>
        </div>

        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleSubmit} className="reset-form">
          <div className="form-group">
            <label>New Password</label>
            <div className="password-input-wrapper">
              <input
                type={showPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                className={newPassword.length > 0 ? 'has-value' : ''}
                disabled={isLoading}
              />
              <button
                type="button"
                className="toggle-password-btn"
                onClick={() => setShowPassword(!showPassword)}
                disabled={isLoading}
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          {/* Password Strength Indicator */}
          {newPassword.length > 0 && (
            <div className="strength-indicator">
              <div className="strength-bar">
                <div
                  className="strength-fill"
                  style={{
                    width: strength.width,
                    backgroundColor: strength.color,
                    transition: 'all 0.3s ease'
                  }}
                />
              </div>
              <span className="strength-text" style={{ color: strength.color }}>
                {strength.level} Password
              </span>
            </div>
          )}

          {/* Password Requirements */}
          <div className="requirements-container">
            <p className="requirements-title">Password Requirements</p>
            <div className="requirements-list">
              <div className={`requirement-item ${requirements.length ? 'met' : ''}`}>
                <span className="req-icon">{requirements.length ? '✓' : '○'}</span>
                <span>At least 12 characters</span>
              </div>
              <div className={`requirement-item ${requirements.uppercase ? 'met' : ''}`}>
                <span className="req-icon">{requirements.uppercase ? '✓' : '○'}</span>
                <span>One uppercase letter</span>
              </div>
              <div className={`requirement-item ${requirements.lowercase ? 'met' : ''}`}>
                <span className="req-icon">{requirements.lowercase ? '✓' : '○'}</span>
                <span>One lowercase letter</span>
              </div>
              <div className={`requirement-item ${requirements.number ? 'met' : ''}`}>
                <span className="req-icon">{requirements.number ? '✓' : '○'}</span>
                <span>One number</span>
              </div>
              <div className={`requirement-item ${requirements.special ? 'met' : ''}`}>
                <span className="req-icon">{requirements.special ? '✓' : '○'}</span>
                <span>One special character (!@#$%^&*)</span>
              </div>
            </div>
          </div>

          <div className="form-group">
            <label>Confirm New Password</label>
            <div className="password-input-wrapper">
              <input
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                className={confirmPassword.length > 0 ? 'has-value' : ''}
                disabled={isLoading}
              />
              <button
                type="button"
                className="toggle-password-btn"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                disabled={isLoading}
              >
                {showConfirmPassword ? '🙈' : '👁️'}
              </button>
            </div>
            {confirmPassword.length > 0 && newPassword !== confirmPassword && (
              <span className="match-error">Passwords do not match</span>
            )}
            {confirmPassword.length > 0 && newPassword === confirmPassword && (
              <span className="match-success">✓ Passwords match</span>
            )}
          </div>

          <button
            type="submit"
            className={`reset-btn ${allRequirementsMet && newPassword === confirmPassword && newPassword.length > 0 ? 'active' : ''}`}
            disabled={!allRequirementsMet || newPassword !== confirmPassword || newPassword.length === 0 || isLoading}
          >
            {isLoading ? 'Resetting...' : 'Reset Password'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ResetPassword;