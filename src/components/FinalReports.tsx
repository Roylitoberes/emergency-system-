import React, { useState, useMemo, useEffect } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  writeBatch,
  getDocs,
} from 'firebase/firestore';
import { firestore as db } from '../firebase';
import '../css/FinalReports.css';

// --- Types ---
export interface Incident {
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

interface FinalReportsProps {
  incidents: Incident[];
  setSelectedIncident?: (incident: Incident | null) => void;
}

interface ReportDetails {
  incidentEvent: string;
  incidentReportId: string;
  incidentType: string;
  incidentDate: string;
  incidentLocation: string;
  isLoRa: boolean;
  responderName: string;
  agency: string;
  personnelCount: string;
  contactDetails: string;
  checkInLocation: string;
  checkInOther: string;
  ciResource: string;
  ciType: string;
  ciUnit: string;
  ciLeader: string;
  ciContact: string;
  ciRemarks: string;
  vehOperator: string;
  vehKind: string;
  vehType: string;
  vehPlate: string;
  vehFuel: string;
  vehCapability: string;
  male: string;
  female: string;
  ageRange: string;
  weightRange: string;
  capabilities: string;
  assignment: string;
  manifest: string;
  pointOfOrigin: string;
  departure: string;
  departureTime: string;
  arrivalTime: string;
  completionTime: string;
  qualifications: string;
  timePrepared: string;
  actionsTaken: string;
  assessment: string;
  affected: string;
  injured: string;
  rescued: string;
  evacuated: string;
  assistance: string;
  outcome: string;
  outcomeRemarks: string;
  submittedBy: string;
  submittedAt: string;
}

interface ReportCase {
  id: string;
  originalId: number;
  type: string;
  location: string;
  reportedBy: string;
  responder: string;
  datetime: string;
  rawDate: Date;
  status: 'pending' | 'review' | 'incomplete' | 'ready' | 'completed';
  dispatch: string;
  arrival: string;
  resolution: string;
  description: string;
  actions: string;
  resources: string;
  casualties: string;
  evidence: number;
  remarks: string;
  details: ReportDetails;
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending review',
  review: 'Under review',
  incomplete: 'Incomplete',
  ready: 'Ready to generate',
  completed: 'Completed',
};

const CHECK_IN_OPTIONS = ['Base', 'Camp', 'Staging Area', 'ICP'];

// --- Icons ---
const Icons = {
  download: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  print: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  ),
  search: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  back: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  ),
  chevron: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
  trash: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  ),
  calendar: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
      <line x1="16" y1="2" x2="16" y2="6"></line>
      <line x1="8" y1="2" x2="8" y2="6"></line>
      <line x1="3" y1="10" x2="21" y2="10"></line>
    </svg>
  )
};

// --- List helpers ---
const shortId = (id: string) =>
  id.length > 12 ? `${id.slice(0, 11)}…` : id;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || '?';

// Maps an incident type to a color class (see .fr-type-badge.type-* in the CSS)
const typeClass = (type: string) => {
  const t = (type || '').toLowerCase();
  if (t.includes('flood')) return 'type-flood';
  if (t.includes('fire')) return 'type-fire';
  if (t.includes('medical')) return 'type-medical';
  if (t.includes('earthquake')) return 'type-earthquake';
  if (t.includes('typhoon') || t.includes('storm')) return 'type-typhoon';
  if (t.includes('landslide')) return 'type-landslide';
  if (t.includes('vehic') || t.includes('accident') || t.includes('crash'))
    return 'type-accident';
  if (t.includes('rescue')) return 'type-rescue';
  return 'type-unknown';
};

// --- Date helpers (local time; avoids UTC day-shifts from toISOString) ---
const pad = (n: number) => String(n).padStart(2, '0');
const toYMD = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// Safely turn a Firestore Timestamp / Date / string / number into a Date
const toDateSafe = (v: any): Date | null => {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'object' && typeof v.seconds === 'number')
    return new Date(v.seconds * 1000);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

// All report dates are shown in Philippine time, whatever the viewer's device uses
const PH_TZ = 'Asia/Manila';

const fmtDateTime = (d: Date | null) =>
  d
    ? d.toLocaleString('en-PH', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: PH_TZ,
      })
    : '—';

