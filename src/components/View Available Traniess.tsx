import React, { useState, useEffect, useMemo } from 'react';
import { firestore } from '../firebase';
import {
  collection,
  onSnapshot,
  updateDoc,
  doc,
  serverTimestamp,
  query,
  orderBy,
  runTransaction,
  deleteDoc,
  setDoc, // ✅ ADDED
} from 'firebase/firestore';
import '../css/View Available Traniess.css';

// ============================================================
// SUGGESTED OPTIONS (Naga City, Cebu)
// ============================================================
const EMERGENCY_ROLES = [
  'First Aid Responder',
  'Rescue Responder',
  'Search and Rescue (SAR)',
  'Flood Rescue Responder',
  'Fire Safety Responder',
  'Emergency Communication Support',
  'Evacuation Support',
  'Traffic / Crowd Control',
  'Logistics Support',
  'Medical Support',
  'General Emergency Volunteer',
];

const TRAINING_TYPES = [
  'Basic First Aid',
  'CPR and Basic Life Support (BLS)',
  'Basic Life Saving',
  'Search and Rescue Training',
  'Flood Rescue Training',
  'Fire Safety and Fire Response',
  'Disaster Preparedness',
  'Emergency Communication',
  'Evacuation and Crowd Management',
  'Basic Incident Command System (ICS)',
  'Emergency Response Orientation',
];

const BARANGAYS = [
  'Alfaco', 'Bairan', 'Balirong', 'Cabungahan', 'Cantao-an',
  'Central Poblacion', 'Cogon', 'Colon', 'East Poblacion', 'Inoburan',
  'Inayagan', 'Jaguimit', 'Lanas', 'Langtad', 'Lutac', 'Mainit',
  'Mayana', 'Naalad', 'North Poblacion', 'Pangdan', 'Patag',
  'South Poblacion', 'Tagjaguimit', 'Tangke', 'Tinaan', 'Tuyan',
  'Uling', 'West Poblacion',
];

interface Trainee {
  id: string;
  traineeNumber: string;
  name: string;
  role: string;
  unit: string;
  rank: string;
  lastTraining: string;
  status: 'Pending review' | 'Available' | 'Active' | 'Inactive';
  serviceNo?: string;
  eligibility?: string;
  flag?: string;
  mobile?: string;
  email?: string;
  trainingType?: string;
  trainingDate?: string;
  barangayOfResidence?: string;
  emergencyRole?: string;
  remarks?: string;
  createdAt?: any;
  updatedAt?: any;
  statusUpdatedAt?: any;
}

interface ActivityLog {
  time: string;
  message: string;
  full?: string;
}

interface ViewAvailableTraineesProps {
  trainees?: Trainee[];
}

const emptyForm = {
  traineeNumber: '',
  name: '',
  mobile: '',
  email: '',
  trainingType: '',
  trainingDate: '',
  status: 'Available' as Trainee['status'],
  barangayOfResidence: '',
  emergencyRole: '',
  remarks: '',
};

const generateNextTraineeNumber = (trainees: Trainee[], year: number): string => {
  const prefix = `TRN-${year}-`;
  const nums = trainees
    .map((t) => t.traineeNumber || '')
    .filter((id) => id.startsWith(prefix))
    .map((id) => parseInt(id.replace(prefix, ''), 10))
    .filter((n) => !isNaN(n));

  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
};

// ============================================================
// ACTIVITY LOG — helpers for Firestore timestamp formatting
// (all output forced to Philippine Time — Asia/Manila, UTC+8)
// ============================================================
const PH_TZ = 'Asia/Manila';

