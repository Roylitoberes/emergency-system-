import React, { useState } from 'react';

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
}

interface IncidentReportsProps {
  incidents: Incident[];
  setSelectedIncident: (incident: Incident | null) => void;
}

const IncidentReports: React.FC<IncidentReportsProps> = ({ incidents, setSelectedIncident }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All Status');
  const [severityFilter, setSeverityFilter] = useState('All Severity');

  const filteredIncidents = incidents.filter(incident => {
    const matchesSearch = incident.id.toString().includes(searchTerm) ||
                         incident.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         incident.type.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'All Status' || incident.status === statusFilter;
    const matchesSeverity = severityFilter === 'All Severity' || incident.severity === severityFilter;
    return matchesSearch && matchesStatus && matchesSeverity;
  });

  return (
    <div className="content-page">
      <div className="page-header">
        <div>
          <h2>🚨 Incident Reports</h2>
          <p className="page-description">View and manage all emergency incident reports</p>
        </div>
        <div className="page-actions">
          <button className="export-btn">📥 Export All</button>
          <button className="refresh-btn">🔄 Refresh</button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="incident-summary">
        <div className="summary-card">
          <div className="summary-icon">📋</div>
          <div className="summary-info">
            <div className="summary-value">{incidents.length}</div>
            <div className="summary-label">Total Reports</div>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon">⏰</div>
          <div className="summary-info">
            <div className="summary-value">{incidents.filter(i => i.status === 'Pending').length}</div>
            <div className="summary-label">Pending Review</div>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon">✓</div>
          <div className="summary-info">
            <div className="summary-value">{incidents.filter(i => i.status === 'Resolved').length}</div>
            <div className="summary-label">Resolved</div>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon">🚨</div>
          <div className="summary-info">
            <div className="summary-value">{incidents.filter(i => i.severity === 'Critical').length}</div>
            <div className="summary-label">Critical</div>
          </div>
        </div>
      </div>

      {/* Search and Filter Bar */}
      <div className="search-filter-bar">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input 
            type="text" 
            placeholder="Search incidents by ID, location, or type..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="filter-group">
          <select 
            className="filter-select" 
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option>All Status</option>
            <option>Pending</option>
            <option>In Progress</option>
            <option>Resolved</option>
          </select>
          <select 
            className="filter-select"
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
          >
            <option>All Severity</option>
            <option>Critical</option>
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
          </select>
        </div>
      </div>

      {/* Incidents List */}
      <div className="incidents-list">
        {filteredIncidents.map((incident) => (
          <div key={incident.id} className="incident-report-card" onClick={() => setSelectedIncident(incident)}>
            <div className="incident-report-header">
              <div className="incident-id-badge">#{incident.id}</div>
              <div className={`incident-status-badge ${incident.status.toLowerCase().replace(' ', '-')}`}>
                {incident.status}
              </div>
              <div className={`incident-severity-badge ${incident.severity.toLowerCase()}`}>
                {incident.severity}
              </div>
            </div>
            <div className="incident-report-body">
              <div className="incident-type-large">{incident.type}</div>
              <div className="incident-details">
                <div className="detail-item">
                  <span className="detail-icon">📍</span>
                  <span>{incident.location}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-icon">📅</span>
                  <span>{new Date(incident.reportedAt).toLocaleString()}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-icon">👤</span>
                  <span>{incident.assignedTo || 'Unassigned'}</span>
                </div>
                {incident.responseTime && (
                  <div className="detail-item">
                    <span className="detail-icon">⏱️</span>
                    <span>Response: {incident.responseTime} min</span>
                  </div>
                )}
              </div>
              {incident.description && (
                <div className="incident-description-preview">
                  {incident.description}
                </div>
              )}
            </div>
            <div className="incident-report-footer">
              <button className="view-report-btn">View Full Report →</button>
              <button className="validate-report-btn">✓ Validate</button>
            </div>
          </div>
        ))}
      </div>

      {filteredIncidents.length === 0 && (
        <div className="empty-state">No incidents found matching your criteria</div>
      )}

      <style>{`
        .content-page {
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

        .export-btn, .refresh-btn {
          padding: 10px 20px;
          border-radius: 12px;
          font-weight: 500;
          cursor: pointer;
          border: none;
          transition: all 0.2s;
        }

        .export-btn {
          background: #f1f5f9;
          color: #334155;
        }

        .refresh-btn {
          background: #f1f5f9;
          color: #334155;
        }

        .export-btn:hover, .refresh-btn:hover {
          background: #e2e8f0;
        }

        /* Summary Cards */
        .incident-summary {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
        }

        .summary-card {
          background: white;
          padding: 20px;
          border-radius: 16px;
          display: flex;
          align-items: center;
          gap: 16px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
          border: 1px solid #e2e8f0;
        }

        .summary-icon {
          width: 48px;
          height: 48px;
          background: #f1f5f9;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
        }

        .summary-value {
          font-size: 28px;
          font-weight: 700;
          color: #1e293b;
        }

        .summary-label {
          font-size: 13px;
          color: #64748b;
        }

        /* Search Bar */
        .search-filter-bar {
          background: white;
          padding: 20px;
          border-radius: 16px;
          margin-bottom: 30px;
          display: flex;
          gap: 20px;
          flex-wrap: wrap;
          border: 1px solid #e2e8f0;
        }

        .search-box {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 10px;
          background: #f8fafc;
          padding: 10px 16px;
          border-radius: 12px;
          border: 1px solid #e2e8f0;
        }

        .search-icon {
          font-size: 18px;
        }

        .search-box input {
          flex: 1;
          border: none;
          background: none;
          outline: none;
          font-size: 14px;
        }

        .filter-group {
          display: flex;
          gap: 12px;
        }

        .filter-select {
          padding: 10px 16px;
          border-radius: 12px;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          cursor: pointer;
          font-size: 14px;
        }

        /* Incident Cards */
        .incidents-list {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
          gap: 24px;
        }

        .incident-report-card {
          background: white;
          border-radius: 20px;
          overflow: hidden;
          cursor: pointer;
          transition: all 0.3s;
          border: 1px solid #e2e8f0;
        }

        .incident-report-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 12px 24px -12px rgba(0, 0, 0, 0.15);
        }

        .incident-report-header {
          padding: 16px 20px;
          background: #f8fafc;
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
          border-bottom: 1px solid #e2e8f0;
        }

        .incident-id-badge {
          font-weight: 700;
          color: #1e293b;
          background: white;
          padding: 4px 10px;
          border-radius: 8px;
          font-size: 13px;
        }

        .incident-status-badge, .incident-severity-badge {
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 500;
        }

        .incident-status-badge.pending {
          background: #fef3c7;
          color: #d97706;
        }

        .incident-status-badge.resolved {
          background: #dcfce7;
          color: #16a34a;
        }

        .incident-status-badge.in-progress {
          background: #dbeafe;
          color: #2563eb;
        }

        .incident-severity-badge.critical {
          background: #fee2e2;
          color: #dc2626;
        }

        .incident-severity-badge.high {
          background: #fed7aa;
          color: #ea580c;
        }

        .incident-severity-badge.medium {
          background: #fef3c7;
          color: #d97706;
        }

        .incident-report-body {
          padding: 20px;
        }

        .incident-type-large {
          font-size: 20px;
          font-weight: 700;
          margin-bottom: 16px;
          color: #1e293b;
        }

        .incident-details {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-bottom: 16px;
        }

        .detail-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
          color: #475569;
        }

        .detail-icon {
          font-size: 14px;
          width: 20px;
        }

        .incident-description-preview {
          padding-top: 12px;
          border-top: 1px solid #e2e8f0;
          font-size: 13px;
          color: #64748b;
        }

        .incident-report-footer {
          padding: 16px 20px;
          display: flex;
          gap: 12px;
          border-top: 1px solid #e2e8f0;
          background: #fafcff;
        }

        .view-report-btn, .validate-report-btn {
          flex: 1;
          padding: 10px;
          border-radius: 10px;
          font-weight: 500;
          cursor: pointer;
          border: none;
          transition: all 0.2s;
        }

        .view-report-btn {
          background: #f1f5f9;
          color: #334155;
        }

        .validate-report-btn {
          background: #ef4444;
          color: white;
        }

        .view-report-btn:hover {
          background: #e2e8f0;
        }

        .validate-report-btn:hover {
          background: #dc2626;
        }

        .empty-state {
          text-align: center;
          padding: 60px;
          color: #94a3b8;
          background: white;
          border-radius: 20px;
        }

        @media (max-width: 768px) {
          .incidents-list {
            grid-template-columns: 1fr;
          }
          
          .search-filter-bar {
            flex-direction: column;
          }
          
          .filter-group {
            width: 100%;
          }
          
          .filter-select {
            flex: 1;
          }
        }
      `}</style>
    </div>
  );
};

export default IncidentReports;