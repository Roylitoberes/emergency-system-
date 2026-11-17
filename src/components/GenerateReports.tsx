import React, { useState } from 'react';

interface Report {
  id: string;
  title: string;
  description: string;
  icon: string;
  type: 'pdf' | 'csv' | 'excel' | 'chart';
  color: string;
}

interface GenerateReportsProps {
  incidents?: any[];
  responders?: any[];
}

const GenerateReports: React.FC<GenerateReportsProps> = ({ incidents = [], responders = [] }) => {
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'month' | 'year' | 'custom'>('month');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [reportFormat, setReportFormat] = useState<'pdf' | 'csv' | 'excel'>('pdf');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedReportUrl, setGeneratedReportUrl] = useState<string | null>(null);

  const reportTypes: Report[] = [
    { id: 'incident-summary', title: 'Incident Summary Report', description: 'Monthly incident statistics, trends, and analysis', icon: '📋', type: 'pdf', color: 'red' },
    { id: 'responder-performance', title: 'Responder Performance', description: 'Response times, efficiency metrics, and team performance', icon: '📈', type: 'pdf', color: 'blue' },
    { id: 'severity-analysis', title: 'Severity Analysis', description: 'Breakdown of incidents by severity level', icon: '⚠️', type: 'chart', color: 'orange' },
    { id: 'geographic-distribution', title: 'Geographic Distribution', description: 'Incident heat map by location', icon: '🗺️', type: 'pdf', color: 'green' },
    { id: 'response-time-trends', title: 'Response Time Trends', description: 'Average response time analysis over time', icon: '⏱️', type: 'chart', color: 'purple' },
    { id: 'resource-utilization', title: 'Resource Utilization', description: 'Responder allocation and resource usage', icon: '📊', type: 'excel', color: 'cyan' },
    { id: 'monthly-comparison', title: 'Monthly Comparison', description: 'Compare incident data across months', icon: '📅', type: 'csv', color: 'pink' },
    { id: 'custom-report', title: 'Custom Report Builder', description: 'Build your own report with custom metrics', icon: '🔧', type: 'pdf', color: 'gray' },
  ];

  const handleGenerateReport = (reportId: string) => {
    setIsGenerating(true);
    setSelectedReport(reportId);
    
    // Simulate report generation
    setTimeout(() => {
      setIsGenerating(false);
      setGeneratedReportUrl('#');
      alert(`Report generated successfully! You can now download it.`);
    }, 2000);
  };

  const handleDownload = () => {
    if (generatedReportUrl) {
      // Simulate download
      alert('Downloading report...');
      setGeneratedReportUrl(null);
    }
  };

  const handleScheduleReport = (_reportId: string) => {
    const frequency = prompt('Schedule frequency (daily/weekly/monthly):', 'weekly');
    if (frequency) {
      alert(`Report scheduled ${frequency}. You will receive it via email.`);
    }
  };

  const handleExportData = () => {
    alert('Exporting all data...');
  };

  const ReportCard: React.FC<{ report: Report }> = ({ report }) => (
    <div className={`report-card-modern ${report.color}`}>
      <div className="report-card-icon">{report.icon}</div>
      <div className="report-card-content">
        <h4>{report.title}</h4>
        <p>{report.description}</p>
      </div>
      <div className="report-card-actions">
        <button 
          className="generate-report-btn" 
          onClick={() => handleGenerateReport(report.id)}
          disabled={isGenerating && selectedReport === report.id}
        >
          {isGenerating && selectedReport === report.id ? '⏳ Generating...' : '📄 Generate'}
        </button>
        <button className="schedule-report-btn" onClick={() => handleScheduleReport(report.id)}>
          ⏰ Schedule
        </button>
      </div>
    </div>
  );

  return (
    <div className="reports-container">
      <div className="page-header">
        <div>
          <h2>📊 Generate Reports</h2>
          <p className="page-description">Create and download detailed reports and analytics</p>
        </div>
        <div className="page-actions">
          <button className="export-all-btn" onClick={handleExportData}>
            📥 Export All Data
          </button>
          <button className="scheduled-reports-btn" onClick={() => alert('View scheduled reports')}>
            📅 Scheduled Reports
          </button>
        </div>
      </div>

      {/* Report Options */}
      <div className="report-options">
        <div className="option-group">
          <label>Date Range:</label>
          <div className="date-range-buttons">
            <button className={`date-btn ${dateRange === 'today' ? 'active' : ''}`} onClick={() => setDateRange('today')}>Today</button>
            <button className={`date-btn ${dateRange === 'week' ? 'active' : ''}`} onClick={() => setDateRange('week')}>This Week</button>
            <button className={`date-btn ${dateRange === 'month' ? 'active' : ''}`} onClick={() => setDateRange('month')}>This Month</button>
            <button className={`date-btn ${dateRange === 'year' ? 'active' : ''}`} onClick={() => setDateRange('year')}>This Year</button>
            <button className={`date-btn ${dateRange === 'custom' ? 'active' : ''}`} onClick={() => setDateRange('custom')}>Custom</button>
          </div>
        </div>

        {dateRange === 'custom' && (
          <div className="custom-date-range">
            <div className="date-input">
              <label>Start Date</label>
              <input 
                type="date" 
                value={customStartDate} 
                onChange={(e) => setCustomStartDate(e.target.value)}
              />
            </div>
            <div className="date-input">
              <label>End Date</label>
              <input 
                type="date" 
                value={customEndDate} 
                onChange={(e) => setCustomEndDate(e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="option-group">
          <label>Report Format:</label>
          <div className="format-buttons">
            <button className={`format-btn ${reportFormat === 'pdf' ? 'active' : ''}`} onClick={() => setReportFormat('pdf')}>
              📄 PDF
            </button>
            <button className={`format-btn ${reportFormat === 'csv' ? 'active' : ''}`} onClick={() => setReportFormat('csv')}>
              📊 CSV
            </button>
            <button className={`format-btn ${reportFormat === 'excel' ? 'active' : ''}`} onClick={() => setReportFormat('excel')}>
              📑 Excel
            </button>
          </div>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="reports-stats">
        <div className="stat-card-mini">
          <div className="stat-icon-mini">📋</div>
          <div className="stat-info">
            <div className="stat-number">{incidents.length || 156}</div>
            <div className="stat-label">Total Incidents</div>
          </div>
        </div>
        <div className="stat-card-mini">
          <div className="stat-icon-mini">⏱️</div>
          <div className="stat-info">
            <div className="stat-number">4.2</div>
            <div className="stat-label">Avg Response (min)</div>
          </div>
        </div>
        <div className="stat-card-mini">
          <div className="stat-icon-mini">✓</div>
          <div className="stat-info">
            <div className="stat-number">94%</div>
            <div className="stat-label">Resolution Rate</div>
          </div>
        </div>
        <div className="stat-card-mini">
          <div className="stat-icon-mini">🚑</div>
          <div className="stat-info">
            <div className="stat-number">{responders.length || 24}</div>
            <div className="stat-label">Active Responders</div>
          </div>
        </div>
      </div>

      {/* Report Types Grid */}
      <div className="reports-grid-modern">
        {reportTypes.map((report) => (
          <ReportCard key={report.id} report={report} />
        ))}
      </div>

      {/* Recent Reports */}
      <div className="recent-reports">
        <div className="section-header">
          <h3>📁 Recently Generated Reports</h3>
          <button className="clear-reports-btn" onClick={() => alert('Clear recent reports')}>Clear All</button>
        </div>
        <div className="recent-reports-list">
          <div className="recent-report-item">
            <div className="report-icon-small">📋</div>
            <div className="report-info">
              <div className="report-title">Incident Summary Report - January 2024</div>
              <div className="report-date">Generated: Jan 31, 2024 • 2:30 PM</div>
            </div>
            <div className="report-actions">
              <button className="download-report-btn" onClick={handleDownload}>📥 Download</button>
              <button className="share-report-btn" onClick={() => alert('Share report')}>📧 Share</button>
            </div>
          </div>
          <div className="recent-report-item">
            <div className="report-icon-small">📈</div>
            <div className="report-info">
              <div className="report-title">Responder Performance Report - Q4 2023</div>
              <div className="report-date">Generated: Dec 31, 2023 • 11:45 AM</div>
            </div>
            <div className="report-actions">
              <button className="download-report-btn" onClick={handleDownload}>📥 Download</button>
              <button className="share-report-btn" onClick={() => alert('Share report')}>📧 Share</button>
            </div>
          </div>
          <div className="recent-report-item">
            <div className="report-icon-small">🗺️</div>
            <div className="report-info">
              <div className="report-title">Geographic Distribution - December 2023</div>
              <div className="report-date">Generated: Dec 31, 2023 • 9:15 AM</div>
            </div>
            <div className="report-actions">
              <button className="download-report-btn" onClick={handleDownload}>📥 Download</button>
              <button className="share-report-btn" onClick={() => alert('Share report')}>📧 Share</button>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Export Section */}
      <div className="quick-export">
        <div className="section-header">
          <h3>⚡ Quick Export</h3>
        </div>
        <div className="quick-export-buttons">
          <button className="quick-export-btn" onClick={() => alert('Export incidents to CSV')}>
            📋 Export Incidents
          </button>
          <button className="quick-export-btn" onClick={() => alert('Export responders to CSV')}>
            👥 Export Responders
          </button>
          <button className="quick-export-btn" onClick={() => alert('Export all data to Excel')}>
            📊 Export All Data
          </button>
          <button className="quick-export-btn" onClick={() => alert('Export backup')}>
            💾 Backup Database
          </button>
        </div>
      </div>

      {/* Generation Progress Modal */}
      {isGenerating && (
        <div className="modal-overlay">
          <div className="generation-modal">
            <div className="generation-spinner">⏳</div>
            <h3>Generating Report...</h3>
            <p>Please wait while we prepare your report</p>
            <div className="progress-bar">
              <div className="progress-fill"></div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .reports-container {
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

        .export-all-btn, .scheduled-reports-btn {
          padding: 10px 20px;
          border-radius: 12px;
          font-weight: 600;
          cursor: pointer;
          border: none;
          transition: all 0.2s;
        }

        .export-all-btn {
          background: #f1f5f9;
          color: #334155;
        }

        .scheduled-reports-btn {
          background: #3b82f6;
          color: white;
        }

        .export-all-btn:hover {
          background: #e2e8f0;
        }

        .scheduled-reports-btn:hover {
          background: #2563eb;
          transform: translateY(-1px);
        }

        /* Report Options */
        .report-options {
          background: white;
          padding: 24px;
          border-radius: 20px;
          margin-bottom: 30px;
          border: 1px solid #e2e8f0;
        }

        .option-group {
          margin-bottom: 20px;
        }

        .option-group label {
          display: block;
          font-weight: 600;
          color: #1e293b;
          margin-bottom: 12px;
        }

        .date-range-buttons, .format-buttons {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .date-btn, .format-btn {
          padding: 8px 16px;
          border-radius: 10px;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          cursor: pointer;
          transition: all 0.2s;
          font-size: 14px;
        }

        .date-btn:hover, .format-btn:hover {
          background: #e2e8f0;
        }

        .date-btn.active, .format-btn.active {
          background: #ef4444;
          color: white;
          border-color: #ef4444;
        }

        .custom-date-range {
          display: flex;
          gap: 20px;
          margin-top: 20px;
          padding-top: 20px;
          border-top: 1px solid #e2e8f0;
        }

        .date-input {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .date-input label {
          font-size: 13px;
          font-weight: 500;
          color: #64748b;
        }

        .date-input input {
          padding: 8px 12px;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          font-size: 14px;
        }

        /* Stats */
        .reports-stats {
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

        /* Reports Grid */
        .reports-grid-modern {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
          gap: 24px;
          margin-bottom: 40px;
        }

        .report-card-modern {
          background: white;
          border-radius: 20px;
          padding: 24px;
          transition: all 0.3s;
          border: 1px solid #e2e8f0;
          position: relative;
          overflow: hidden;
        }

        .report-card-modern::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 4px;
        }

        .report-card-modern.red::before { background: #ef4444; }
        .report-card-modern.blue::before { background: #3b82f6; }
        .report-card-modern.orange::before { background: #f97316; }
        .report-card-modern.green::before { background: #22c55e; }
        .report-card-modern.purple::before { background: #8b5cf6; }
        .report-card-modern.cyan::before { background: #06b6d4; }
        .report-card-modern.pink::before { background: #ec4899; }
        .report-card-modern.gray::before { background: #64748b; }

        .report-card-modern:hover {
          transform: translateY(-4px);
          box-shadow: 0 12px 24px -12px rgba(0, 0, 0, 0.15);
        }

        .report-card-icon {
          font-size: 48px;
          margin-bottom: 16px;
        }

        .report-card-content h4 {
          font-size: 18px;
          color: #1e293b;
          margin-bottom: 8px;
        }

        .report-card-content p {
          font-size: 13px;
          color: #64748b;
          margin-bottom: 20px;
          line-height: 1.5;
        }

        .report-card-actions {
          display: flex;
          gap: 10px;
        }

        .generate-report-btn, .schedule-report-btn {
          flex: 1;
          padding: 10px;
          border-radius: 10px;
          font-weight: 500;
          cursor: pointer;
          border: none;
          transition: all 0.2s;
          font-size: 13px;
        }

        .generate-report-btn {
          background: #ef4444;
          color: white;
        }

        .generate-report-btn:hover:not(:disabled) {
          background: #dc2626;
        }

        .generate-report-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .schedule-report-btn {
          background: #f1f5f9;
          color: #334155;
        }

        .schedule-report-btn:hover {
          background: #e2e8f0;
        }

        /* Recent Reports */
        .recent-reports {
          background: white;
          border-radius: 20px;
          padding: 24px;
          margin-bottom: 30px;
          border: 1px solid #e2e8f0;
        }

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }

        .section-header h3 {
          font-size: 18px;
          color: #1e293b;
        }

        .clear-reports-btn {
          padding: 6px 12px;
          border-radius: 8px;
          border: none;
          background: #f1f5f9;
          cursor: pointer;
          font-size: 12px;
        }

        .recent-reports-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .recent-report-item {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 16px;
          background: #f8fafc;
          border-radius: 12px;
          transition: all 0.2s;
        }

        .recent-report-item:hover {
          background: #f1f5f9;
        }

        .report-icon-small {
          font-size: 32px;
        }

        .report-info {
          flex: 1;
        }

        .report-title {
          font-weight: 600;
          color: #1e293b;
          margin-bottom: 4px;
        }

        .report-date {
          font-size: 12px;
          color: #64748b;
        }

        .report-actions {
          display: flex;
          gap: 8px;
        }

        .download-report-btn, .share-report-btn {
          padding: 6px 12px;
          border-radius: 8px;
          border: none;
          cursor: pointer;
          font-size: 12px;
        }

        .download-report-btn {
          background: #dcfce7;
          color: #16a34a;
        }

        .share-report-btn {
          background: #dbeafe;
          color: #2563eb;
        }

        /* Quick Export */
        .quick-export {
          background: linear-gradient(135deg, #f8fafc, #f1f5f9);
          border-radius: 20px;
          padding: 24px;
          border: 1px solid #e2e8f0;
        }

        .quick-export-buttons {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 12px;
        }

        .quick-export-btn {
          padding: 12px;
          border-radius: 12px;
          border: 1px solid #e2e8f0;
          background: white;
          cursor: pointer;
          transition: all 0.2s;
          font-weight: 500;
        }

        .quick-export-btn:hover {
          background: #ef4444;
          color: white;
          border-color: #ef4444;
          transform: translateY(-1px);
        }

        /* Generation Modal */
        .generation-modal {
          background: white;
          border-radius: 24px;
          padding: 40px;
          text-align: center;
          max-width: 400px;
          width: 90%;
        }

        .generation-spinner {
          font-size: 48px;
          animation: spin 1s linear infinite;
          margin-bottom: 20px;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .generation-modal h3 {
          font-size: 20px;
          color: #1e293b;
          margin-bottom: 10px;
        }

        .generation-modal p {
          color: #64748b;
          margin-bottom: 20px;
        }

        .progress-bar {
          height: 8px;
          background: #e2e8f0;
          border-radius: 4px;
          overflow: hidden;
        }

        .progress-fill {
          height: 100%;
          width: 70%;
          background: #ef4444;
          border-radius: 4px;
          animation: progress 2s ease-in-out infinite;
        }

        @keyframes progress {
          0% { width: 0%; }
          50% { width: 70%; }
          100% { width: 100%; }
        }

        @media (max-width: 768px) {
          .reports-grid-modern {
            grid-template-columns: 1fr;
          }
          
          .custom-date-range {
            flex-direction: column;
          }
          
          .recent-report-item {
            flex-direction: column;
            text-align: center;
          }
          
          .report-actions {
            justify-content: center;
          }
          
          .quick-export-buttons {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
};

export default GenerateReports;