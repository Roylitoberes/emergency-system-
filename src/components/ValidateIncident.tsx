import React from 'react';

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

interface ValidateIncidentProps {
  incidents: Incident[];
}

const ValidateIncident: React.FC<ValidateIncidentProps> = ({ incidents }) => {
  const pendingIncidents = incidents.filter(i => i.status === 'Pending');

  return (
    <div className="content-page">
      <div className="page-header">
        <div>
          <h2>✓ Validate Incidents</h2>
          <p className="page-description">Review and validate pending incident reports</p>
        </div>
        <div className="page-actions">
          <button className="refresh-btn">🔄 Refresh</button>
        </div>
      </div>

      <div className="validate-stats">
        <div className="validate-stat-card">
          <div className="validate-stat-icon">⏰</div>
          <div className="validate-stat-info">
            <div className="validate-stat-value">{pendingIncidents.length}</div>
            <div className="validate-stat-label">Pending Validation</div>
          </div>
        </div>
        <div className="validate-stat-card">
          <div className="validate-stat-icon">✓</div>
          <div className="validate-stat-info">
            <div className="validate-stat-value">{incidents.filter(i => i.status === 'Resolved').length}</div>
            <div className="validate-stat-label">Already Validated</div>
          </div>
        </div>
        <div className="validate-stat-card">
          <div className="validate-stat-icon">🚨</div>
          <div className="validate-stat-info">
            <div className="validate-stat-value">{incidents.filter(i => i.severity === 'Critical' && i.status === 'Pending').length}</div>
            <div className="validate-stat-label">Critical Pending</div>
          </div>
        </div>
      </div>

      <div className="validate-list">
        {pendingIncidents.length > 0 ? (
          pendingIncidents.map((incident) => (
            <div key={incident.id} className="validate-card">
              <div className="validate-card-header">
                <div className="validate-warning">
                  <span>⚠️</span> Pending Validation
                </div>
                <div className="validate-priority">
                  {incident.severity === 'Critical' && '🔴 High Priority'}
                  {incident.severity === 'High' && '🟠 Medium Priority'}
                  {incident.severity === 'Medium' && '🟡 Normal Priority'}
                </div>
              </div>
              
              <div className="validate-content">
                <div className="validate-title">
                  <h4>Incident #{incident.id}</h4>
                  <span className="incident-type-badge">{incident.type}</span>
                </div>
                
                <div className="validate-details">
                  <div className="validate-detail-row">
                    <span className="validate-detail-label">📍 Location:</span>
                    <span className="validate-detail-value">{incident.location}</span>
                  </div>
                  <div className="validate-detail-row">
                    <span className="validate-detail-label">⚠️ Severity:</span>
                    <span className={`severity-badge ${incident.severity.toLowerCase()}`}>
                      {incident.severity}
                    </span>
                  </div>
                  <div className="validate-detail-row">
                    <span className="validate-detail-label">📅 Reported:</span>
                    <span className="validate-detail-value">{new Date(incident.reportedAt).toLocaleString()}</span>
                  </div>
                  <div className="validate-detail-row">
                    <span className="validate-detail-label">👤 Reported by:</span>
                    <span className="validate-detail-value">Emergency Call Center</span>
                  </div>
                  {incident.description && (
                    <div className="validate-description">
                      <span className="validate-detail-label">📝 Description:</span>
                      <p>{incident.description}</p>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="validate-actions">
                <button className="approve-btn">
                  <span>✓</span> Approve Incident
                </button>
                <button className="reject-btn">
                  <span>✗</span> Reject Incident
                </button>
                <button className="review-btn">
                  <span>🔍</span> Review Details
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="empty-state">
            <div className="empty-icon">✅</div>
            <h3>No Pending Incidents</h3>
            <p>All incidents have been validated. Great job!</p>
          </div>
        )}
      </div>

      <style>{`
        .content-page {
          max-width: 1200px;
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

        .refresh-btn {
          padding: 10px 20px;
          border-radius: 12px;
          font-weight: 500;
          cursor: pointer;
          border: none;
          background: #f1f5f9;
          color: #334155;
          transition: all 0.2s;
        }

        .refresh-btn:hover {
          background: #e2e8f0;
        }

        /* Stats Cards */
        .validate-stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
        }

        .validate-stat-card {
          background: white;
          padding: 20px;
          border-radius: 16px;
          display: flex;
          align-items: center;
          gap: 16px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
          border: 1px solid #e2e8f0;
        }

        .validate-stat-icon {
          width: 50px;
          height: 50px;
          background: linear-gradient(135deg, #fef3c7, #fde68a);
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
        }

        .validate-stat-value {
          font-size: 28px;
          font-weight: 700;
          color: #1e293b;
        }

        .validate-stat-label {
          font-size: 13px;
          color: #64748b;
        }

        /* Validate Cards */
        .validate-list {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .validate-card {
          background: white;
          border-radius: 20px;
          overflow: hidden;
          border: 1px solid #e2e8f0;
          transition: all 0.3s;
        }

        .validate-card:hover {
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
        }

        .validate-card-header {
          padding: 16px 24px;
          background: linear-gradient(135deg, #fef3c7, #fffbeb);
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid #fde68a;
          flex-wrap: wrap;
          gap: 10px;
        }

        .validate-warning {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 600;
          color: #d97706;
        }

        .validate-warning span {
          font-size: 18px;
        }

        .validate-priority {
          font-size: 13px;
          font-weight: 500;
          color: #dc2626;
        }

        .validate-content {
          padding: 24px;
        }

        .validate-title {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 20px;
          flex-wrap: wrap;
        }

        .validate-title h4 {
          font-size: 18px;
          font-weight: 700;
          color: #1e293b;
          margin: 0;
        }

        .incident-type-badge {
          padding: 4px 12px;
          background: #f1f5f9;
          border-radius: 12px;
          font-size: 13px;
          font-weight: 500;
          color: #475569;
        }

        .validate-details {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .validate-detail-row {
          display: flex;
          align-items: baseline;
          gap: 12px;
          flex-wrap: wrap;
        }

        .validate-detail-label {
          width: 100px;
          font-weight: 600;
          color: #64748b;
          font-size: 14px;
        }

        .validate-detail-value {
          color: #1e293b;
          font-size: 14px;
        }

        .validate-description {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid #e2e8f0;
        }

        .validate-description p {
          margin-top: 8px;
          color: #475569;
          line-height: 1.5;
        }

        .severity-badge {
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 500;
          display: inline-block;
        }

        .severity-badge.critical {
          background: #fee2e2;
          color: #dc2626;
        }

        .severity-badge.high {
          background: #fed7aa;
          color: #ea580c;
        }

        .severity-badge.medium {
          background: #fef3c7;
          color: #d97706;
        }

        .validate-actions {
          padding: 16px 24px;
          background: #f8fafc;
          display: flex;
          gap: 12px;
          border-top: 1px solid #e2e8f0;
        }

        .approve-btn, .reject-btn, .review-btn {
          flex: 1;
          padding: 12px;
          border-radius: 12px;
          font-weight: 600;
          cursor: pointer;
          border: none;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: all 0.2s;
        }

        .approve-btn {
          background: #22c55e;
          color: white;
        }

        .approve-btn:hover {
          background: #16a34a;
          transform: translateY(-1px);
        }

        .reject-btn {
          background: #ef4444;
          color: white;
        }

        .reject-btn:hover {
          background: #dc2626;
          transform: translateY(-1px);
        }

        .review-btn {
          background: #f1f5f9;
          color: #334155;
        }

        .review-btn:hover {
          background: #e2e8f0;
        }

        /* Empty State */
        .empty-state {
          text-align: center;
          padding: 80px 40px;
          background: white;
          border-radius: 20px;
          border: 1px solid #e2e8f0;
        }

        .empty-icon {
          font-size: 64px;
          margin-bottom: 20px;
        }

        .empty-state h3 {
          font-size: 24px;
          color: #1e293b;
          margin-bottom: 10px;
        }

        .empty-state p {
          color: #64748b;
        }

        @media (max-width: 768px) {
          .validate-actions {
            flex-direction: column;
          }
          
          .validate-card-header {
            flex-direction: column;
            align-items: flex-start;
          }
          
          .validate-stats {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
};

export default ValidateIncident;