const fmtDate = (d: Date | null) =>
  d
    ? d.toLocaleDateString('en-PH', { dateStyle: 'medium', timeZone: PH_TZ })
    : '—';

const fmtTime = (d: Date | null) =>
  d
    ? d.toLocaleTimeString('en-PH', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: PH_TZ,
      })
    : '—';

// --- Calendar popover (opens directly under the date pill) ---
const CalendarPopover: React.FC<{
  value: string; // 'YYYY-MM-DD', a range string, or ''
  onSelect: (ymd: string) => void;
  onClear: () => void;
  onClose: () => void;
}> = ({ value, onSelect, onClear, onClose }) => {
  const selected = value.length === 10 ? value : '';
  const todayStr = toYMD(new Date());

  const [view, setView] = useState<Date>(() => {
    const base = selected ? new Date(selected + 'T00:00:00') : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const shiftMonth = (delta: number) =>
    setView((v) => new Date(v.getFullYear(), v.getMonth() + delta, 1));

  // 6 weeks x 7 days, starting on the Sunday before the 1st
  const cells = useMemo(() => {
    const start = new Date(
      view.getFullYear(),
      view.getMonth(),
      1 - view.getDay()
    );
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate() + i
      );
      return { d, ymd: toYMD(d), inMonth: d.getMonth() === view.getMonth() };
    });
  }, [view]);

  return (
    <>
      {/* click-outside backdrop */}
      <div className="fr-cal-backdrop" onClick={onClose} />

      <div className="fr-cal" role="dialog" aria-label="Select date">
        <div className="fr-cal-head">
          <span className="fr-cal-month">
            {view.toLocaleDateString('en-US', {
              month: 'long',
              year: 'numeric',
            })}{' '}
            ▾
          </span>
          <div className="fr-cal-nav">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label="Next month"
            >
              ↓
            </button>
          </div>
        </div>

        <div className="fr-cal-grid">
          {DOW.map((d) => (
            <div key={d} className="fr-cal-dow">
              {d}
            </div>
          ))}
          {cells.map(({ d, ymd, inMonth }) => (
            <button
              type="button"
              key={ymd}
              className={
                'fr-cal-day' +
                (inMonth ? '' : ' out') +
                (ymd === todayStr ? ' today' : '') +
                (ymd === selected ? ' selected' : '')
              }
              onClick={() => onSelect(ymd)}
            >
              {d.getDate()}
            </button>
          ))}
        </div>

        <div className="fr-cal-foot">
          <button type="button" onClick={onClear}>
            Clear
          </button>
          <button type="button" onClick={() => onSelect(todayStr)}>
            Today
          </button>
        </div>
      </div>
    </>
  );
};

// --- Form helpers ---
const dash = (s?: string) => (s && s.trim() ? s : '—');
const sameText = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

// A personnel count counts as "marked" when it is filled in and not zero
const isMarked = (v?: string) => !!v && v.trim() !== '' && v.trim() !== '0';

const FormCell: React.FC<{
  label: string;
  value?: string;
  wide?: boolean;
}> = ({ label, value, wide }) => (
  <div className={`frd-cell ${wide ? 'wide' : ''}`}>
    <span className="frd-label">{label}</span>
    <span className="frd-value">{dash(value)}</span>
  </div>
);

const FormSection: React.FC<{
  n: number;
  title: string;
  cols?: number;
  children: React.ReactNode;
}> = ({ n, title, cols = 4, children }) => (
  <section className="frd-section">
    <h5 className="frd-section-head">
      {n}. {title}
    </h5>
    <div
      className="frd-grid"
      style={{ ['--cols' as any]: cols } as React.CSSProperties}
    >
      {children}
    </div>
  </section>
);

const FormCheck: React.FC<{ checked: boolean; label: string }> = ({
  checked,
  label,
}) => (
  <div className={`frd-check ${checked ? 'on' : ''}`}>
    <span className="frd-box">{checked ? '✓' : ''}</span>
    {label}
  </div>
);

