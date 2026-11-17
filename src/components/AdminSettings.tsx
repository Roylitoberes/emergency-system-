import React, { useState } from 'react';

interface AdminSettingsProps {
  onSettingsChange?: (settings: any) => void;
}

const AdminSettings: React.FC<AdminSettingsProps> = ({ onSettingsChange }) => {
  const [activeSection, setActiveSection] = useState<'general' | 'security' | 'notifications' | 'system' | 'backup' | 'api'>('general');
  const [settings, setSettings] = useState({
    // General Settings
    systemName: 'EmergeSync',
    systemEmail: 'admin@emergency.com',
    timezone: 'America/New_York',
    dateFormat: 'MM/DD/YYYY',
    language: 'en',
    
    // Security Settings
    twoFactorAuth: true,
    sessionTimeout: 30,
    passwordExpiry: 90,
    maxLoginAttempts: 5,
    ipWhitelist: ['192.168.1.1', '10.0.0.1'],
    
    // Notification Settings
    emailAlerts: true,
    smsAlerts: true,
    pushNotifications: true,
    criticalAlertEmail: 'admin@emergency.com',
    alertThreshold: 'high',
    
    // System Settings
    maintenanceMode: false,
    debugMode: false,
    autoBackup: true,
    backupFrequency: 'daily',
    logRetention: 30,
    
    // Backup Settings
    backupLocation: '/backups/emergency-system',
    backupRetention: 90,
    encryptBackups: true,
    
    // API Settings
    apiEnabled: true,
    apiKey: '••••••••••••••••',
    rateLimit: 1000,
  });

  const [showApiKey, setShowApiKey] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ type: string; message: string } | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const handleSettingChange = (key: string, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setSaveStatus('idle');
  };

  const handleSaveSettings = () => {
    setSaveStatus('saving');
    setTimeout(() => {
      setSaveStatus('saved');
      if (onSettingsChange) onSettingsChange(settings);
      setTimeout(() => setSaveStatus('idle'), 3000);
    }, 1000);
  };

  const handleResetSettings = () => {
    setConfirmAction({
      type: 'reset',
      message: 'Are you sure you want to reset all settings to default? This action cannot be undone.'
    });
    setShowConfirmModal(true);
  };


  const handleRunBackup = () => {
    setConfirmAction({
      type: 'backup',
      message: 'Start manual system backup? This may take a few minutes.'
    });
    setShowConfirmModal(true);
  };

  const confirmActionHandler = () => {
    if (confirmAction?.type === 'reset') {
      alert('Settings reset to default!');
    } else if (confirmAction?.type === 'cache') {
      alert('Cache cleared successfully!');
    } else if (confirmAction?.type === 'backup') {
      alert('Backup completed successfully!');
    }
    setShowConfirmModal(false);
    setConfirmAction(null);
  };

  const renderGeneralSettings = () => (
    <div className="settings-section">
      <div className="settings-group">
        <h4>System Information</h4>
        <div className="settings-field">
          <label>System Name</label>
          <input 
            type="text" 
            value={settings.systemName} 
            onChange={(e) => handleSettingChange('systemName', e.target.value)}
          />
          <span className="field-hint">The name displayed throughout the system</span>
        </div>
        <div className="settings-field">
          <label>System Email</label>
          <input 
            type="email" 
            value={settings.systemEmail} 
            onChange={(e) => handleSettingChange('systemEmail', e.target.value)}
          />
          <span className="field-hint">Email address for system notifications</span>
        </div>
      </div>

      <div className="settings-group">
        <h4>Regional Settings</h4>
        <div className="settings-field">
          <label>Timezone</label>
          <select value={settings.timezone} onChange={(e) => handleSettingChange('timezone', e.target.value)}>
            <option>America/New_York</option>
            <option>America/Chicago</option>
            <option>America/Denver</option>
            <option>America/Los_Angeles</option>
            <option>Europe/London</option>
            <option>Asia/Tokyo</option>
          </select>
        </div>
        <div className="settings-field">
          <label>Date Format</label>
          <select value={settings.dateFormat} onChange={(e) => handleSettingChange('dateFormat', e.target.value)}>
            <option>MM/DD/YYYY</option>
            <option>DD/MM/YYYY</option>
            <option>YYYY-MM-DD</option>
          </select>
        </div>
        <div className="settings-field">
          <label>Language</label>
          <select value={settings.language} onChange={(e) => handleSettingChange('language', e.target.value)}>
            <option value="en">English</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
            <option value="de">German</option>
          </select>
        </div>
      </div>
    </div>
  );

  const renderSecuritySettings = () => (
    <div className="settings-section">
      <div className="settings-group">
        <h4>Authentication</h4>
        <div className="settings-field toggle-field">
          <div className="toggle-label">
            <label>Two-Factor Authentication</label>
            <span className="field-hint">Require 2FA for all admin accounts</span>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" checked={settings.twoFactorAuth} onChange={(e) => handleSettingChange('twoFactorAuth', e.target.checked)} />
            <span className="toggle-slider"></span>
          </label>
        </div>
        <div className="settings-field">
          <label>Session Timeout (minutes)</label>
          <input 
            type="number" 
            value={settings.sessionTimeout} 
            onChange={(e) => handleSettingChange('sessionTimeout', parseInt(e.target.value))}
          />
          <span className="field-hint">Auto-logout after inactivity</span>
        </div>
        <div className="settings-field">
          <label>Password Expiry (days)</label>
          <input 
            type="number" 
            value={settings.passwordExpiry} 
            onChange={(e) => handleSettingChange('passwordExpiry', parseInt(e.target.value))}
          />
          <span className="field-hint">Force password change after X days</span>
        </div>
        <div className="settings-field">
          <label>Max Login Attempts</label>
          <input 
            type="number" 
            value={settings.maxLoginAttempts} 
            onChange={(e) => handleSettingChange('maxLoginAttempts', parseInt(e.target.value))}
          />
          <span className="field-hint">Account lockout after failed attempts</span>
        </div>
      </div>

      <div className="settings-group">
        <h4>IP Whitelist</h4>
        <div className="settings-field">
          <label>Allowed IP Addresses</label>
          <textarea 
            rows={3} 
            value={settings.ipWhitelist.join('\n')} 
            onChange={(e) => handleSettingChange('ipWhitelist', e.target.value.split('\n').filter(i => i.trim()))}
            placeholder="Enter IP addresses (one per line)"
          />
          <span className="field-hint">Only these IPs can access the admin panel</span>
        </div>
      </div>
    </div>
  );

  const renderNotificationSettings = () => (
    <div className="settings-section">
      <div className="settings-group">
        <h4>Alert Channels</h4>
        <div className="settings-field toggle-field">
          <div className="toggle-label">
            <label>Email Alerts</label>
            <span className="field-hint">Send notifications via email</span>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" checked={settings.emailAlerts} onChange={(e) => handleSettingChange('emailAlerts', e.target.checked)} />
            <span className="toggle-slider"></span>
          </label>
        </div>
        <div className="settings-field toggle-field">
          <div className="toggle-label">
            <label>SMS Alerts</label>
            <span className="field-hint">Send notifications via SMS</span>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" checked={settings.smsAlerts} onChange={(e) => handleSettingChange('smsAlerts', e.target.checked)} />
            <span className="toggle-slider"></span>
          </label>
        </div>
        <div className="settings-field toggle-field">
          <div className="toggle-label">
            <label>Push Notifications</label>
            <span className="field-hint">Send push notifications to mobile devices</span>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" checked={settings.pushNotifications} onChange={(e) => handleSettingChange('pushNotifications', e.target.checked)} />
            <span className="toggle-slider"></span>
          </label>
        </div>
      </div>

      <div className="settings-group">
        <h4>Alert Settings</h4>
        <div className="settings-field">
          <label>Critical Alert Email</label>
          <input 
            type="email" 
            value={settings.criticalAlertEmail} 
            onChange={(e) => handleSettingChange('criticalAlertEmail', e.target.value)}
          />
          <span className="field-hint">Email for critical system alerts</span>
        </div>
        <div className="settings-field">
          <label>Alert Threshold</label>
          <select value={settings.alertThreshold} onChange={(e) => handleSettingChange('alertThreshold', e.target.value)}>
            <option value="low">Low - All incidents</option>
            <option value="medium">Medium - Medium severity and above</option>
            <option value="high">High - High severity and above</option>
            <option value="critical">Critical - Critical only</option>
          </select>
        </div>
      </div>
    </div>
  );

  const renderSystemSettings = () => (
    <div className="settings-section">
      <div className="settings-group">
        <h4>System Status</h4>
        <div className="settings-field toggle-field">
          <div className="toggle-label">
            <label>Maintenance Mode</label>
            <span className="field-hint warning">Users cannot access the system during maintenance</span>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" checked={settings.maintenanceMode} onChange={(e) => handleSettingChange('maintenanceMode', e.target.checked)} />
            <span className="toggle-slider"></span>
          </label>
        </div>
        <div className="settings-field toggle-field">
          <div className="toggle-label">
            <label>Debug Mode</label>
            <span className="field-hint warning">Enable detailed error logging</span>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" checked={settings.debugMode} onChange={(e) => handleSettingChange('debugMode', e.target.checked)} />
            <span className="toggle-slider"></span>
          </label>
        </div>
      </div>

      <div className="settings-group">
        <h4>Data Management</h4>
        <div className="settings-field toggle-field">
          <div className="toggle-label">
            <label>Auto Backup</label>
            <span className="field-hint">Automatically backup system data</span>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" checked={settings.autoBackup} onChange={(e) => handleSettingChange('autoBackup', e.target.checked)} />
            <span className="toggle-slider"></span>
          </label>
        </div>
        <div className="settings-field">
          <label>Backup Frequency</label>
          <select value={settings.backupFrequency} onChange={(e) => handleSettingChange('backupFrequency', e.target.value)}>
            <option value="hourly">Hourly</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        <div className="settings-field">
          <label>Log Retention (days)</label>
          <input 
            type="number" 
            value={settings.logRetention} 
            onChange={(e) => handleSettingChange('logRetention', parseInt(e.target.value))}
          />
          <span className="field-hint">How long to keep system logs</span>
        </div>
      </div>
    </div>
  );

  const renderBackupSettings = () => (
    <div className="settings-section">
      <div className="settings-group">
        <h4>Backup Configuration</h4>
        <div className="settings-field">
          <label>Backup Location</label>
          <input 
            type="text" 
            value={settings.backupLocation} 
            onChange={(e) => handleSettingChange('backupLocation', e.target.value)}
          />
          <span className="field-hint">Directory where backups will be stored</span>
        </div>
        <div className="settings-field">
          <label>Backup Retention (days)</label>
          <input 
            type="number" 
            value={settings.backupRetention} 
            onChange={(e) => handleSettingChange('backupRetention', parseInt(e.target.value))}
          />
          <span className="field-hint">How long to keep old backups</span>
        </div>
        <div className="settings-field toggle-field">
          <div className="toggle-label">
            <label>Encrypt Backups</label>
            <span className="field-hint">Encrypt backup files for security</span>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" checked={settings.encryptBackups} onChange={(e) => handleSettingChange('encryptBackups', e.target.checked)} />
            <span className="toggle-slider"></span>
          </label>
        </div>
      </div>

      <div className="settings-group">
        <h4>Manual Actions</h4>
        <button className="action-button backup" onClick={handleRunBackup}>
          💾 Run Manual Backup Now
        </button>
        <button className="action-button restore" onClick={() => alert('Restore from backup')}>
          🔄 Restore from Backup
        </button>
      </div>
    </div>
  );

  const renderApiSettings = () => (
    <div className="settings-section">
      <div className="settings-group">
        <h4>API Configuration</h4>
        <div className="settings-field toggle-field">
          <div className="toggle-label">
            <label>Enable API</label>
            <span className="field-hint">Allow external API access</span>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" checked={settings.apiEnabled} onChange={(e) => handleSettingChange('apiEnabled', e.target.checked)} />
            <span className="toggle-slider"></span>
          </label>
        </div>
        <div className="settings-field">
          <label>API Key</label>
          <div className="api-key-field">
            <input 
              type={showApiKey ? 'text' : 'password'} 
              value={settings.apiKey} 
              readOnly
            />
            <button onClick={() => setShowApiKey(!showApiKey)}>
              {showApiKey ? '🙈 Hide' : '👁️ Show'}
            </button>
            <button onClick={() => {
              const newKey = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
              handleSettingChange('apiKey', newKey);
            }}>
              🔄 Regenerate
            </button>
          </div>
          <span className="field-hint">API key for external integrations</span>
        </div>
        <div className="settings-field">
          <label>Rate Limit (requests per minute)</label>
          <input 
            type="number" 
            value={settings.rateLimit} 
            onChange={(e) => handleSettingChange('rateLimit', parseInt(e.target.value))}
          />
          <span className="field-hint">Maximum API requests per minute</span>
        </div>
      </div>
    </div>
  );

  const renderSectionContent = () => {
    switch(activeSection) {
      case 'general': return renderGeneralSettings();
      case 'security': return renderSecuritySettings();
      case 'notifications': return renderNotificationSettings();
      case 'system': return renderSystemSettings();
      case 'backup': return renderBackupSettings();
      case 'api': return renderApiSettings();
      default: return renderGeneralSettings();
    }
  };

  return (
    <div className="admin-settings-container">
      <div className="page-header">
        <div>
          <h2>⚙️ Admin Settings</h2>
          <p className="page-description">Configure system settings and preferences</p>
        </div>
        <div className="page-actions">
          <button className="reset-btn" onClick={handleResetSettings}>
            🔄 Reset to Default
          </button>
          <button className="save-btn" onClick={handleSaveSettings} disabled={saveStatus === 'saving'}>
            {saveStatus === 'saving' ? '💾 Saving...' : saveStatus === 'saved' ? '✓ Saved!' : '💾 Save Changes'}
          </button>
        </div>
      </div>

      <div className="settings-layout">
        {/* Sidebar Navigation */}
        <div className="settings-sidebar">
          <button 
            className={`settings-nav-btn ${activeSection === 'general' ? 'active' : ''}`}
            onClick={() => setActiveSection('general')}
          >
            <span>⚙️</span> General
          </button>
          <button 
            className={`settings-nav-btn ${activeSection === 'security' ? 'active' : ''}`}
            onClick={() => setActiveSection('security')}
          >
            <span>🔒</span> Security
          </button>
          <button 
            className={`settings-nav-btn ${activeSection === 'notifications' ? 'active' : ''}`}
            onClick={() => setActiveSection('notifications')}
          >
            <span>🔔</span> Notifications
          </button>
          <button 
            className={`settings-nav-btn ${activeSection === 'system' ? 'active' : ''}`}
            onClick={() => setActiveSection('system')}
          >
            <span>💻</span> System
          </button>
          <button 
            className={`settings-nav-btn ${activeSection === 'backup' ? 'active' : ''}`}
            onClick={() => setActiveSection('backup')}
          >
            <span>💾</span> Backup
          </button>
          <button 
            className={`settings-nav-btn ${activeSection === 'api' ? 'active' : ''}`}
            onClick={() => setActiveSection('api')}
          >
            <span>🔌</span> API
          </button>
        </div>

        {/* Main Content */}
        <div className="settings-content">
          {renderSectionContent()}
        </div>
      </div>

      {/* Confirm Modal */}
      {showConfirmModal && (
        <div className="modal-overlay" onClick={() => setShowConfirmModal(false)}>
          <div className="modal-content confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Confirm Action</h3>
              <button className="modal-close" onClick={() => setShowConfirmModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <p>{confirmAction?.message}</p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowConfirmModal(false)}>Cancel</button>
              <button className="btn-primary confirm-btn" onClick={confirmActionHandler}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .admin-settings-container {
          max-width: 1400px;
          margin: 0 auto;
        }

        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 30px;
          flex-wrap: wrap;
          gap: 16px;
        }

        .page-header h2 {
          font-size: 28px;
          color: #1e293b;
          margin-bottom: 8px;
        }

        .page-description {
          color: #64748b;
          font-size: 14px;
        }

        .page-actions {
          display: flex;
          gap: 12px;
        }

        .reset-btn, .save-btn {
          padding: 10px 20px;
          border-radius: 12px;
          font-weight: 600;
          cursor: pointer;
          border: none;
          transition: all 0.2s;
        }

        .reset-btn {
          background: #f1f5f9;
          color: #64748b;
        }

        .reset-btn:hover {
          background: #e2e8f0;
        }

        .save-btn {
          background: #ef4444;
          color: white;
        }

        .save-btn:hover:not(:disabled) {
          background: #dc2626;
          transform: translateY(-1px);
        }

        .save-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        /* Settings Layout */
        .settings-layout {
          display: flex;
          gap: 30px;
          background: white;
          border-radius: 24px;
          overflow: hidden;
          border: 1px solid #e2e8f0;
        }

        .settings-sidebar {
          width: 260px;
          background: #f8fafc;
          padding: 24px 12px;
          border-right: 1px solid #e2e8f0;
        }

        .settings-nav-btn {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
          padding: 12px 16px;
          background: transparent;
          border: none;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s;
          font-size: 14px;
          font-weight: 500;
          color: #475569;
          margin-bottom: 4px;
        }

        .settings-nav-btn:hover {
          background: #e2e8f0;
          color: #1e293b;
        }

        .settings-nav-btn.active {
          background: #ef4444;
          color: white;
        }

        .settings-content {
          flex: 1;
          padding: 32px;
        }

        /* Settings Sections */
        .settings-section {
          display: flex;
          flex-direction: column;
          gap: 32px;
        }

        .settings-group {
          background: #ffffff;
          border-radius: 16px;
          border: 1px solid #e2e8f0;
          padding: 24px;
        }

        .settings-group h4 {
          font-size: 18px;
          color: #1e293b;
          margin-bottom: 20px;
          padding-bottom: 12px;
          border-bottom: 1px solid #e2e8f0;
        }

        .settings-field {
          margin-bottom: 20px;
        }

        .settings-field label {
          display: block;
          font-weight: 600;
          color: #1e293b;
          margin-bottom: 8px;
          font-size: 14px;
        }

        .settings-field input:not([type="checkbox"]),
        .settings-field select,
        .settings-field textarea {
          width: 100%;
          padding: 10px 14px;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          font-size: 14px;
          transition: all 0.2s;
        }

        .settings-field input:focus,
        .settings-field select:focus,
        .settings-field textarea:focus {
          outline: none;
          border-color: #ef4444;
          box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1);
        }

        .field-hint {
          display: block;
          font-size: 12px;
          color: #64748b;
          margin-top: 6px;
        }

        .field-hint.warning {
          color: #f59e0b;
        }

        /* Toggle Switch */
        .toggle-field {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .toggle-label {
          flex: 1;
        }

        .toggle-label label {
          margin-bottom: 4px;
        }

        .toggle-switch {
          position: relative;
          display: inline-block;
          width: 50px;
          height: 26px;
        }

        .toggle-switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }

        .toggle-slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: #cbd5e1;
          transition: 0.3s;
          border-radius: 26px;
        }

        .toggle-slider:before {
          position: absolute;
          content: "";
          height: 20px;
          width: 20px;
          left: 3px;
          bottom: 3px;
          background-color: white;
          transition: 0.3s;
          border-radius: 50%;
        }

        .toggle-switch input:checked + .toggle-slider {
          background-color: #ef4444;
        }

        .toggle-switch input:checked + .toggle-slider:before {
          transform: translateX(24px);
        }

        /* API Key Field */
        .api-key-field {
          display: flex;
          gap: 8px;
        }

        .api-key-field input {
          flex: 1;
        }

        .api-key-field button {
          padding: 0 16px;
          border-radius: 10px;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          cursor: pointer;
          font-size: 13px;
          transition: all 0.2s;
        }

        .api-key-field button:hover {
          background: #e2e8f0;
        }

        /* Action Buttons */
        .action-button {
          width: 100%;
          padding: 12px;
          border-radius: 12px;
          font-weight: 600;
          cursor: pointer;
          border: none;
          margin-bottom: 12px;
          transition: all 0.2s;
        }

        .action-button.backup {
          background: #3b82f6;
          color: white;
        }

        .action-button.backup:hover {
          background: #2563eb;
        }

        .action-button.restore {
          background: #f1f5f9;
          color: #334155;
        }

        .action-button.restore:hover {
          background: #e2e8f0;
        }

        /* Confirm Modal */
        .confirm-modal {
          max-width: 450px;
        }

        .confirm-modal .modal-body {
          text-align: center;
          padding: 32px;
        }

        .confirm-modal .modal-body p {
          font-size: 16px;
          color: #1e293b;
        }

        .confirm-btn {
          background: #ef4444;
        }

        /* Responsive */
        @media (max-width: 768px) {
          .settings-layout {
            flex-direction: column;
          }
          
          .settings-sidebar {
            width: 100%;
            border-right: none;
            border-bottom: 1px solid #e2e8f0;
          }
          
          .settings-nav-btn {
            display: inline-flex;
            width: auto;
            margin: 0 4px 8px 0;
          }
          
          .settings-content {
            padding: 20px;
          }
          
          .api-key-field {
            flex-wrap: wrap;
          }
          
          .page-actions {
            width: 100%;
          }
          
          .reset-btn, .save-btn {
            flex: 1;
          }
        }
      `}</style>
    </div>
  );
};

export default AdminSettings;