const toDate = (ts: any): Date | null => {
  if (!ts) return null;
  try {
    if (typeof ts?.toDate === 'function') return ts.toDate();
    if (typeof ts === 'object' && typeof ts.seconds === 'number') {
      return new Date(ts.seconds * 1000);
    }
    if (typeof ts === 'string' || typeof ts === 'number') {
      const d = new Date(ts);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Short label for the activity log:
 *  - Today (PH)  → "09:41"
 *  - Other day   → "Mar 12"
 */
const formatActivityTime = (ts: any): string => {
  const date = toDate(ts);
  if (!date) return '';

  const dayFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: PH_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const todayStr = dayFmt.format(new Date());
  const dateStr = dayFmt.format(date);

  if (todayStr === dateStr) {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: PH_TZ,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }

  return new Intl.DateTimeFormat('en-US', {
    timeZone: PH_TZ,
    month: 'short',
    day: '2-digit',
  }).format(date);
};

/**
 * Long, human-readable timestamp for tooltips:
 * e.g. "Wed, Sep 12, 2026, 09:41 AM (PHT)"
 */
const formatFullTimestamp = (ts: any): string => {
  const date = toDate(ts);
  if (!date) return '';
  const text = new Intl.DateTimeFormat('en-US', {
    timeZone: PH_TZ,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
  return `${text} (PHT)`;
};

// ============================================================
// ✅ HELPER: Log any activity to the dashboard feed
// ============================================================
const logActivity = async (payload: {
  icon: string;
  tone: string;
  title: string;
  meta: string;
}) => {
  try {
    await setDoc(doc(collection(firestore, 'activity_feed')), {
      type: 'activity',
      icon: payload.icon,
      tone: payload.tone,
      title: payload.title,
      meta: payload.meta,
      time: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Failed to log activity:', err);
  }
};

const ViewAvailableTrainees: React.FC<ViewAvailableTraineesProps> = () => {
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedId, setSelectedId] = useState<string>('');
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [modalTrainee, setModalTrainee] = useState<Trainee | null>(null);
  const [modalStatus, setModalStatus] = useState<string>('Active');

  const [showNewModal, setShowNewModal] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string>('');
  const [mobileError, setMobileError] = useState<string>('');

  // EDIT mode state
  const [editingId, setEditingId] = useState<string | null>(null);

  // 👇 Live Philippine time (updates every second)
  const [phNow, setPhNow] = useState<string>('');

  // ====== Realtime Firestore listener ======
  useEffect(() => {
    setLoading(true);
    const colRef = collection(firestore, 'trainees');
    const q = query(colRef, orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: Trainee[] = snap.docs.map((d) => {
          const data: any = d.data();
          const barangay =
            data.barangayOfResidence ||
            data.assignedBarangay ||
            data.unit ||
            '';
          return {
            id: d.id,
            traineeNumber: data.traineeNumber || data.id || '',
            name: data.name || '',
            role: data.role || 'Trainee',
            unit: barangay || '—',
            rank: data.rank || '—',
            lastTraining: data.lastTraining || data.trainingDate || '—',
            status: (data.status as Trainee['status']) || 'Available',
            serviceNo: data.serviceNo,
            eligibility: data.eligibility,
            flag: data.flag,
            mobile: data.mobile,
            email: data.email,
            trainingType: data.trainingType,
            trainingDate: data.trainingDate,
            barangayOfResidence: barangay,
            emergencyRole: data.emergencyRole,
            remarks: data.remarks,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            statusUpdatedAt: data.statusUpdatedAt,
          };
        });
        setTrainees(rows);
        setSelectedId((prev) => prev || rows[0]?.id || '');
        setLoading(false);
      },
      (err) => {
        console.error('Firestore listen error:', err);
        const unsub2 = onSnapshot(collection(firestore, 'trainees'), (snap) => {
          const rows: Trainee[] = snap.docs.map((d) => {
            const data: any = d.data();
            const barangay =
              data.barangayOfResidence ||
              data.assignedBarangay ||
              data.unit ||
              '';
            return {
              id: d.id,
              traineeNumber: data.traineeNumber || '',
              name: data.name || '',
              role: data.role || 'Trainee',
              unit: barangay || '—',
              rank: data.rank || '—',
              lastTraining: data.lastTraining || data.trainingDate || '—',
              status: (data.status as Trainee['status']) || 'Available',
              mobile: data.mobile,
              email: data.email,
              trainingType: data.trainingType,
              trainingDate: data.trainingDate,
              barangayOfResidence: barangay,
              emergencyRole: data.emergencyRole,
              remarks: data.remarks,
              createdAt: data.createdAt,
              updatedAt: data.updatedAt,
              statusUpdatedAt: data.statusUpdatedAt,
            };
          });
          setTrainees(rows);
          setSelectedId((prev) => prev || rows[0]?.id || '');
          setLoading(false);
        });
        return () => unsub2();
      }
    );
    return () => unsub();
  }, []);

  // ====== Live Philippine clock ======
  useEffect(() => {
    const tick = () => {
      setPhNow(
        new Intl.DateTimeFormat('en-US', {
          timeZone: PH_TZ,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        }).format(new Date())
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const currentYear = new Date().getFullYear();
  const nextTraineeNumber = useMemo(
    () => generateNextTraineeNumber(trainees, currentYear),
    [trainees, currentYear]
  );

  // ====== Filtering ======
  const filtered = trainees.filter((t) => {
    if (filter === 'pending' && t.status !== 'Pending review') return false;
    if (filter === 'available' && t.status !== 'Available') return false;
    if (filter === 'flagged') return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        t.traineeNumber.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        (t.unit || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const counts = {
    all: trainees.length,
    pending: trainees.filter((t) => t.status === 'Pending review').length,
    available: trainees.filter((t) => t.status === 'Available').length,
    flagged: 0,
  };

  const getTagClass = (status: string) => {
    switch (status) {
      case 'Pending review':
        return 'vot-tag pending';
      case 'Available':
        return 'vot-tag available';
      case 'Active':
        return 'vot-tag active';
      default:
        return 'vot-tag';
    }
  };

  // ====== Details Modal ======
  const openModal = (t: Trainee, e: React.MouseEvent) => {
    e.stopPropagation();
    setModalTrainee(t);
    if (t.status === 'Active') setModalStatus('Active');
    else if (t.status === 'Pending review') setModalStatus('Pending');
    else setModalStatus('Inactive');
  };

  const closeModal = () => setModalTrainee(null);

  const commitStatusChange = async () => {
    if (!modalTrainee) return;
    try {
      const newStatus: Trainee['status'] =
        modalStatus === 'Active'
          ? 'Active'
          : modalStatus === 'Pending'
          ? 'Pending review'
          : 'Inactive';
      await updateDoc(doc(firestore, 'trainees', modalTrainee.id), {
        status: newStatus,
        statusUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // ✅ Log activity for status change
      await logActivity({
        icon: 'user-cog',
        tone: newStatus === 'Active' ? 'forest' : 'clay',
        title: 'Trainee status updated',
        meta: `${modalTrainee.name} (${modalTrainee.traineeNumber}) marked as ${newStatus}`,
      });

      closeModal();
    } catch (err) {
      console.error('Failed to update status:', err);
      alert('Failed to update status. Please try again.');
    }
  };

  // ====== New Record ======
  const openNewModal = () => {
    setEditingId(null);
    setForm({ ...emptyForm, traineeNumber: nextTraineeNumber });
    setFormError('');
    setMobileError('');
    setShowNewModal(true);
  };

  // ====== Edit record ======
  const openEditModal = (t: Trainee, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(t.id);
    setForm({
      traineeNumber: t.traineeNumber,
      name: t.name,
      mobile: t.mobile || '',
      email: t.email || '',
      trainingType: t.trainingType || '',
      trainingDate: t.trainingDate || '',
      status: t.status,
      barangayOfResidence: t.barangayOfResidence || '',
      emergencyRole: t.emergencyRole || '',
      remarks: t.remarks || '',
    });
    setFormError('');
    setMobileError('');
    setShowNewModal(true);
  };

  // ====== Delete record ======
  const handleDelete = async (t: Trainee, e: React.MouseEvent) => {
    e.stopPropagation();
    if (
      !window.confirm(
        `⚠️ Delete trainee record?\n\n` +
          `Name: ${t.name}\n` +
          `ID: ${t.traineeNumber}\n\n` +
          `This action cannot be undone.`
      )
    )
      return;

    try {
      await deleteDoc(doc(firestore, 'trainees', t.id));
      if (selectedId === t.id) setSelectedId('');

      // ✅ Log activity for deletion
      await logActivity({
        icon: 'user-x',
        tone: 'clay',
        title: 'Trainee record deleted',
        meta: `${t.name} (${t.traineeNumber}) was removed from the trainee roster`,
      });
    } catch (err) {
      console.error('Failed to delete trainee:', err);
      alert('Failed to delete record. Please try again.');
    }
  };

  const closeNewModal = () => {
    setShowNewModal(false);
    setForm({ ...emptyForm });
    setFormError('');
    setMobileError('');
    setEditingId(null);
  };

  const handleFormChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;

    if (name === 'mobile') {
      const digitsOnly = value.replace(/\D/g, '').slice(0, 11);
      setForm((prev) => ({ ...prev, mobile: digitsOnly }));

      if (digitsOnly.length === 0) {
        setMobileError('');
      } else if (digitsOnly.length < 11) {
        setMobileError(
          `Mobile Number must be exactly 11 digits (you typed ${digitsOnly.length}).`
        );
      } else {
        setMobileError('');
      }
      return;
    }

    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const validateForm = (): string => {
    if (!form.name.trim()) return 'Full Name is required.';

    if (!form.mobile.trim()) return 'Mobile Number is required.';
    if (!/^\d{11}$/.test(form.mobile.trim()))
      return 'Mobile Number must be exactly 11 digits.';

    if (!form.email.trim()) return 'Email Address is required.';
    if (!/^\S+@\S+\.\S+$/.test(form.email)) return 'Email format is invalid.';

    if (!form.trainingType.trim()) return 'Training Type is required.';
    if (!form.trainingDate.trim()) return 'Training Date is required.';
    if (!form.barangayOfResidence.trim()) return 'Barangay of Residence is required.';
    if (!form.emergencyRole.trim()) return 'Emergency Role is required.';
    return '';
  };

  const submitNewTrainee = async () => {
    const err = validateForm();
    if (err) {
      setFormError(err);
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      // EDIT MODE
      if (editingId) {
        await updateDoc(doc(firestore, 'trainees', editingId), {
          name: form.name.trim(),
          mobile: form.mobile.trim(),
          email: form.email.trim(),
          trainingType: form.trainingType.trim(),
          trainingDate: form.trainingDate.trim(),
          status: form.status,
          barangayOfResidence: form.barangayOfResidence.trim(),
          emergencyRole: form.emergencyRole.trim(),
          remarks: form.remarks.trim(),
          role: form.trainingType || 'Trainee',
          unit: form.barangayOfResidence || '—',
          lastTraining: form.trainingDate || '—',
          updatedAt: serverTimestamp(),
        });

        // ✅ Log activity for edit
        await logActivity({
          icon: 'edit',
          tone: 'gold',
          title: 'Trainee record updated',
          meta: `${form.name.trim()} (${form.traineeNumber}) details were edited`,
        });

        closeNewModal();
        return;
      }

      // CREATE MODE
      const year = new Date().getFullYear();
      const counterRef = doc(firestore, 'counters', `trainees_${year}`);
      const colRef = collection(firestore, 'trainees');

      let finalNumber = '';

      await runTransaction(firestore, async (tx) => {
        const counterSnap = await tx.get(counterRef);
        let nextSeq = 1;

        if (counterSnap.exists()) {
          const data = counterSnap.data() as any;
          nextSeq = (data.lastSeq || 0) + 1;
          tx.update(counterRef, { lastSeq: nextSeq });
        } else {
          tx.set(counterRef, { lastSeq: nextSeq, year });
        }

        finalNumber = `TRN-${year}-${String(nextSeq).padStart(3, '0')}`;

        const newDocRef = doc(colRef);
        tx.set(newDocRef, {
          traineeNumber: finalNumber,
          name: form.name.trim(),
          mobile: form.mobile.trim(),
          email: form.email.trim(),
          trainingType: form.trainingType.trim(),
          trainingDate: form.trainingDate.trim(),
          status: form.status,
          barangayOfResidence: form.barangayOfResidence.trim(),
          emergencyRole: form.emergencyRole.trim(),
          remarks: form.remarks.trim(),
          role: form.trainingType || 'Trainee',
          unit: form.barangayOfResidence || '—',
          rank: '—',
          lastTraining: form.trainingDate || '—',
          createdAt: serverTimestamp(),
        });
      });

      // ✅ Log activity for new trainee
      await logActivity({
        icon: 'user-plus',
        tone: 'forest',
        title: 'New trainee registered',
        meta: `${form.name.trim()} (${finalNumber}) added from Barangay ${form.barangayOfResidence}`,
      });

      closeNewModal();
    } catch (e) {
      console.error('Failed to save trainee:', e);
      setFormError('Failed to save record. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // ====== ESC key ======
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showNewModal) closeNewModal();
        else if (modalTrainee) closeModal();
      }
    };
    if (modalTrainee || showNewModal) {
      window.addEventListener('keydown', handleEsc);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [modalTrainee, showNewModal]);

  // ====== Build activity log from the currently-open trainee ======
  const buildActivityLog = (t: Trainee | null): ActivityLog[] => {
    if (!t) return [];
    const entries: ActivityLog[] = [];

    // 1) Most recent: status change
    if (t.statusUpdatedAt) {
      entries.push({
        time: formatActivityTime(t.statusUpdatedAt),
        message: `Status updated to "${t.status}" by Admin`,
        full: formatFullTimestamp(t.statusUpdatedAt),
      });
    }

    // 2) Last edit (skip if same as status change)
    if (t.updatedAt && t.updatedAt !== t.statusUpdatedAt) {
      entries.push({
        time: formatActivityTime(t.updatedAt),
        message: 'Record details updated by Admin',
        full: formatFullTimestamp(t.updatedAt),
      });
    }

    // 3) Last training logged
    if (t.trainingDate) {
      const dt = new Date(t.trainingDate);
      if (!isNaN(dt.getTime())) {
        entries.push({
          time: new Intl.DateTimeFormat('en-US', {
            timeZone: PH_TZ,
            month: 'short',
            day: '2-digit',
          }).format(dt),
          message: `Last training logged — ${t.trainingType || 'Training'}`,
          full: `${new Intl.DateTimeFormat('en-US', {
            timeZone: PH_TZ,
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: '2-digit',
          }).format(dt)} (PHT)`,
        });
      }
    }

    // 4) Record created
    if (t.createdAt) {
      entries.push({
        time: formatActivityTime(t.createdAt),
        message: 'Record added to system',
        full: formatFullTimestamp(t.createdAt),
      });
    }

    return entries;
  };

  return (
    <>
      <div className="vot-root">
        <div className="vot-main">
          {/* TOOLBAR */}
          <div className="vot-toolbar">
            <div>
              <h1>Trainees</h1>
              <div className="path">personnel.trainees.index</div>
            </div>
            <div className="vot-tb-actions">
              <button className="vot-btn">Export CSV</button>
              <button className="vot-btn primary" onClick={openNewModal}>
                + New record
              </button>
            </div>
          </div>

          {/* FLOW TABS */}
          <div className="vot-flow-tabs">
            <div className="vot-flow-tab done"><span className="n">01</span>View available</div>
            <div className="vot-flow-tab done"><span className="n">02</span>Review details</div>
            <div className="vot-flow-tab active"><span className="n">03</span>Update status</div>
            <div className="vot-flow-tab"><span className="n">04</span>Active roster</div>
          </div>

          {/* FILTER ROW */}
          <div className="vot-filter-row">
            <span className={`vot-chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>
              All ({counts.all})
            </span>
            <span className={`vot-chip ${filter === 'pending' ? 'on' : ''}`} onClick={() => setFilter('pending')}>
              Pending review ({counts.pending})
            </span>
            <span className={`vot-chip ${filter === 'available' ? 'on' : ''}`} onClick={() => setFilter('available')}>
              Available ({counts.available})
            </span>
            <span className={`vot-chip ${filter === 'flagged' ? 'on' : ''}`} onClick={() => setFilter('flagged')}>
              Flagged ({counts.flagged})
            </span>
            <div className="vot-searchbox">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="10.5" cy="10.5" r="6.5" />
                <path d="m20 20-4.3-4.3" />
              </svg>
              <input
                type="text"
                placeholder="Search ID, name, barangay"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* TABLE */}
          <div className="vot-table-wrap">
            <table className="vot-table">
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Barangay of Residence</th>
                  <th>Mobile Number</th>
                  <th>Last training</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={8}>
                      <div className="vot-empty">Loading trainees…</div>
                    </td>
                  </tr>
                )}

                {!loading && filtered.map((t) => (
                  <tr
                    key={t.id}
                    className={selectedId === t.id ? 'selected' : ''}
                    onClick={() => setSelectedId(t.id)}
                  >
                    <td><span className="vot-row-check"></span></td>
                    <td className="vot-cell-id">{t.traineeNumber}</td>
                    <td>
                      <div className="vot-cell-name">{t.name}</div>
                      <div className="vot-cell-sub">{t.role}</div>
                    </td>
                    <td>{t.barangayOfResidence || t.unit || '—'}</td>
                    <td className="vot-cell-id">{t.mobile || '—'}</td>
                    <td>{t.lastTraining}</td>
                    <td><span className={getTagClass(t.status)}>{t.status}</span></td>
                    <td>
                      <div className="vot-actions">
                        <button
                          className="vot-icon-btn view"
                          onClick={(e) => openModal(t, e)}
                          title="View Details"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        </button>

                        <button
                          className="vot-icon-btn edit"
                          onClick={(e) => openEditModal(t, e)}
                          title="Edit"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
                          </svg>
                        </button>

                        <button
                          className="vot-icon-btn delete"
                          onClick={(e) => handleDelete(t, e)}
                          title="Delete"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={8}>
                      <div className="vot-empty">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <circle cx="11" cy="11" r="7" />
                          <path d="m20 20-4.3-4.3" />
                        </svg>
                        <div>No trainees match your filters</div>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="vot-statusbar-inline">
            <span>{trainees.length} records · {filtered.length} shown</span>
            <span>Page 1 of 1</span>
          </div>
        </div>
      </div>

      {/* ===== DETAILS MODAL ===== */}
      {modalTrainee && (
        <div className="vot-modal-overlay" onClick={closeModal}>
          <div className="vot-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vot-modal-head">
              <div className="vot-modal-head-left">
                <div className="vot-modal-avatar">
                  {modalTrainee.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
                </div>
                <div className="vot-modal-title-block">
                  <div className="eyebrow">Record {modalTrainee.traineeNumber}</div>
                  <h2>{modalTrainee.name}</h2>
                  <div className="sub">
                    <span>{modalTrainee.role}</span>
                    <span className="dot"></span>
                    <span>{modalTrainee.mobile || '—'}</span>
                    <span className="dot"></span>
                    <span>{modalTrainee.barangayOfResidence || modalTrainee.unit || '—'}</span>
                  </div>
                </div>
              </div>
              <button className="vot-modal-close" onClick={closeModal} aria-label="Close">✕</button>
            </div>

            <div className="vot-modal-body">
              <div className="vot-modal-section">
                <h4>Details</h4>
                <div className="vot-details-grid">
                  <div className="vot-kv">
                    <span className="k">Mobile Number</span>
                    <span className="v">{modalTrainee.mobile || '—'}</span>
                  </div>
                  <div className="vot-kv">
                    <span className="k">Email</span>
                    <span className="v">{modalTrainee.email || '—'}</span>
                  </div>
                  <div className="vot-kv">
                    <span className="k">Training type</span>
                    <span className="v">{modalTrainee.trainingType || '—'}</span>
                  </div>
                  <div className="vot-kv">
                    <span className="k">Training date</span>
                    <span className="v">{modalTrainee.trainingDate || '—'}</span>
                  </div>
                  <div className="vot-kv">
                    <span className="k">Barangay of Residence</span>
                    <span className="v">
                      {modalTrainee.barangayOfResidence || modalTrainee.unit || '—'}
                    </span>
                  </div>
                  <div className="vot-kv">
                    <span className="k">Emergency role</span>
                    <span className="v">{modalTrainee.emergencyRole || '—'}</span>
                  </div>
                </div>
                {modalTrainee.remarks && (
                  <div className="vot-kv" style={{ marginTop: 8 }}>
                    <span className="k">Remarks</span>
                    <span className="v" style={{ whiteSpace: 'normal', fontFamily: 'inherit' }}>
                      {modalTrainee.remarks}
                    </span>
                  </div>
                )}
              </div>

              <div className="vot-modal-section">
                <h4>Update status</h4>
                <div className="vot-status-picker">
                  <button
                    className={`inactive ${modalStatus === 'Inactive' ? 'on' : ''}`}
                    onClick={() => setModalStatus('Inactive')}
                  >
                    <span className="status-dot"></span>
                    Inactive
                  </button>
                  <button
                    className={`pending ${modalStatus === 'Pending' ? 'on' : ''}`}
                    onClick={() => setModalStatus('Pending')}
                  >
                    <span className="status-dot"></span>
                    Pending
                  </button>
                  <button
                    className={`active ${modalStatus === 'Active' ? 'on' : ''}`}
                    onClick={() => setModalStatus('Active')}
                  >
                    <span className="status-dot"></span>
                    Active
                  </button>
                </div>
              </div>

              {/* ===== ACTIVITY (real Firestore times, PH timezone) ===== */}
              <div className="vot-modal-section">
                <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>Activity</span>
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontFamily: 'var(--mono)',
                      fontSize: '10.5px',
                      color: 'var(--forest)',
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                      textTransform: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                    title="Live Philippine Time"
                  >
                    <span
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: 'var(--forest)',
                        boxShadow: '0 0 0 3px rgba(47,74,59,0.15)',
                        animation: 'votPulse 2s ease-in-out infinite',
                      }}
                    />
                    {phNow} PHT
                  </span>
                </h4>
                {(() => {
                  const logs = buildActivityLog(modalTrainee);
                  if (logs.length === 0) {
                    return (
                      <div className="vot-log-item">
                        <span className="t">—</span>
                        <span>No activity recorded yet</span>
                      </div>
                    );
                  }
                  return logs.map((log, idx) => (
                    <div className="vot-log-item" key={idx} title={log.full || ''}>
                      <span className="t">{log.time}</span>
                      <span>{log.message}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>

            <div className="vot-modal-foot">
              <button className="vot-btn" onClick={closeModal}>Cancel</button>
              <button className="vot-btn primary" onClick={commitStatusChange}>
                Commit status change
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== NEW / EDIT RECORD MODAL ===== */}
      {showNewModal && (
        <div className="vot-modal-overlay" onClick={closeNewModal}>
          <div className="vot-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vot-modal-head">
              <div className="vot-modal-head-left">
                <div className="vot-modal-avatar">{editingId ? '✎' : '+'}</div>
                <div className="vot-modal-title-block">
                  <div className="eyebrow">{editingId ? 'Edit record' : 'New record'}</div>
                  <h2>{editingId ? 'Edit Trainee' : 'Add New Trainee'}</h2>
                  <div className="sub">
                    <span>{editingId ? 'Trainee No.' : 'Trainee No. will be auto-assigned:'}</span>
                    <span className="dot"></span>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--forest)', fontWeight: 700 }}>
                      {form.traineeNumber}
                    </span>
                  </div>
                </div>
              </div>
              <button className="vot-modal-close" onClick={closeNewModal} aria-label="Close">✕</button>
            </div>

            <div className="vot-modal-body">
              {/* PERSONAL */}
              <div className="vot-modal-section">
                <h4>Personal information</h4>
                <div className="vot-form-grid">
                  <div className="vot-field">
                    <label>Trainee Number / ID {editingId ? '' : '(auto)'}</label>
                    <input
                      name="traineeNumber"
                      value={form.traineeNumber}
                      readOnly
                      disabled
                      title="Auto-generated"
                    />
                  </div>
                  <div className="vot-field">
                    <label>Full Name</label>
                    <input
                      name="name"
                      value={form.name}
                      onChange={handleFormChange}
                      placeholder="Juan Dela Cruz"
                    />
                  </div>

                  <div className="vot-field">
                    <label>Mobile Number</label>
                    <input
                      name="mobile"
                      value={form.mobile}
                      onChange={handleFormChange}
                      placeholder="09XXXXXXXXX"
                      inputMode="numeric"
                      maxLength={11}
                      className={mobileError ? 'has-error' : ''}
                    />
                    {mobileError ? (
                      <div className="vot-field-hint error">{mobileError}</div>
                    ) : (
                      <div className="vot-field-hint">
                        {form.mobile.length}/11 digits
                      </div>
                    )}
                  </div>

                  <div className="vot-field">
                    <label>Email Address</label>
                    <input
                      name="email"
                      type="email"
                      value={form.email}
                      onChange={handleFormChange}
                      placeholder="juan@email.com"
                    />
                  </div>
                </div>
              </div>

              {/* TRAINING */}
              <div className="vot-modal-section">
                <h4>Training information</h4>
                <div className="vot-form-grid">

                  <div className="vot-field">
                    <label>Training Type</label>
                    <input
                      name="trainingType"
                      value={form.trainingType}
                      onChange={handleFormChange}
                      placeholder="Type or select a training type…"
                      list="trainingTypeSuggestions"
                      autoComplete="off"
                    />
                    <datalist id="trainingTypeSuggestions">
                      {TRAINING_TYPES.map((tt) => (
                        <option key={tt} value={tt} />
                      ))}
                    </datalist>
                  </div>

                  <div className="vot-field">
                    <label>Training Date</label>
                    <input
                      name="trainingDate"
                      type="date"
                      value={form.trainingDate}
                      onChange={handleFormChange}
                      onClick={(e) => (e.currentTarget as HTMLInputElement).showPicker?.()}
                    />
                  </div>

                  <div className="vot-field">
                    <label>Training Status</label>
                    <select
                      name="status"
                      value={form.status}
                      onChange={handleFormChange}
                    >
                      <option value="Available">Available</option>
                      <option value="In Training">In Training</option>
                      <option value="Pending review">Pending review</option>
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </div>

                  <div className="vot-field">
                    <label>Barangay of Residence (Naga City, Cebu)</label>
                    <input
                      name="barangayOfResidence"
                      value={form.barangayOfResidence}
                      onChange={handleFormChange}
                      placeholder="Type or select barangay of residence…"
                      list="barangaySuggestions"
                      autoComplete="off"
                    />
                    <datalist id="barangaySuggestions">
                      {BARANGAYS.map((b) => (
                        <option key={b} value={b} />
                      ))}
                    </datalist>
                  </div>

                  <div className="vot-field" style={{ gridColumn: '1 / -1' }}>
                    <label>Emergency Role</label>
                    <input
                      name="emergencyRole"
                      value={form.emergencyRole}
                      onChange={handleFormChange}
                      placeholder="Type or select an emergency role…"
                      list="emergencyRoleSuggestions"
                      autoComplete="off"
                    />
                    <datalist id="emergencyRoleSuggestions">
                      {EMERGENCY_ROLES.map((r) => (
                        <option key={r} value={r} />
                      ))}
                    </datalist>
                  </div>
                </div>
              </div>

              {/* ADDITIONAL */}
              <div className="vot-modal-section">
                <h4>Additional</h4>
                <div className="vot-field">
                  <label>Remarks</label>
                  <textarea
                    name="remarks"
                    value={form.remarks}
                    onChange={handleFormChange}
                    rows={3}
                    placeholder="Additional information…"
                  />
                </div>
              </div>

              {formError && (
                <div className="vot-form-error">{formError}</div>
              )}
            </div>

            <div className="vot-modal-foot">
              <button className="vot-btn" onClick={closeNewModal} disabled={saving}>
                Cancel
              </button>
              <button className="vot-btn primary" onClick={submitNewTrainee} disabled={saving}>
                {saving
                  ? 'Saving…'
                  : editingId
                  ? 'Save changes'
                  : 'Save record'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ViewAvailableTrainees;