const ResponderFinalReportForm: React.FC<{ d: ReportDetails }> = ({ d }) => {
  const otherChecked = sameText(d.checkInLocation, 'Other') || !!d.checkInOther;

  return (
    <div className="frd-doc">
      <header className="frd-title-bar">
        <div>
          <div className="frd-org">NAGA READY · CDRRMO — Naga City</div>
          <h4 className="frd-title">Responder Final Report</h4>
        </div>
        <span className="frd-tag">Responder Final Report</span>
      </header>

      <FormSection n={1} title="Incident information">
        <FormCell
          label={d.isLoRa ? 'Vehicle Name' : 'Incident / Event'}
          value={d.incidentEvent}
        />
        <FormCell label="Incident Report ID" value={d.incidentReportId} />
        <FormCell
          label={d.isLoRa ? 'Vehicle Type' : 'Incident Type'}
          value={d.incidentType}
        />
        <FormCell label="Incident Date" value={d.incidentDate} />
        <FormCell label="Incident Location" value={d.incidentLocation} wide />
      </FormSection>

      <FormSection n={2} title="Responder information" cols={3}>
        <FormCell label="Responder / Team Leader" value={d.responderName} />
        <FormCell label="Agency / Office" value={d.agency} />
        <FormCell label="No. of Personnel" value={d.personnelCount} />
        <FormCell label="Contact Details" value={d.contactDetails} wide />
      </FormSection>

      <section className="frd-section">
        <h5 className="frd-section-head">3. Check-in location</h5>
        <div className="frd-checks">
          {CHECK_IN_OPTIONS.map((o) => (
            <FormCheck
              key={o}
              label={o}
              checked={sameText(d.checkInLocation, o)}
            />
          ))}
          <FormCheck
            label={`Other: ${d.checkInOther || '____________'}`}
            checked={otherChecked}
          />
        </div>
      </section>

      <FormSection n={4} title="Check-in information" cols={6}>
        <FormCell label="Resource" value={d.ciResource} />
        <FormCell label="Type" value={d.ciType} />
        <FormCell label="Resource / Unit" value={d.ciUnit} />
        <FormCell label="Leader" value={d.ciLeader} />
        <FormCell label="Contact" value={d.ciContact} />
        <FormCell label="Remarks" value={d.ciRemarks} />
      </FormSection>

      <FormSection n={5} title="Personnel information" cols={3}>
        <div className="frd-cell">
          <span className="frd-label">Male</span>
          <FormCheck checked={isMarked(d.male)} label="" />
        </div>
        <div className="frd-cell">
          <span className="frd-label">Female</span>
          <FormCheck checked={isMarked(d.female)} label="" />
        </div>
        <FormCell label="Weight Range" value={d.weightRange} />
      </FormSection>

      <FormSection n={6} title="Other information" cols={3}>
        <FormCell label="Incident Assignment" value={d.assignment} />
        <FormCell label="Manifest" value={d.manifest} />
        <FormCell label="Point of Origin" value={d.pointOfOrigin} />
        <FormCell label="Departure Time" value={d.departureTime} />
        <FormCell label="Arrival Time" value={d.arrivalTime} />
        <FormCell label="Completion Time" value={d.completionTime} />
      </FormSection>

      <FormSection n={7} title="Additional details" cols={1}>
        <FormCell label="Time Prepared" value={d.timePrepared} />
      </FormSection>

      <FormSection n={8} title="Final report">
        <FormCell label="Persons Affected" value={d.affected} />
        <FormCell label="Injured" value={d.injured} />
        <FormCell label="Rescued" value={d.rescued} />
        <FormCell label="Evacuated" value={d.evacuated} />
      </FormSection>

      <section className="frd-section">
        <h5 className="frd-section-head">Final outcome</h5>
        <div className="frd-checks">
          <FormCheck label="Resolved" checked={true} />
        </div>
      </section>

      <FormSection n={9} title="Submitted by" cols={3}>
        <FormCell label="Responder Name" value={d.submittedBy} />
        <div className="frd-cell">
          <span className="frd-label">Signature</span>
          <span className="frd-sign" />
        </div>
        <FormCell label="Date & Time Submitted" value={d.submittedAt} />
      </FormSection>
    </div>
  );
};

