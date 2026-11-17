import React, { useState } from 'react';

interface Responder {
  id: number;
  name: string;
  team: string;
  role: string;
  status: 'available' | 'on-scene' | 'en-route' | 'off-duty';
  location: string;
  phone: string;
  experience: string;
  certifications: string[];
  currentIncident?: string;
  responseCount: number;
  avgResponseTime: number;
}

interface RespondersProps {
  onAssignResponder?: (responderId: number, incidentId: string) => void;
}

const Responders: React.FC<RespondersProps> = ({ onAssignResponder }) => {
  const [selectedResponder, setSelectedResponder] = useState<Responder | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Mock responders data
  const [responders] = useState<Responder[]>([
    { 
      id: 1, 
      name: 'John Doe', 
      team: 'Team Alpha', 
      role: 'EMT', 
      status: 'available', 
      location: 'Station 1', 
      phone: '+1 234 567 8900',
      experience: '5 years',
      certifications: ['CPR', 'ACLS', 'PALS'],
      responseCount: 128,
      avgResponseTime: 4.2
    },
    { 
      id: 2, 
      name: 'Sarah Johnson', 
      team: 'Team Alpha', 
      role: 'Firefighter', 
      status: 'on-scene', 
      location: 'Downtown', 
      phone: '+1 234 567 8901',
      experience: '8 years',
      certifications: ['Firefighting I', 'Firefighting II', 'HAZMAT'],
      currentIncident: '#INC-2024-001',
      responseCount: 245,
      avgResponseTime: 3.8
    },
    { 
      id: 3, 
      name: 'Mike Chen', 
      team: 'Medic Unit 1', 
      role: 'Paramedic', 
      status: 'en-route', 
      location: 'Highway 101', 
      phone: '+1 234 567 8902',
      experience: '6 years',
      certifications: ['CPR', 'ACLS', 'PHTLS'],
      currentIncident: '#INC-2024-003',
      responseCount: 189,
      avgResponseTime: 3.5
    },
    { 
      id: 4, 
      name: 'Lisa Ray', 
      team: 'Rescue Squad', 
      role: 'Rescue Specialist', 
      status: 'available', 
      location: 'Station 2', 
      phone: '+1 234 567 8903',
      experience: '10 years',
      certifications: ['Technical Rescue', 'Swift Water', 'Confined Space'],
      responseCount: 312,
      avgResponseTime: 5.1
    },
    { 
      id: 5, 
      name: 'David Wilson', 
      team: 'Tow Team', 
      role: 'Tow Operator', 
      status: 'off-duty', 
      location: 'Home', 
      phone: '+1 234 567 8904',
      experience: '4 years',
      certifications: ['CDL', 'First Aid'],
      responseCount: 87,
      avgResponseTime: 6.2
    },
    { 
      id: 6, 
      name: 'Emma Brown', 
      team: 'Medic Unit 2', 
      role: 'EMT', 
      status: 'available', 
      location: 'Station 3', 
      phone: '+1 234 567 8905',
      experience: '3 years',
      certifications: ['CPR', 'EMT-B'],
      responseCount: 56,
      avgResponseTime: 4.5
    },
  ]);

  const getStatusIcon = (status: string) => {
    switch(status) {
      case 'available': return '🟢';
      case 'on-scene': return '🔴';
      case 'en-route': return '🟡';
      case 'off-duty': return '⚫';
      default: return '⚪';
    }
  };

  const getStatusText = (status: string) => {
    switch(status) {
      case 'available': return 'Available';
      case 'on-scene': return 'On Scene';
      case 'en-route': return 'En Route';
      case 'off-duty': return 'Off Duty';
      default: return status;
    }
  };

  const filteredResponders = responders.filter(responder => {
    const matchesStatus = filterStatus === 'all' || responder.status === filterStatus;
    const matchesSearch = responder.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         responder.team.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         responder.role.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const availableCount = responders.filter(r => r.status === 'available').length;
  const onSceneCount = responders.filter(r => r.status === 'on-scene').length;
  const enRouteCount = responders.filter(r => r.status === 'en-route').length;
  const offDutyCount = responders.filter(r => r.status === 'off-duty').length;

  const ResponderDetailsModal = ({ responder }: { responder: Responder }) => (
    <div className="modal-overlay" onClick={() => setSelectedResponder(null)}>
      <div className="modal-content responder-details-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Responder Details</h3>
          <button className="modal-close" onClick={() => setSelectedResponder(null)}>×</button>
        </div>
        <div className="modal-body">
          <div className="responder-details-header">
            <div className="responder-avatar">{responder.name.charAt(0)}</div>
            <div className="responder-header-info">
              <h4>{responder.name}</h4>
              <p className="responder-team">{responder.team} - {responder.role}</p>
              <div className="responder-status-large">
                {getStatusIcon(responder.status)} {getStatusText(responder.status)}
              </div>
            </div>
          </div>
          <div className="details-grid">
            <div className="detail-item">
              <label>📍 Current Location</label>
              <p>{responder.location}</p>
            </div>
            <div className="detail-item">
              <label>📞 Phone</label>
              <p>{responder.phone}</p>
            </div>
            <div className="detail-item">
              <label>⭐ Experience</label>
              <p>{responder.experience}</p>
            </div>
            <div className="detail-item">
              <label>📊 Total Responses</label>
              <p>{responder.responseCount} calls</p>
            </div>
            <div className="detail-item">
              <label>⏱️ Avg Response Time</label>
              <p>{responder.avgResponseTime} minutes</p>
            </div>
            {responder.currentIncident && (
              <div className="detail-item">
                <label>🚨 Current Incident</label>
                <p>{responder.currentIncident}</p>
              </div>
            )}
            <div className="detail-item full-width">
              <label>📜 Certifications</label>
              <div className="certifications-list">
                {responder.certifications.map((cert, idx) => (
                  <span key={idx} className="cert-badge">{cert}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={() => setSelectedResponder(null)}>Close</button>
          <button className="btn-primary" onClick={() => {
            if (onAssignResponder) onAssignResponder(responder.id, 'NEW_INCIDENT');
            setSelectedResponder(null);
          }}>Assign to Incident</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="responders-container">
      <div className="page-header">
        <div>
          <h2>🚑 Responder Management</h2>
          <p className="page-description">Track and manage emergency responders in real-time</p>
        </div>
        <div className="page-actions">
          <button className="assign-btn" onClick={() => alert('Open assign responder modal')}>
            + Assign Responder
          </button>
          <button className="notify-btn" onClick={() => alert('Send notification to all responders')}>
            📢 Notify All
          </button>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="responders-stats">
        <div className="stat-card-mini available">
          <div className="stat-icon-mini">🟢</div>
          <div className="stat-info">
            <div className="stat-number">{availableCount}</div>
            <div className="stat-label">Available</div>
          </div>
        </div>
        <div className="stat-card-mini on-scene">
          <div className="stat-icon-mini">🔴</div>
          <div className="stat-info">
            <div className="stat-number">{onSceneCount}</div>
            <div className="stat-label">On Scene</div>
          </div>
        </div>
        <div className="stat-card-mini en-route">
          <div className="stat-icon-mini">🟡</div>
          <div className="stat-info">
            <div className="stat-number">{enRouteCount}</div>
            <div className="stat-label">En Route</div>
          </div>
        </div>
        <div className="stat-card-mini off-duty">
          <div className="stat-icon-mini">⚫</div>
          <div className="stat-info">
            <div className="stat-number">{offDutyCount}</div>
            <div className="stat-label">Off Duty</div>
          </div>
        </div>
      </div>

      {/* Search and Filter */}
      <div className="search-filter-bar">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input 
            type="text" 
            placeholder="Search by name, team, or role..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="filter-group">
          <select 
            className="filter-select" 
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="all">All Status</option>
            <option value="available">Available</option>
            <option value="on-scene">On Scene</option>
            <option value="en-route">En Route</option>
            <option value="off-duty">Off Duty</option>
          </select>
        </div>
      </div>

      {/* Responders Grid */}
      <div className="responders-grid">
        {filteredResponders.map((responder) => (
          <div key={responder.id} className={`responder-card ${responder.status}`} onClick={() => setSelectedResponder(responder)}>
            <div className="responder-card-header">
              <div className="responder-avatar-small">{responder.name.charAt(0)}</div>
              <div className={`responder-status-indicator ${responder.status}`}>
                {getStatusIcon(responder.status)} {getStatusText(responder.status)}
              </div>
            </div>
            <div className="responder-card-body">
              <h4>{responder.name}</h4>
              <p className="responder-team">{responder.team}</p>
              <p className="responder-role">{responder.role}</p>
              <div className="responder-location">
                <span>📍</span> {responder.location}
              </div>
              {responder.currentIncident && (
                <div className="responder-current-incident">
                  <span>🚨</span> Current: {responder.currentIncident}
                </div>
              )}
            </div>
            <div className="responder-card-footer">
              <div className="responder-stats">
                <div className="stat">
                  <span>📊</span> {responder.responseCount}
                </div>
                <div className="stat">
                  <span>⏱️</span> {responder.avgResponseTime}min
                </div>
              </div>
              <button className="assign-incident-btn" onClick={(e) => {
                e.stopPropagation();
                if (onAssignResponder) onAssignResponder(responder.id, 'NEW_INCIDENT');
              }}>
                Assign to Incident
              </button>
            </div>
          </div>
        ))}
      </div>

      {filteredResponders.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🚑</div>
          <h3>No Responders Found</h3>
          <p>Try adjusting your search or filter criteria</p>
        </div>
      )}

      {selectedResponder && <ResponderDetailsModal responder={selectedResponder} />}

      <style>{`
        .responders-container {
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

        .assign-btn, .notify-btn {
          padding: 10px 20px;
          border-radius: 12px;
          font-weight: 600;
          cursor: pointer;
          border: none;
          transition: all 0.2s;
        }

        .assign-btn {
          background: #ef4444;
          color: white;
        }

        .assign-btn:hover {
          background: #dc2626;
          transform: translateY(-1px);
        }

        .notify-btn {
          background: #3b82f6;
          color: white;
        }

        .notify-btn:hover {
          background: #2563eb;
          transform: translateY(-1px);
        }

        /* Stats */
        .responders-stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
        }

        .stat-card-mini {
          background: white;
          padding: 20px;
          border-radius: 16px;
          display: flex;
          align-items: center;
          gap: 16px;
          border: 1px solid #e2e8f0;
        }

        .stat-card-mini.available { border-left: 4px solid #22c55e; }
        .stat-card-mini.on-scene { border-left: 4px solid #ef4444; }
        .stat-card-mini.en-route { border-left: 4px solid #eab308; }
        .stat-card-mini.off-duty { border-left: 4px solid #64748b; }

        .stat-icon-mini {
          width: 48px;
          height: 48px;
          background: #f1f5f9;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
        }

        .stat-number {
          font-size: 28px;
          font-weight: 700;
          color: #1e293b;
        }

        .stat-label {
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

        .search-box input {
          flex: 1;
          border: none;
          background: none;
          outline: none;
          font-size: 14px;
        }

        .filter-select {
          padding: 10px 16px;
          border-radius: 12px;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          cursor: pointer;
          font-size: 14px;
        }

        /* Responders Grid */
        .responders-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
          gap: 24px;
        }

        .responder-card {
          background: white;
          border-radius: 20px;
          overflow: hidden;
          cursor: pointer;
          transition: all 0.3s;
          border: 1px solid #e2e8f0;
        }

        .responder-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 12px 24px -12px rgba(0, 0, 0, 0.15);
        }

        .responder-card.available { border-top: 4px solid #22c55e; }
        .responder-card.on-scene { border-top: 4px solid #ef4444; }
        .responder-card.en-route { border-top: 4px solid #eab308; }
        .responder-card.off-duty { border-top: 4px solid #64748b; }

        .responder-card-header {
          padding: 20px;
          background: #f8fafc;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid #e2e8f0;
        }

        .responder-avatar-small {
          width: 48px;
          height: 48px;
          background: linear-gradient(135deg, #ef4444, #dc2626);
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: 700;
          font-size: 20px;
        }

        .responder-status-indicator {
          padding: 6px 12px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 500;
        }

        .responder-status-indicator.available {
          background: #dcfce7;
          color: #16a34a;
        }

        .responder-status-indicator.on-scene {
          background: #fee2e2;
          color: #dc2626;
        }

        .responder-status-indicator.en-route {
          background: #fef3c7;
          color: #d97706;
        }

        .responder-status-indicator.off-duty {
          background: #f1f5f9;
          color: #64748b;
        }

        .responder-card-body {
          padding: 20px;
        }

        .responder-card-body h4 {
          font-size: 18px;
          color: #1e293b;
          margin-bottom: 6px;
        }

        .responder-team, .responder-role {
          font-size: 13px;
          color: #64748b;
          margin-bottom: 4px;
        }

        .responder-location, .responder-current-incident {
          font-size: 13px;
          color: #475569;
          margin-top: 8px;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .responder-current-incident {
          background: #fef3c7;
          padding: 6px 10px;
          border-radius: 8px;
          margin-top: 10px;
        }

        .responder-card-footer {
          padding: 16px 20px;
          background: #fafcff;
          border-top: 1px solid #e2e8f0;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .responder-stats {
          display: flex;
          gap: 16px;
        }

        .responder-stats .stat {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 13px;
          color: #475569;
        }

        .assign-incident-btn {
          padding: 8px 16px;
          background: #ef4444;
          color: white;
          border: none;
          border-radius: 10px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .assign-incident-btn:hover {
          background: #dc2626;
        }

        /* Modal */
        .responder-details-modal {
          max-width: 600px;
        }

        .responder-details-header {
          display: flex;
          align-items: center;
          gap: 20px;
          margin-bottom: 24px;
          padding-bottom: 20px;
          border-bottom: 1px solid #e2e8f0;
        }

        .responder-avatar {
          width: 80px;
          height: 80px;
          background: linear-gradient(135deg, #ef4444, #dc2626);
          border-radius: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: 700;
          font-size: 36px;
        }

        .responder-header-info h4 {
          font-size: 22px;
          color: #1e293b;
          margin-bottom: 4px;
        }

        .responder-team {
          color: #64748b;
          margin-bottom: 8px;
        }

        .responder-status-large {
          display: inline-block;
          padding: 4px 12px;
          border-radius: 12px;
          font-size: 13px;
          font-weight: 500;
        }

        .details-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        .detail-item.full-width {
          grid-column: 1 / -1;
        }

        .detail-item label {
          font-size: 12px;
          color: #64748b;
          display: block;
          margin-bottom: 4px;
        }

        .detail-item p {
          color: #1e293b;
          font-weight: 500;
        }

        .certifications-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 8px;
        }

        .cert-badge {
          padding: 4px 10px;
          background: #f1f5f9;
          border-radius: 12px;
          font-size: 12px;
          color: #475569;
        }

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
          .responders-grid {
            grid-template-columns: 1fr;
          }
          
          .details-grid {
            grid-template-columns: 1fr;
          }
          
          .responder-details-header {
            flex-direction: column;
            text-align: center;
          }
        }
      `}</style>
    </div>
  );
};

export default Responders;