const FinalReports: React.FC<FinalReportsProps> = () => {
  const [firestoreCases, setFirestoreCases] = useState<ReportCase[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [view, setView] = useState<'list' | 'detail'>('list');

  // Filter States
  const [, setDateFilterType] = useState<string>('all');
  const [singleDate, setSingleDate] = useState<string>('');
  const [showCustomPicker, setShowCustomPicker] = useState<boolean>(false);

  const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  useEffect(() => {
    let unsubscribe = () => {};
    try {
      const q = query(
        collection(db, 'final_reports'),
        orderBy('submittedAt', 'desc')
      );

      unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const loaded: ReportCase[] = snapshot.docs.map((doc) => {
            // 'estimate' fills in a just-written serverTimestamp() right away,
            // so a brand-new report shows its time instead of a blank.
            const d: any = doc.data({ serverTimestamps: 'estimate' });

            const str = (v: any) =>
              v === undefined || v === null ? '' : String(v);

            const num = (v: any) => {
              const n = Number(v);
              return isNaN(n) ? 0 : n;
            };

            const injured = num(d.injured);
            const fatalities = num(d.fatalities);
            const personsAffected = num(d.personsAffected || d.affected);
            const rescued = num(d.rescued);
            const evacuated = num(d.evacuated);

            // Single source of truth: the real Firestore submission timestamp.
            // No `new Date()` fallback, so the time never changes on refresh.
            const submittedDate: Date | null =
              toDateSafe(d.submittedAt) ||
              toDateSafe(d.createdAt) ||
              toDateSafe(d.submittedDateTime);

            const casualtyText =
              injured === 0 &&
              fatalities === 0 &&
              personsAffected === 0 &&
              rescued === 0 &&
              evacuated === 0
                ? 'No casualties reported'
                : `${personsAffected} affected, ${injured} injured` +
                  (rescued > 0 ? `, ${rescued} rescued` : '') +
                  (evacuated > 0 ? `, ${evacuated} evacuated` : '');

            const numericId =
              Number(String(d.incidentId || '').replace(/\D/g, '')) || 0;

            const details: ReportDetails = {
              incidentEvent: str(
                d.incidentEvent ||
                  d.incidentName ||
                  d.title ||
                  d.incidentType
              ),
              incidentReportId: str(
                d.incidentReportId || d.incidentId || d.reportId
              ),
              incidentType: str(
                d.incidentCategory || d.incidentType || d.incidentName
              ),
              incidentDate: str(d.incidentDate || fmtDate(submittedDate)),
              incidentLocation: str(d.location || d.incidentLocation),
              // ✅ True when the final report came from a LoRa device
              isLoRa:
                d.isLoRa === true ||
                [d.source, d.reportedBy, d.reporterName].some((v) =>
                  String(v ?? '').toLowerCase().includes('lora')
                ),

              responderName: str(
                d.responderName || d.teamLeader || d.responder || 'Responder'
              ),
              agency: str(
                d.agency ||
                  d.agencyOffice ||
                  d.agencyName ||
                  'Naga City CDRRMO'
              ),
              personnelCount: str(
                d.personnelCount ??
                  d.numberOfPersonnel ??
                  d.numPersonnel ??
                  d.personnel
              ),
              contactDetails: str(
                d.contactNumber || d.contactDetails || d.contact
              ),

              checkInLocation: str(d.checkInLocation || d.checkIn || 'Base'),
              checkInOther: str(d.checkInOther),

              ciResource: str(
                d.resourceKind ||
                  d.unitResourceType ||
                  d.resource ||
                  'Single'
              ),
              ciType: str(
                d.resourceType ||
                  d.unitResourceType ||
                  d.ciType ||
                  'Rescue Team'
              ),
              ciUnit: str(
                d.unitName || d.vehicleUnit || d.ciUnit || 'Rescue 01'
              ),
              ciLeader: str(d.teamLeader || d.responderName || d.ciLeader),
              ciContact: str(
                d.contactNumber || d.contactDetails || d.ciContact
              ),
              ciRemarks: str(d.checkInRemarks || d.ciRemarks || 'N/A'),

              vehOperator: str(
                d.vehicleOperator || d.responderName || d.teamLeader
              ),
              vehKind: str(
                d.vehicleKind || d.unitResourceType || 'Rescue Vehicle'
              ),
              vehType: str(d.vehicleType || d.vehicleUnit || 'SUV'),
              vehPlate: str(d.plateNumber || d.vehPlate || 'N/A'),
              vehFuel: str(d.fuelType || d.vehFuel || 'Diesel'),
              vehCapability: str(
                d.vehicleCapability ||
                  d.capabilities ||
                  'Rescue / First Aid'
              ),

              male: str(
                d.maleCount ??
                  d.male ??
                  (String(d.gender || '').toLowerCase() === 'male'
                      ? (d.numberOfPersonnel ??
                          d.personnelCount ??
                          '1')
                      : '')
              ),
              female: str(
                d.femaleCount ??
                  d.female ??
                  (String(d.gender || '').toLowerCase() === 'female'
                      ? (d.numberOfPersonnel ??
                          d.personnelCount ??
                          '1')
                      : '')
              ),
              ageRange: str(d.ageRange || '20–45'),
              weightRange: str(d.weightRange || '60–80 kg'),

              capabilities: Array.isArray(d.capabilities)
                ? d.capabilities.join(', ')
                : str(
                    d.capabilities ||
                      d.specialization ||
                      'Search and Rescue, First Aid, Emergency Response'
                  ),

              assignment: str(
                d.incidentAssignment ||
                  d.assignment ||
                  d.incidentName ||
                  'Rescue Operation'
              ),
              manifest: str(d.manifest || 'Yes'),
              pointOfOrigin: str(
                d.pointOfOrigin || d.agency || 'Naga City'
              ),
              departure: str(
                d.departureTime || d.dispatchTime || d.departure || '—'
              ),
              departureTime: str(
                d.departureTime || d.dispatchTime || d.acceptedAtTime || ''
              ),
              arrivalTime: str(d.arrivalTime || d.arrivedAtTime || ''),
              completionTime: str(d.completionTime || d.resolvedTime || ''),

              qualifications: str(
                d.qualifications ||
                  d.situationAssessment ||
                  d.additionalNotes ||
                  ''
              ),
              // Time the report was prepared = real submission time (Philippine time)
              timePrepared: str(d.timePrepared || fmtTime(submittedDate)),

              actionsTaken: str(d.actionsTaken || d.actions || '—'),
              assessment: str(
                d.assessment ||
                  d.situationAssessment ||
                  d.description ||
                  '—'
              ),
              affected: str(d.affected || d.personsAffected || '0'),
              injured: str(d.injured || '0'),
              rescued: str(d.rescued || '0'),
              evacuated: str(d.evacuated || '0'),
              assistance: str(
                d.assistance ||
                  (d.otherAgenciesInvolved
                    ? d.coordinationDetails || 'Yes'
                    : d.coordinationDetails || 'N/A')
              ),

              outcome: str(
                d.incidentOutcome || d.finalOutcome || 'Transferred'
              ),
              outcomeRemarks: str(
                d.outcomeRemarks ||
                  d.remarks ||
                  d.additionalNotes ||
                  ''
              ),

              submittedBy: str(
                d.responderName || d.teamLeader || 'Responder'
              ),
              // Always the real submission date & time
              submittedAt: fmtDateTime(submittedDate),
            };

            return {
              id: `FR-${doc.id}`,
              originalId: numericId,
              type: d.incidentType || d.incidentName || 'Unknown Incident',
              location:
                d.location || d.incidentLocation || 'Unknown location',
              reportedBy:
                d.reportedBy || d.reporterName || 'System record',
              responder:
                d.responderName || d.teamLeader || 'Unassigned',
              datetime: fmtDateTime(submittedDate),
              rawDate: submittedDate ?? new Date(0),
              status: 'ready' as const,
              dispatch: d.dispatchTime || d.departureTime || '—',
              arrival: d.arrivalTime || '—',
              resolution: d.completionTime || d.resolvedTime || '—',
              description:
                d.description ||
                d.situationAssessment ||
                'No description provided.',
              actions: d.actionsTaken || '—',
              resources: d.unitName || d.vehicleUnit || '—',
              casualties: casualtyText,
              evidence: Array.isArray(d.evidencePhotos)
                ? d.evidencePhotos.length
                : 0,
              remarks: d.remarks || d.additionalNotes || '',
              details,
            };
          });

          setFirestoreCases(loaded);
          setIsLoading(false);
        },
        (err) => {
          console.error('Failed to load final_reports:', err);
          setIsLoading(false);
        }
      );
    } catch (e) {
      console.error('Error setting up final_reports listener:', e);
      setIsLoading(false);
    }

    return () => unsubscribe();
  }, []);

  const mappedIncidents: ReportCase[] = useMemo(
    () => firestoreCases,
    [firestoreCases]
  );

  const [selectedId, setSelectedId] = useState<string>(
    mappedIncidents[0]?.id || ''
  );
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');

  useEffect(() => {
    if (!mappedIncidents.find((c) => c.id === selectedId)) {
      setSelectedId(mappedIncidents[0]?.id || '');
    }
  }, [mappedIncidents, selectedId]);

  const selectedIncident = useMemo(
    () => mappedIncidents.find((i) => i.id === selectedId),
    [mappedIncidents, selectedId]
  );

  // Handle preset date filtering logic
  const handleDateTypeChange = (type: string) => {
    setDateFilterType(type);
    const now = new Date();

    if (type === 'all') {
      setSingleDate('');
    } else if (type === 'today') {
      setSingleDate(toYMD(now));
    } else if (type === 'week') {
      const firstDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - now.getDay()
      );
      setSingleDate(`${toYMD(firstDay)} to ${toYMD(now)}`);
    } else if (type === 'month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setSingleDate(`${toYMD(firstDay)} to ${toYMD(lastDay)}`);
    } else if (type === 'calendar') {
      setShowCustomPicker(true);
    }
  };

  const filteredIncidents = useMemo(() => {
    return mappedIncidents.filter((i) => {
      const matchesTerm =
        !searchTerm ||
        [i.id, i.type, i.location, i.responder]
          .join(' ')
          .toLowerCase()
          .includes(searchTerm.toLowerCase());
      const matchesChip = !statusFilter || i.status === statusFilter;

      let matchesDate = true;
      if (singleDate) {
        const incDateStr = toYMD(i.rawDate);

        if (singleDate.length === 10) {
          // Single day strict match
          matchesDate = incDateStr === singleDate;
        } else if (singleDate.includes(' to ')) {
          // Range match
          const [start, end] = singleDate.split(' to ');
          matchesDate = incDateStr >= start && incDateStr <= end;
        }
      }

      return matchesTerm && matchesChip && matchesDate;
    });
  }, [mappedIncidents, searchTerm, statusFilter, singleDate]);

  const metrics = useMemo(
    () => ({
      total: mappedIncidents.length,
      pending: mappedIncidents.filter(
        (i) => i.status === 'pending' || i.status === 'review'
      ).length,
      incomplete: mappedIncidents.filter((i) => i.status === 'incomplete')
        .length,
      ready: mappedIncidents.filter((i) => i.status === 'ready').length,
      completed: mappedIncidents.filter((i) => i.status === 'completed')
        .length,
    }),
    [mappedIncidents]
  );

  const handleSelectIncident = (id: string) => {
    setSelectedId(id);
    setView('detail');
  };

  const handleBackToList = () => {
    setView('list');
  };

  const handlePrint = () => window.print();

  // --- Clear All Functionality ---
  const confirmClearAll = () => {
    setShowDeleteModal(true);
  };

  const executeClearAll = async () => {
    setIsDeleting(true);
    try {
      const reportsRef = collection(db, 'final_reports');
      const snapshot = await getDocs(reportsRef);

      const batches = [];
      let currentBatch = writeBatch(db);
      let count = 0;

      snapshot.docs.forEach((doc) => {
        currentBatch.delete(doc.ref);
        count++;
        if (count === 500) {
          batches.push(currentBatch.commit());
          currentBatch = writeBatch(db);
          count = 0;
        }
      });

      if (count > 0) {
        batches.push(currentBatch.commit());
      }

      await Promise.all(batches);

      handleDateTypeChange('all');
      setStatusFilter('');
      setSearchTerm('');
      setShowDeleteModal(false);
    } catch (error) {
      console.error('Error clearing reports: ', error);
      alert('Failed to delete reports. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  // ============ LIST VIEW ============
  if (view === 'list') {
    return (
      <div className="fr-page">
        {/* Top bar */}
        <div className="fr-topbar">
          <div className="fr-topbar-title-group">
            <div className="fr-topbar-title-row">
              <h1 className="fr-title-main">Final Reports</h1>
            </div>
          </div>

          <div className="fr-search">
            {Icons.search}
            <input
              placeholder="Search cases…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {/* Metrics strip */}
        <div className="fr-metrics">
          {[
            { label: 'Total cases', value: metrics.total, icon: '📋', color: '#0F1F4A', bg: '#E3E9F7' },
            { label: 'Pending review', value: metrics.pending, icon: '⏳', color: '#B7862A', bg: '#F8EFD9' },
            { label: 'Incomplete', value: metrics.incomplete, icon: '⚠️', color: '#C2412F', bg: '#FBE4E0' },
            { label: 'Ready to generate', value: metrics.ready, icon: '📄', color: '#3B6DF0', bg: '#E1E9FD' },
            { label: 'Completed', value: metrics.completed, icon: '✅', color: '#0F1F4A', bg: '#E3E9F7' },
          ].map((m, idx) => (
            <div key={idx} className="fr-metric">
              <div
                className="fr-metric-icon"
                style={{ background: m.bg, color: m.color }}
              >
                {m.icon}
              </div>
              <div>
                <div className="fr-metric-num">{m.value}</div>
                <div className="fr-metric-label">{m.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Full-width table */}
        <div className="fr-list-pane-full">
          <div
            className="fr-list-head"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '16px',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexShrink: 0 }}>
              <h2 className="fr-list-title" style={{ margin: 0 }}>
                Case queue
                <span className="fr-count" style={{ marginLeft: '8px' }}>{filteredIncidents.length}</span>
              </h2>
              <p className="fr-list-sub" style={{ margin: 0 }}>
                Select a case to view the final report
              </p>
            </div>

            {/* Filter & Action Row */}
            <div
              className="fr-chip-row"
              style={{
                display: 'flex',
                alignItems: 'center',
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                borderRadius: '100px',
                padding: '4px 6px',
                height: '46px',
                flexShrink: 0,
              }}
            >
              {/* Calendar date pill + inline calendar popover */}
              <div style={{ position: 'relative', marginRight: '4px' }}>
                <div
                  onClick={() => setShowCustomPicker((v) => !v)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    background: 'var(--forest)',
                    color: '#fff',
                    borderRadius: '100px',
                    padding: '0 10px 0 14px',
                    height: '36px',
                    minWidth: '190px',
                    boxSizing: 'border-box',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ display: 'flex' }}>{Icons.calendar}</span>
                  <span style={{ flex: 1, fontSize: '13.5px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {singleDate && singleDate.length === 10
                      ? new Date(singleDate + 'T00:00:00').toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : singleDate || 'Select a date'}
                  </span>
                  {singleDate && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDateTypeChange('all');
                        setShowCustomPicker(false);
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#fff',
                        cursor: 'pointer',
                        display: 'flex',
                        padding: 0,
                      }}
                      title="Clear date"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {showCustomPicker && (
                  <CalendarPopover
                    value={singleDate}
                    onSelect={(ymd) => {
                      setSingleDate(ymd);
                      setDateFilterType('calendar');
                      setShowCustomPicker(false);
                    }}
                    onClear={() => {
                      handleDateTypeChange('all');
                      setShowCustomPicker(false);
                    }}
                    onClose={() => setShowCustomPicker(false)}
                  />
                )}
              </div>

              {/* Clear All Button */}
              <button
                className="fr-chip"
                style={{
                  color: 'var(--alert)',
                  background: 'var(--alert-soft)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginLeft: '4px',
                  height: '36px',
                  padding: '0 16px',
                  fontSize: '13.5px',
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  border: 'none',
                  borderRadius: '100px',
                }}
                onClick={confirmClearAll}
              >
                {Icons.trash} Clear All
              </button>
            </div>
          </div>

          <div
            className="fr-list-items-full"
            role="table"
            aria-label="Final reports"
          >
            <div className="fr-table-head" role="row">
              <span role="columnheader">Report ID</span>
              <span role="columnheader">Incident</span>
              <span role="columnheader">Location</span>
              <span role="columnheader" className="hide-md">Responder</span>
              <span role="columnheader" className="hide-md">Submitted</span>
              <span role="columnheader">Status</span>
              <span />
            </div>

            {isLoading && (
              <div className="fr-empty-msg">Loading reports…</div>
            )}

            {!isLoading &&
              filteredIncidents.map((inc) => (
                <div
                  key={inc.id}
                  className={`fr-row ${typeClass(inc.type)}`}
                  role="row"
                  tabIndex={0}
                  onClick={() => handleSelectIncident(inc.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSelectIncident(inc.id);
                    }
                  }}
                >
                  <div className="fr-c fr-c-id" role="cell">
                    <span className={`fr-dot status-${inc.status}`} />
                    <span className="fr-li-id" title={inc.id}>
                      {shortId(inc.id)}
                    </span>
                  </div>

                  <div className="fr-c" role="cell">
                    <span className={`fr-type-badge ${typeClass(inc.type)}`}>
                      {inc.type}
                    </span>
                  </div>

                  <div
                    className="fr-c fr-c-loc"
                    role="cell"
                    title={inc.location}
                  >
                    {inc.location}
                  </div>

                  <div className="fr-c fr-c-resp hide-md" role="cell">
                    <span className="fr-avatar">{initials(inc.responder)}</span>
                    <span className="fr-resp-name">{inc.responder}</span>
                  </div>

                  <div className="fr-c fr-c-date hide-md" role="cell">
                    {inc.datetime}
                  </div>

                  <div className="fr-c" role="cell">
                    <span className={`fr-li-status ${inc.status}`}>
                      {STATUS_LABEL[inc.status]}
                    </span>
                  </div>

                  <div className="fr-c fr-c-go" role="cell">
                    {Icons.chevron}
                  </div>
                </div>
              ))}

            {!isLoading && filteredIncidents.length === 0 && (
              <div className="fr-empty-msg">
                No final reports found for the selected criteria.
              </div>
            )}
          </div>
        </div>

        {/* --- CONFIRMATION MODAL --- */}
        {showDeleteModal && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
            <div style={{ background: '#fff', padding: '24px', borderRadius: '12px', maxWidth: '400px', width: '100%', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', color: 'var(--alert)' }}>
                <div style={{ background: 'var(--alert-soft)', padding: '8px', borderRadius: '50%', display: 'flex' }}>
                  {Icons.trash}
                </div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--ink)' }}>Clear All Reports?</h3>
              </div>
              <p style={{ margin: '0 0 24px 0', fontSize: '14px', color: 'var(--ink-soft)', lineHeight: 1.5 }}>
                Are you sure you want to delete <strong>all</strong> final reports? This action cannot be undone and will permanently remove the data from the database.
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button
                  className="fr-btn"
                  style={{ background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)' }}
                  onClick={() => setShowDeleteModal(false)}
                  disabled={isDeleting}
                >
                  Cancel
                </button>
                <button
                  className="fr-btn"
                  style={{ background: 'var(--alert)', color: '#fff' }}
                  onClick={executeClearAll}
                  disabled={isDeleting}
                >
                  {isDeleting ? 'Deleting...' : 'Yes, Delete All'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============ DETAIL VIEW ============
  return (
    <div className="fr-page">
      <div className="fr-topbar">
        <button className="fr-back-btn" onClick={handleBackToList}>
          {Icons.back} Back
        </button>
        <h1 className="fr-title">Responder Final Report</h1>
        <div className="fr-topbar-actions">
          <button className="fr-btn fr-btn-secondary" onClick={handlePrint}>
            {Icons.download} Download report
          </button>
          <button className="fr-btn fr-btn-secondary" onClick={handlePrint}>
            {Icons.print} Print report
          </button>
        </div>
      </div>

      {selectedIncident ? (
        <div className="fr-report-full">
          <ResponderFinalReportForm d={selectedIncident.details} />
        </div>
      ) : (
        <div style={{ padding: 40, color: 'var(--ink-soft)' }}>
          {isLoading ? 'Loading reports…' : 'No final reports submitted yet.'}
        </div>
      )}
    </div>
  );
};

export default FinalReports;