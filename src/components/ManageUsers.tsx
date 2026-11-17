import React, { useState, useEffect } from 'react';
import { getAuth, createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import {
  getFirestore, doc, setDoc, updateDoc, deleteDoc, getDoc, collection, getDocs,
  query, orderBy, where, onSnapshot, Timestamp,
} from 'firebase/firestore';
import { supabase } from '../supabase';
import '../css/ManageUsers.css';

const RESPONDER_ROLES = ['Emergency Responder', 'Team Leader', 'Rescue Officer', 'Driver / Operator', 'Medical Responder', 'Search & Rescue Specialist', 'Communications Officer', 'Disaster Operations Officer'];
const TEAM_OPTIONS = ['Rescue Team', 'Medical Team', 'Search & Rescue Team', 'Fire / Rescue Team', 'Evacuation Team', 'Logistics Team', 'Communications Team'];
const CAPABILITIES_OPTIONS = ['Search and Rescue', 'First Aid', 'Medical Response', 'Emergency Transport', 'Fire Response', 'Water Rescue', 'Evacuation', 'Disaster Assessment', 'Communications'];
const PASSWORD_RULES = [
  { key: 'len',   label: 'At least 12 characters',                    test: (p: string) => p.length >= 12 },
  { key: 'upper', label: 'One uppercase letter (A–Z)',                test: (p: string) => /[A-Z]/.test(p) },
  { key: 'lower', label: 'One lowercase letter (a–z)',                test: (p: string) => /[a-z]/.test(p) },
  { key: 'num',   label: 'One number (0–9)',                          test: (p: string) => /[0-9]/.test(p) },
  { key: 'sym',   label: 'One special character (! # $ % ^ & * + =)', test: (p: string) => /[!#$%^&*+=]/.test(p) },
];

// Labels must match the Flutter app (settings_menu.dart → _kFields)
const FIELD_LABELS: Record<string, string> = {
  name: 'Full Name', gender: 'Gender', age: 'Age', civilStatus: 'Status',
  phone: 'Mobile Number', role: 'Role / Position', team: 'Team', capabilities: 'Capabilities',
};

interface User {
  id: string; name: string; role: string; email: string; status: 'active' | 'inactive';
  type: 'responder' | 'admin'; phone?: string; department?: string; profile?: string;
  uid?: string; station?: string; specialization?: string; badgeNumber?: string;
  userType?: 'eoc' | 'responder'; joinedDate?: string; isManagedUser?: boolean;
}

interface ResetRequest {
  id: string; email: string; status: 'pending' | 'link_sent' | 'completed' | 'dismissed';
  requestedAt: Timestamp | Date; requestedBy: string; userAgent?: string;
}

// Responder → "Request Profile Update" (Flutter) → profile_update_requests
interface ProfileRequest {
  id: string; requesterUid: string; email: string; responderName: string;
  changes: Record<string, string>; previous: Record<string, string>;
  fields: string[]; reason?: string; status: 'pending' | 'approved' | 'rejected';
  requestedAt: Timestamp | Date;
}

interface ManageUsersProps {
  onEOCCreating?: (creating: boolean) => void;
  onUsersLoaded?: (users: User[]) => void;
}

const timeAgo = (value: any): string => {
  let d: Date;

  if (value?.toDate) {
    d = value.toDate();
  } else if (value instanceof Date) {
    d = value;
  } else {
    d = new Date(value);
  }

  if (isNaN(d.getTime())) return 'just now';

  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  };

  return d.toLocaleString('en-US', options);
};

const EMPTY_FORM = {
  name: '', role: '', email: '', phone: '', department: '', station: '',
  badgeNumber: '', specialization: '', profile: '', password: '', confirmPassword: '',
  firstName: '', lastName: '', responderId: '', team: '',
  gender: '', age: '', capabilities: '', status: '',
};

interface ComboFieldProps {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  required?: boolean;
}

// Typeable input that always shows the full suggestion list on focus.
// Typing filters the list; the user can still enter any custom value.
const ComboField: React.FC<ComboFieldProps> = ({ label, value, options, onChange, required = false }) => {
  const [open, setOpen] = useState(false);
  const [filtering, setFiltering] = useState(false);

  const q = value.trim().toLowerCase();
  // Only filter while the user is actively typing — never on focus/click
  const visible = filtering && q ? options.filter(o => o.toLowerCase().includes(q)) : options;

  const pick = (o: string) => { onChange(o); setOpen(false); setFiltering(false); };

  return (
    <div className="form-group">
      <label>{label}{required && <span className="required">*</span>}</label>
      <div className="combo-wrap">
        <input
          type="text"
          className="combo-input"
          value={value}
          placeholder={`Type or select ${label.toLowerCase()}`}
          autoComplete="off"
          required={required}
          onFocus={() => { setFiltering(false); setOpen(true); }}
          onClick={() => { if (!open) { setFiltering(false); setOpen(true); } }}
          onChange={(e) => { onChange(e.target.value); setFiltering(true); setOpen(true); }}
          onBlur={() => { setOpen(false); setFiltering(false); }}
          onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); setFiltering(false); } }}
        />
        {open && visible.length > 0 && (
          <ul className="combo-list" role="listbox">
            {visible.map(o => (
              <li
                key={o}
                role="option"
                aria-selected={o === value}
                className={`combo-option ${o === value ? 'selected' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              >
                {o}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

const ManageUsers: React.FC<ManageUsersProps> = ({ onEOCCreating, onUsersLoaded }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingImage, setUploadingImage] = useState(false);

  const [resetRequests, setResetRequests] = useState<ResetRequest[]>([]);
  const [showResetRequests, setShowResetRequests] = useState(false);

  // ---- Profile update requests (from the responder app) ----
  const [profileRequests, setProfileRequests] = useState<ProfileRequest[]>([]);
  const [reviewRequest, setReviewRequest] = useState<ProfileRequest | null>(null);
  const [editOriginal, setEditOriginal] = useState<Record<string, string>>({});

  const [showModal, setShowModal] = useState(false);
  const [showUserTypeModal, setShowUserTypeModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showPasswordRules, setShowPasswordRules] = useState(false);

  const [showResetLinkModal, setShowResetLinkModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<ResetRequest | null>(null);
  const [isSendingLink, setIsSendingLink] = useState(false);
  const [resetLinkError, setResetLinkError] = useState('');
  const [resetLinkSuccess, setResetLinkSuccess] = useState(false);

  // ---- View / Edit details modal ----
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [detailsUser, setDetailsUser] = useState<User | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editData, setEditData] = useState<any>({});
  const [editPhoneError, setEditPhoneError] = useState('');

  const [selectedUserType, setSelectedUserType] = useState<'eoc' | 'responder' | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [roleFilter, setRoleFilter] = useState<string>('all');

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [pwFocused, setPwFocused] = useState(false); // live password checklist
  const [isCreating, setIsCreating] = useState(false);
  const [createdUser, setCreatedUser] = useState<{ name: string; email: string; password: string; role: string; userType: 'eoc' | 'responder'; } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [phoneError, setPhoneError] = useState<string>('');

  // @ts-ignore
  const [currentPage, setCurrentPage] = useState(1);
  const usersPerPage = 10;

  const [formData, setFormData] = useState({ ...EMPTY_FORM });

  // ---- Form helpers (Add User modal) ----
  const [previewUrl, setPreviewUrl] = useState<string>('');
  useEffect(() => {
    if (!selectedFile) { setPreviewUrl(''); return; }
    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  const setField = (key: keyof typeof formData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setFormData(prev => ({ ...prev, [key]: e.target.value }));

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 11);
    setFormData(prev => ({ ...prev, phone: digits }));
    setPhoneError(digits.length > 0 && digits.length !== 11 ? `${digits.length}/11 digits` : '');
  };

  // Fixed dropdown (user can only pick from the list)
  const renderSelect = (label: string, key: keyof typeof formData, options: string[], required = false) => (
    <div className="form-group">
      <label>{label}{required && <span className="required">*</span>}</label>
      <select value={formData[key] as string} onChange={setField(key)} required={required}>
        <option value="">Select {label.toLowerCase()}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  useEffect(() => {
    loadUsersFromFirebase();
    const unsub = subscribeToResetRequests();
    const unsubProfile = subscribeToProfileRequests();
    return () => { if (unsub) unsub(); if (unsubProfile) unsubProfile(); };
  }, []);

  const logActivity = async (payload: { icon: string; tone: string; title: string; meta: string; }) => {
    try {
      const db = getFirestore();
      await setDoc(doc(collection(db, 'activity_feed')), {
        type: 'activity', icon: payload.icon, tone: payload.tone, title: payload.title, meta: payload.meta,
        time: new Date().toISOString(), createdAt: new Date().toISOString(),
      });
    } catch (err) { console.error('Failed to log activity:', err); }
  };

  const generateStrongPassword = (): string => {
    const words = ['Fire', 'Rescue', 'Brave', 'Swift', 'Strong', 'Noble', 'Wise', 'Fierce', 'Mighty', 'Valor', 'Courage', 'Honor', 'Loyal', 'Bright', 'Rapid', 'Vivid', 'Bold', 'Sure', 'True', 'Safe', 'Clear', 'Pure', 'Sun', 'Moon', 'Star', 'Sky', 'Wave', 'Tide', 'Storm', 'Thunder', 'Lightning', 'Rain', 'Wind', 'Snow', 'Flame', 'Blaze', 'Aurora', 'Phoenix', 'Eagle', 'Falcon', 'Tiger', 'Lion', 'Wolf', 'Bear', 'Naga', 'City', 'Bay', 'Island', 'Peak', 'Valley', 'Shore', 'Haven', 'Vista', 'Summit', 'Crest', 'Delta', 'Oasis', 'Polaris', 'Hope', 'Peace', 'Love', 'Joy', 'Faith', 'Grace', 'Pride', 'Victory', 'Triumph', 'Dream', 'Glory', 'Legend', 'Mystic'];
    const symbols = ['!', '#', '$', '%', '&', '*', '+', '='];
    const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
    const num = () => Math.floor(Math.random() * 10).toString();
    let w1 = pick(words), w2 = pick(words), w3 = pick(words);
    while (w2 === w1) w2 = pick(words);
    while (w3 === w1 || w3 === w2) w3 = pick(words);
    const fmt = (w: string) => { const len = Math.min(w.length, 4); return w.substring(0, len).charAt(0).toUpperCase() + w.substring(1, len).toLowerCase(); };
    let pw = fmt(w1) + num() + pick(symbols) + fmt(w2) + num() + fmt(w3);
    if (pw.length > 12) pw = pw.substring(0, 12);
    else while (pw.length < 12) pw += num();
    return PASSWORD_RULES.every(r => r.test(pw)) ? pw : generateStrongPassword();
  };

  // Auto-generate Responder ID: RSP-<year>-0001, 0002, ...
  const generateResponderId = (): string => {
    const prefix = `RSP-${new Date().getFullYear()}-`;
    const max = users.reduce((m, u) => {
      const id = u.badgeNumber || '';
      if (!id.startsWith(prefix)) return m;
      const n = parseInt(id.slice(prefix.length), 10);
      return isNaN(n) ? m : Math.max(m, n);
    }, 0);
    return `${prefix}${String(max + 1).padStart(4, '0')}`;
  };

  const uploadProfileImage = async (file: File, userId: string): Promise<string | null> => {
    try {
      setUploadingImage(true);
      const ext = file.name.split('.').pop();
      const fileName = `${userId}-${Date.now()}.${ext}`;
      const filePath = `profiles/${fileName}`;
      const { error } = await supabase.storage.from('user-profiles').upload(filePath, file, { cacheControl: '3600', upsert: false });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('user-profiles').getPublicUrl(filePath);
      return publicUrl;
    } catch (err) { return null; } finally { setUploadingImage(false); }
  };

  const handleAvatarClick = (user: User) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) await handleProfileImageUpdate(user, file);
    };
    input.click();
  };

  const handleProfileImageUpdate = async (user: User, file: File) => {
    try {
      setUploadingImage(true);
      const url = await uploadProfileImage(file, user.uid || user.id);
      if (!url) return;
      const db = getFirestore();
      await setDoc(doc(db, user.isManagedUser ? 'manage_users' : 'users', user.uid || user.id), { profile: url, updatedAt: new Date().toISOString() }, { merge: true });
      setUsers(users.map(u => u.id === user.id ? { ...u, profile: url } : u));
      await logActivity({ icon: 'image', tone: 'gold', title: 'Profile picture updated', meta: `Photo updated for ${user.name}` });
      alert('✅ Profile picture updated successfully!');
    } catch (err: any) { alert(`❌ Failed to update profile picture: ${err.message}`); } finally { setUploadingImage(false); }
  };

  const loadUsersFromFirebase = async () => {
    try {
      setLoading(true);
      const db = getFirestore();
      let snap = await getDocs(query(collection(db, 'manage_users'), orderBy('createdAt', 'desc')));
      if (snap.empty) snap = await getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc')));
      const list: User[] = [];
      snap.forEach(d => {
        const data = d.data();
        const uid = data.uid || d.id;
        list.push({
          id: uid, name: data.name || data.fullName || data.displayName || data.userName || '',
          role: data.role || '', email: data.email || '', status: data.status || 'active',
          type: data.type || 'responder', phone: data.phone || '', department: data.department || '',
          profile: data.profile || 'https://i.imgur.com/HeIi0wU.png', uid, station: data.station || '',
          specialization: data.specialization || '',
          // fall back to responderId so the auto-ID sequence survives a reload
          badgeNumber: data.badgeNumber || data.responderId || '',
          userType: data.userType || 'responder',
          joinedDate: data.createdAt ? new Date(data.createdAt).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) : 'N/A',
          isManagedUser: data.isManagedUser || false,
        });
      });
      setUsers(list);
      if (onUsersLoaded) onUsersLoaded(list);
    } catch (err) { console.error('Error loading users:', err); } finally { setLoading(false); }
  };

  const subscribeToResetRequests = () => {
    try {
      const db = getFirestore();
      const qIndexed = query(
        collection(db, 'password_reset_requests'),
        where('status', '==', 'pending'),
        orderBy('requestedAt', 'desc')
      );
      const handleSnap = (snap: any) => {
        const rows: ResetRequest[] = [];
        snap.forEach((d: any) => {
          const data = d.data();
          rows.push({
            id: d.id, email: data.email || '', status: data.status || 'pending',
            requestedAt: data.requestedAt || new Date(), requestedBy: data.requestedBy || 'responder', userAgent: data.userAgent,
          });
        });
        rows.sort((a, b) => {
          const at = (a.requestedAt as any)?.toDate?.()?.getTime?.() ?? 0;
          const bt = (b.requestedAt as any)?.toDate?.()?.getTime?.() ?? 0;
          return bt - at;
        });
        setResetRequests(rows);
        if (rows.length > 0) setShowResetRequests(true);
      };
      const handleError = (err: any) => {
        console.error('Reset-request listener error:', err);
        if (err.code === 'failed-precondition' || err.message?.includes('index')) {
          const qFallback = query(collection(db, 'password_reset_requests'), where('status', '==', 'pending'));
          onSnapshot(qFallback, handleSnap, (err2) => { console.error('Fallback listener error:', err2); });
          return;
        }
        if (err.code === 'permission-denied') {
          alert('⚠️ Cannot read reset requests (permission denied).\n\nFirestore rules are blocking the read. Make sure you published the new rules.');
        }
      };
      const unsub = onSnapshot(qIndexed, handleSnap, handleError);
      return unsub;
    } catch (err) { return null; }
  };

  // ---------- Profile update requests (responder app) ----------
  const subscribeToProfileRequests = () => {
    try {
      const db = getFirestore();
      // no orderBy → no composite index needed; we sort on the client
      const q = query(collection(db, 'profile_update_requests'), where('status', '==', 'pending'));
      return onSnapshot(q, (snap) => {
        const rows: ProfileRequest[] = [];
        snap.forEach((d) => {
          const data: any = d.data();
          rows.push({
            id: d.id,
            requesterUid: data.requesterUid || '',
            email: data.email || '',
            responderName: data.responderName || '',
            changes: data.changes || {},
            previous: data.previous || {},
            fields: data.fields || [],
            reason: data.reason || '',
            status: data.status || 'pending',
            requestedAt: data.requestedAt || new Date(),
          });
        });
        rows.sort((a, b) => {
          const at = (a.requestedAt as any)?.toDate?.()?.getTime?.() ?? Date.now();
          const bt = (b.requestedAt as any)?.toDate?.()?.getTime?.() ?? Date.now();
          return bt - at;
        });
        setProfileRequests(rows);
        if (rows.length > 0) setShowResetRequests(true);
      }, (err) => {
        console.error('Profile-request listener error:', err);
        if (err.code === 'permission-denied') {
          alert('⚠️ Cannot read profile update requests (permission denied).\n\nMake sure the profile_update_requests rules are published.');
        }
      });
    } catch (err) { return null; }
  };

  const reviewProfileRequest = (req: ProfileRequest) => {
    const target = users.find(u => u.id === req.requesterUid || u.uid === req.requesterUid);
    if (!target) return alert('❌ Could not find this responder in the user list.');
    setShowResetRequests(false);
    openDetails(target, req);
  };

  const rejectProfileRequest = async (req: ProfileRequest): Promise<boolean> => {
    const remarks = window.prompt(
      `Reject profile update request from ${req.responderName || req.email}?\nOptional remarks for the responder:`, '');
    if (remarks === null) return false;
    try {
      await updateDoc(doc(getFirestore(), 'profile_update_requests', req.id), {
        status: 'rejected',
        adminRemarks: remarks.trim(),
        reviewedAt: Timestamp.now(),
        reviewedBy: getAuth().currentUser?.email || 'Admin',
        responderNotified: false,
      });
      await logActivity({ icon: 'user-x', tone: 'clay', title: 'Profile update rejected', meta: `Request from ${req.responderName || req.email} was rejected` });
      return true;
    } catch (err: any) { alert(`❌ Failed: ${err.message}`); return false; }
  };

  const uniqueRoles = ['all', ...new Set(users.map(u => u.role))];
  const filteredUsers = users.filter(u => {
    const s = searchTerm.toLowerCase();
    const matchSearch = u.name.toLowerCase().includes(s) || u.role.toLowerCase().includes(s) || u.email.toLowerCase().includes(s) || (u.department || '').toLowerCase().includes(s);
    return matchSearch && (statusFilter === 'all' || u.status === statusFilter) && (roleFilter === 'all' || u.role === roleFilter);
  });
  const totalUsers = filteredUsers.length;
  // @ts-ignore
  const totalPages = Math.ceil(totalUsers / usersPerPage);
  const idxLast = currentPage * usersPerPage;
  const idxFirst = idxLast - usersPerPage;
  const currentUsers = filteredUsers.slice(idxFirst, idxLast);

  const handleAddUserClick = () => setShowUserTypeModal(true);

  const handleUserTypeSelect = (type: 'eoc' | 'responder') => {
    setSelectedUserType(type); setShowUserTypeModal(false); setShowModal(true); setPhoneError('');
    const pw = generateStrongPassword();
    if (type === 'eoc') setFormData(prev => ({ ...prev, role: 'EOC Personnel', station: '', badgeNumber: '', specialization: '', password: pw, confirmPassword: pw }));
    else setFormData(prev => ({ ...prev, role: 'Emergency Responder', station: '', badgeNumber: '', specialization: '', responderId: generateResponderId(), password: pw, confirmPassword: pw }));
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.password !== formData.confirmPassword) return alert('Passwords do not match!');
    // Show the requirements popup if the password breaks any rule
    if (PASSWORD_RULES.some(r => !r.test(formData.password))) { setShowPasswordRules(true); return; }
    if (formData.phone && !/^\d{11}$/.test(formData.phone)) return alert('❌ Mobile Number must be exactly 11 digits.');
    if (!formData.email.trim()) return alert("❌ Please enter the user's real email address.");
    setIsCreating(true); if (onEOCCreating) onEOCCreating(true);
    try {
      const auth = getAuth(); const db = getFirestore();
      const email = formData.email.trim();
      const cred = await createUserWithEmailAndPassword(auth, email, formData.password);
      const firebaseUser = cred.user;
      let profileUrl = formData.profile || 'https://i.imgur.com/HeIi0wU.png';
      if (selectedFile) { const uploaded = await uploadProfileImage(selectedFile, firebaseUser.uid); if (uploaded) profileUrl = uploaded; }
      let userData: any = {
        uid: firebaseUser.uid, name: formData.name || `${formData.firstName} ${formData.lastName}`.trim(),
        role: formData.role, email, phone: formData.phone || '', profile: profileUrl, status: 'active',
        civilStatus: formData.status || '',
        createdAt: new Date().toISOString(), joinedDate: new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
        isManagedUser: true, requirePasswordChange: false,
      };
      if (selectedUserType === 'eoc') {
        userData = { ...userData, department: formData.department || 'Naga City EOC', badgeNumber: formData.badgeNumber || '', type: 'admin', userType: 'eoc' };
      } else {
        userData = {
          ...userData,
          firstName: formData.firstName || '', lastName: formData.lastName || '',
          responderId: formData.responderId || generateResponderId(),
          agency: 'Naga City CDRRMO', // hidden default (field removed from the form)
          team: formData.team || '', gender: formData.gender || '', age: formData.age || '',
          capabilities: formData.capabilities || '',
          department: 'Naga City CDRRMO', station: formData.team || '',
          specialization: '', type: 'responder', userType: 'responder',
        };
      }
      await setDoc(doc(db, 'manage_users', firebaseUser.uid), userData);
      await logActivity({ icon: 'user-check', tone: 'forest', title: selectedUserType === 'eoc' ? 'New EOC account created' : 'New responder account created', meta: `${userData.name} (${formData.role}) assigned to ${userData.department || 'Naga City'}` });
      const newUser: User = {
        id: firebaseUser.uid, name: userData.name, role: formData.role, email, phone: formData.phone,
        department: userData.department, profile: profileUrl, status: 'active',
        type: selectedUserType === 'eoc' ? 'admin' : 'responder', uid: firebaseUser.uid, station: userData.station,
        specialization: userData.specialization, badgeNumber: userData.badgeNumber || userData.responderId,
        userType: selectedUserType as 'eoc' | 'responder', joinedDate: userData.joinedDate, isManagedUser: true,
      };
      setUsers(prev => [newUser, ...prev]);
      setCreatedUser({ name: userData.name, email, password: formData.password, role: formData.role, userType: selectedUserType as 'eoc' | 'responder' });
      setShowModal(false); setShowSuccessModal(true);
      setFormData({ ...EMPTY_FORM });
      setSelectedFile(null); setPhoneError('');
    } catch (err: any) {
      let msg = 'Failed to create user. Please try again.';
      if (err.code === 'auth/email-already-in-use') msg = 'This email is already registered.';
      else if (err.code === 'auth/invalid-email') msg = 'Invalid email address.';
      else if (err.code === 'auth/weak-password') msg = 'Password is too weak.';
      alert(`❌ ${msg}`);
    } finally { setIsCreating(false); if (onEOCCreating) onEOCCreating(false); }
  };

  const openResetLinkModal = (request: ResetRequest) => { setSelectedRequest(request); setResetLinkError(''); setResetLinkSuccess(false); setShowResetLinkModal(true); };

  const handleSendResetLink = async () => {
    if (!selectedRequest) return;
    setIsSendingLink(true); setResetLinkError('');
    try {
      const auth = getAuth(); const db = getFirestore(); const currentUser = auth.currentUser;
      if (!currentUser) { setResetLinkError('You are not logged in.'); setIsSendingLink(false); return; }

      await sendPasswordResetEmail(auth, selectedRequest.email);

      // 🎯 TRIGGERS THE FLUTTER APP
      await updateDoc(doc(db, 'password_reset_requests', selectedRequest.id), {
        status: 'link_sent',
        linkSentAt: new Date().toISOString(),
        linkSentBy: currentUser.email || currentUser.uid
      });

      await logActivity({ icon: 'key', tone: 'clay', title: 'Password reset link sent', meta: `Reset link emailed to ${selectedRequest.email} by ${currentUser.email || 'Admin'}` });
      setResetLinkSuccess(true);
      setTimeout(() => { setShowResetLinkModal(false); setSelectedRequest(null); setResetLinkSuccess(false); }, 2000);
    } catch (err: any) { setResetLinkError(err.message || 'Failed to send reset link.'); } finally { setIsSendingLink(false); }
  };

  const dismissRequest = async (request: ResetRequest) => {
    if (!window.confirm(`Dismiss reset request from ${request.email}?`)) return;
    try {
      await updateDoc(doc(getFirestore(), 'password_reset_requests', request.id), { status: 'dismissed', dismissedAt: new Date().toISOString() });
    } catch (err: any) { alert(`❌ Failed to dismiss: ${err.message}`); }
  };

  const handleToggleStatus = async (user: User) => {
    const newStatus = user.status === 'active' ? 'inactive' : 'active';
    const action = newStatus === 'inactive' ? 'deactivate' : 'activate';
    if (!window.confirm(`Are you sure you want to ${action} ${user.name}?`)) return;
    try {
      const auth = getAuth(); const db = getFirestore(); const currentUser = auth.currentUser;
      if (!currentUser) return alert('❌ You are not logged in.');
      await setDoc(doc(db, user.isManagedUser ? 'manage_users' : 'users', user.uid || user.id), { status: newStatus, updatedAt: new Date().toISOString(), updatedBy: currentUser.email || currentUser.uid }, { merge: true });
      setUsers(users.map(u => u.id === user.id ? { ...u, status: newStatus } : u));
      await logActivity({ icon: newStatus === 'active' ? 'user-check' : 'user-x', tone: newStatus === 'active' ? 'forest' : 'clay', title: newStatus === 'active' ? 'Account activated' : 'Account deactivated', meta: `${user.name} was ${action}d` });
      alert(`✅ User ${action}d successfully!`);
    } catch (err: any) { alert(`❌ Failed: ${err.message}`); }
  };

  const handleDeleteUser = async (user: User) => {
    if (!window.confirm(`⚠️ Delete ${user.name}? This cannot be undone.`)) return;
    try {
      const auth = getAuth(); const db = getFirestore();
      await deleteDoc(doc(db, user.isManagedUser ? 'manage_users' : 'users', user.uid || user.id));
      setUsers(users.filter(u => u.id !== user.id));
      await logActivity({ icon: 'user-x', tone: 'clay', title: 'Account deleted', meta: `${user.name} was deleted by ${auth.currentUser?.email || 'Admin'}` });
      alert(`✅ User "${user.name}" deleted.`);
    } catch (err: any) { alert(`❌ Failed: ${err.message}`); }
  };

  // ---------- View / Edit details ----------
  const setEdit = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setEditData((p: any) => ({ ...p, [k]: e.target.value }));

  // `req` is passed when the admin clicks "Review & Edit" on a responder's request:
  // the modal opens straight in edit mode with the requested values pre-filled.
  const openDetails = async (user: User, req?: ProfileRequest) => {
    setDetailsUser(user);
    setReviewRequest(req || null);
    setIsEditing(!!req);
    setEditPhoneError('');
    setEditData({
      name: user.name, role: user.role, phone: user.phone || '', department: user.department || '',
      firstName: '', lastName: '', gender: '', age: '', civilStatus: '', team: '', capabilities: '',
    });
    setShowDetailsModal(true);

    // Load the extra fields (gender, age, team...) that aren't in the table list
    try {
      const db = getFirestore();
      const snap = await getDoc(doc(db, user.isManagedUser ? 'manage_users' : 'users', user.uid || user.id));
      const d: any = snap.exists() ? snap.data() : {};
      const [fallbackFirst = '', ...rest] = (user.name || '').split(' ');
      const base = {
        firstName: d.firstName || fallbackFirst,
        lastName: d.lastName || rest.join(' '),
        gender: d.gender || '',
        age: d.age || '',
        civilStatus: d.civilStatus || '',
        team: d.team || '',
        capabilities: d.capabilities || '',
      };

      // Remember the values BEFORE editing → used to send the exact old → new diff to the responder
      setEditOriginal({
        name: user.name || '',
        gender: String(base.gender),
        age: String(base.age),
        civilStatus: String(base.civilStatus),
        phone: user.phone || '',
        role: user.role || '',
        team: String(base.team),
        capabilities: String(base.capabilities),
      });

      // Pre-fill the values the responder asked for
      const applied: any = {};
      if (req) {
        Object.entries(req.changes || {}).forEach(([k, v]) => {
          if (k === 'name') {
            const [f = '', ...r] = String(v).split(' ');
            applied.firstName = f;
            applied.lastName = r.join(' ');
          } else {
            applied[k] = v;
          }
        });
      }

      setEditData((prev: any) => ({ ...prev, ...base, ...applied }));
    } catch (err) { console.error('Failed to load user details:', err); }
  };

  const closeDetails = () => {
    if (isSavingEdit) return;
    setShowDetailsModal(false); setDetailsUser(null); setIsEditing(false); setReviewRequest(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailsUser) return;
    const isEOC = detailsUser.userType === 'eoc';
    const name = isEOC ? (editData.name || '').trim() : `${editData.firstName} ${editData.lastName}`.trim();

    if (!name) return alert('❌ Name is required.');
    if (!editData.role?.trim()) return alert('❌ Role is required.');
    if (editData.phone && !/^\d{11}$/.test(editData.phone)) { setEditPhoneError('Must be exactly 11 digits'); return; }

    setIsSavingEdit(true);
    try {
      const db = getFirestore();
      const currentUser = getAuth().currentUser;

      const updates: any = {
        name,
        role: editData.role.trim(),
        phone: editData.phone || '',
        civilStatus: editData.civilStatus || '',
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser?.email || currentUser?.uid || 'Admin',
      };
      if (isEOC) {
        updates.department = editData.department || 'Naga City EOC';
      } else {
        Object.assign(updates, {
          firstName: editData.firstName || '', lastName: editData.lastName || '',
          gender: editData.gender || '', age: editData.age || '',
          team: editData.team || '', station: editData.team || '',
          capabilities: editData.capabilities || '',
        });
      }

      await setDoc(
        doc(db, detailsUser.isManagedUser ? 'manage_users' : 'users', detailsUser.uid || detailsUser.id),
        updates, { merge: true }
      );

      const updated: User = {
        ...detailsUser, name, role: updates.role, phone: updates.phone,
        department: isEOC ? updates.department : detailsUser.department,
        station: isEOC ? detailsUser.station : updates.station,
      };
      setUsers(prev => prev.map(u => (u.id === detailsUser.id ? updated : u)));
      setDetailsUser(updated);
      setIsEditing(false);

      // ---------- Notify the responder app (popup on the Home page) ----------
      if (!isEOC) {
        const newVals: Record<string, string> = {
          name,
          gender: editData.gender || '',
          age: String(editData.age || ''),
          civilStatus: editData.civilStatus || '',
          phone: editData.phone || '',
          role: updates.role,
          team: editData.team || '',
          capabilities: editData.capabilities || '',
        };
        const changes: Record<string, string> = {};
        const previous: Record<string, string> = {};
        Object.keys(newVals).forEach(k => {
          if ((editOriginal[k] ?? '') !== newVals[k]) {
            changes[k] = newVals[k];
            previous[k] = editOriginal[k] ?? '';
          }
        });
        const hasChanges = Object.keys(changes).length > 0;
        const fields = Object.keys(changes).map(k => FIELD_LABELS[k] || k);
        const by = currentUser?.email || currentUser?.uid || 'Admin';

        if (reviewRequest) {
          // Saving while reviewing a request → approve it with what the admin really applied
          await updateDoc(doc(db, 'profile_update_requests', reviewRequest.id), {
            status: hasChanges ? 'approved' : 'rejected',
            ...(hasChanges ? {} : { adminRemarks: 'No changes were applied.' }),
            changes, previous, fields,
            reviewedAt: Timestamp.now(),
            reviewedBy: by,
            responderNotified: false,
          });
        } else if (hasChanges) {
          // Admin edited the user directly → still tell the responder
          await setDoc(doc(collection(db, 'profile_update_requests')), {
            requesterUid: detailsUser.uid || detailsUser.id,
            email: detailsUser.email,
            responderName: name,
            changes, previous, fields,
            reason: '',
            status: 'approved',
            requestedAt: Timestamp.now(),
            requestedBy: 'admin',
            reviewedAt: Timestamp.now(),
            reviewedBy: by,
            responderNotified: false,
          });
        }
        setReviewRequest(null);
      }

      await logActivity({ icon: 'user-check', tone: 'gold', title: 'User details updated', meta: `${name}'s details were edited by ${currentUser?.email || 'Admin'}` });
      alert('✅ User details updated!');
    } catch (err: any) {
      alert(`❌ Failed to update: ${err.message}`);
    } finally { setIsSavingEdit(false); }
  };

  const getInitials = (name: string) => (!name ? '??' : name.split(' ').length === 1 ? name.charAt(0).toUpperCase() : name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2));
  const getRoleBadgeColor = (role: string) => {
    const map: any = { 'Medical Staff': '#DBEAFE', 'Fire Responder': '#FED7AA', 'EOC Personnel': '#DDE4F8', 'Admin': '#FBE4E0', 'Responder': '#E1E9FD', 'EOC Manager': '#DDE4F8', 'EOC Supervisor': '#DDE4F8', 'EOC Coordinator': '#DDE4F8', 'EOC Dispatcher': '#DDE4F8', 'Police Officer': '#DBEAFE', 'Rescue Team': '#FED7AA', 'Volunteer': '#E1E9FD', 'Paramedic': '#DBEAFE' };
    return map[role] || '#EEF1F8';
  };

  const regeneratePassword = () => { const pw = generateStrongPassword(); setFormData(prev => ({ ...prev, password: pw, confirmPassword: pw })); };

  const handleCopyCredentials = () => {
    if (!createdUser) return;
    const text =
      `Name: ${createdUser.name}\n` +
      `Email: ${createdUser.email}\n` +
      `Password: ${createdUser.password}\n` +
      `Role: ${createdUser.role}`;
    navigator.clipboard.writeText(text).then(() => alert('✅ Copied!'));
  };

  // Download the new account's credentials as a ticket (PNG image)
  const handleDownloadTicket = () => {
    if (!createdUser) return;
    const scale = 2, W = 600, H = 440;
    const canvas = document.createElement('canvas');
    canvas.width = W * scale; canvas.height = H * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(scale, scale);

    // background
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);

    // header
    ctx.fillStyle = '#0B1A3E'; ctx.fillRect(0, 0, W, 90);
    ctx.fillStyle = '#3B6DF0'; ctx.fillRect(0, 90, W, 4);
    ctx.fillStyle = '#FFFFFF'; ctx.font = 'bold 22px Inter, Arial, sans-serif';
    ctx.fillText('CDRRMO Account Ticket', 30, 45);
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '13px Inter, Arial, sans-serif';
    ctx.fillText(createdUser.userType === 'eoc' ? 'EOC Personnel Account' : 'Responder Account', 30, 68);

    // details
    const rows: [string, string, boolean][] = [
      ['NAME', createdUser.name, false],
      ['EMAIL', createdUser.email, false],
      ['PASSWORD', createdUser.password, true],
      ['ROLE', createdUser.role, false],
    ];
    let y = 135;
    rows.forEach(([label, value, mono]) => {
      ctx.fillStyle = '#66708A'; ctx.font = '600 11px Inter, Arial, sans-serif';
      ctx.fillText(label, 30, y);
      ctx.fillStyle = '#0F1B3A';
      ctx.font = mono ? 'bold 18px monospace' : 'bold 17px Inter, Arial, sans-serif';
      ctx.fillText(value, 30, y + 22);
      y += 56;
    });

    // dashed ticket divider
    ctx.strokeStyle = '#DFE4F0'; ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(20, 372); ctx.lineTo(W - 20, 372); ctx.stroke();
    ctx.setLineDash([]);

    // footer
    ctx.fillStyle = '#66708A'; ctx.font = '12px Inter, Arial, sans-serif';
    ctx.fillText('Keep this ticket private. Change your password after first login.', 30, 398);
    ctx.fillText(`Issued: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' })}`, 30, 418);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${createdUser.name.replace(/[^a-z0-9]+/gi, '_')}_account_ticket.png`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  const handleCloseSuccessModal = () => { setShowSuccessModal(false); setCreatedUser(null); setSelectedUserType(null); };

  const totalUsersCount = users.length;
  const activeUsersCount = users.filter(u => u.status === 'active').length;
  const inactiveUsersCount = users.filter(u => u.status === 'inactive').length;
  const adminUsersCount = users.filter(u => u.type === 'admin').length;
  const pendingResetCount = resetRequests.length;
  const pendingProfileCount = profileRequests.length;
  const pendingTotal = pendingResetCount + pendingProfileCount;

  if (loading) return <div className="manage-users"><div className="loading-container"><div className="loading-spinner"></div><p>Loading users...</p></div></div>;

  return (
    <div className="manage-users">
      <div className="users-header">
        <div className="header-left">
          <div className="header-brand"><span className="brand-label">CDRRMO</span><span className="brand-divider">|</span><span className="brand-sub">User Management</span></div>
          <p className="header-subtitle">Manage responders and administrators</p>
        </div>

        <div className="header-actions">
          {pendingTotal > 0 && (
            <div className="notif-wrap">
              <button
                type="button"
                className={`notif-btn ${showResetRequests ? 'open' : ''}`}
                onClick={() => setShowResetRequests(!showResetRequests)}
                aria-haspopup="true"
                aria-expanded={showResetRequests}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                </svg>
                <span className="notif-label">{pendingTotal} Request{pendingTotal > 1 ? 's' : ''}</span>
                <span className="notif-pill">Pending</span>
                <svg className="notif-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#92400E" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 9l6 6 6-6" />
                </svg>
                <span className="notif-badge">{pendingTotal}</span>
              </button>

              {showResetRequests && (
                <>
                  <div className="notif-backdrop" onClick={() => setShowResetRequests(false)} />
                  <div className="notif-menu" role="dialog" aria-label="Pending requests">
                    <span className="notif-arrow" />
                    <div className="notif-head">
                      <span>Pending requests</span>
                      <span className="notif-count">{pendingTotal} new</span>
                    </div>
                    <div className="notif-list">
                      {/* ----- Password reset requests ----- */}
                      {resetRequests.map(req => (
                        <div key={req.id} className="notif-item">
                          <div className="notif-avatar">{(req.email || '?').charAt(0).toUpperCase()}</div>
                          <div className="notif-info">
                            <strong className="notif-email">{req.email}</strong>
                            <small
                              className="notif-meta"
                              title={new Date((req.requestedAt as any)?.toDate?.() || req.requestedAt).toLocaleString()}
                            >
                              Password reset · {req.userAgent ? `${req.userAgent} · ` : ''}{timeAgo(req.requestedAt)}
                            </small>
                            <div className="notif-actions">
                              <button type="button" className="notif-btn-primary" onClick={() => { setShowResetRequests(false); openResetLinkModal(req); }}>Send Reset Link</button>
                              <button type="button" className="notif-btn-ghost" onClick={() => dismissRequest(req)}>Dismiss</button>
                            </div>
                          </div>
                        </div>
                      ))}

                      {/* ----- Profile update requests ----- */}
                      {profileRequests.map(req => (
                        <div key={req.id} className="notif-item">
                          <div className="notif-avatar">{(req.responderName || req.email || '?').charAt(0).toUpperCase()}</div>
                          <div className="notif-info">
                            <strong className="notif-email">{req.responderName || req.email}</strong>
                            <small
                              className="notif-meta"
                              title={new Date((req.requestedAt as any)?.toDate?.() || req.requestedAt).toLocaleString()}
                            >
                              Profile update · {req.fields.join(', ')} · {timeAgo(req.requestedAt)}
                            </small>
                            <div className="notif-actions">
                              <button type="button" className="notif-btn-primary" onClick={() => reviewProfileRequest(req)}>Review &amp; Edit</button>
                              <button type="button" className="notif-btn-ghost" onClick={() => rejectProfileRequest(req)}>Reject</button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
          <button className="add-user-btn" onClick={handleAddUserClick}><span className="add-icon">+</span> Add New User</button>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card"><div className="stat-icon-wrapper"><div className="stat-icon users-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div></div><div className="stat-content"><span className="stat-number">{totalUsersCount}</span><span className="stat-label">Total Listed</span><span className="stat-sub">All registered users</span></div></div>
        <div className="stat-card"><div className="stat-icon-wrapper"><div className="stat-icon inactive-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" y1="17" x2="23" y2="17"/></svg></div></div><div className="stat-content"><span className="stat-number inactive-count">{inactiveUsersCount}</span><span className="stat-label">Archived Listed</span><span className="stat-sub">Inactive users</span></div></div>
        <div className="stat-card"><div className="stat-icon-wrapper"><div className="stat-icon admin-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div></div><div className="stat-content"><span className="stat-number admin-count">{adminUsersCount}</span><span className="stat-label">Admin Users</span><span className="stat-sub">System administrators</span></div></div>
        <div className="stat-card"><div className="stat-icon-wrapper"><div className="stat-icon active-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div></div><div className="stat-content"><span className="stat-number active-count">{activeUsersCount}</span><span className="stat-label">Active</span><span className="stat-sub">Currently active</span></div></div>
      </div>

      <div className="table-wrapper">
        <div className="search-filter-container">
          <div className="search-filter-row">
            <div className="search-wrapper"><span className="search-icon">🔍</span><input type="text" placeholder="Search by name, role, email, or location..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="search-input" /></div>
            <select className="filter-select" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}><option value="all">All Roles</option>{uniqueRoles.filter(r => r !== 'all').map(r => <option key={r} value={r}>{r}</option>)}</select>
            <div className="status-filter-buttons">
              <button className={`filter-btn ${statusFilter === 'all' ? 'active' : ''}`} onClick={() => setStatusFilter('all')}>All</button>
              <button className={`filter-btn ${statusFilter === 'active' ? 'active' : ''}`} onClick={() => setStatusFilter('active')}><span className="status-dot active-dot"></span>Active</button>
              <button className={`filter-btn ${statusFilter === 'inactive' ? 'active' : ''}`} onClick={() => setStatusFilter('inactive')}><span className="status-dot inactive-dot"></span>Inactive</button>
            </div>
          </div>
        </div>

        <div className="table-scroll-container">
          <table className="users-table">
            <thead><tr><th>USER</th><th>ROLE</th><th>STATUS</th><th>LOCATION</th><th>CONTACT</th><th>JOINED</th><th>ACTION</th></tr></thead>
            <tbody>
              {currentUsers.map(user => (
                <tr key={user.id}>
                  <td>
                    <div className="user-info">
                      <div className="user-avatar-wrapper">
                        <div className="user-avatar clickable-avatar" onClick={() => handleAvatarClick(user)} title="Click to change profile picture" style={{ cursor: 'pointer' }}>
                          {user.profile && user.profile !== 'https://i.imgur.com/HeIi0wU.png' ? <img src={user.profile} alt={user.name} /> : <span>{getInitials(user.name)}</span>}
                        </div>
                        {user.status === 'active' && <span className="online-indicator"></span>}
                      </div>
                      <div className="user-details"><p className="user-name">{user.name || 'Unnamed User'}</p><p className="user-email">{user.email || 'No email'}</p></div>
                    </div>
                  </td>
                  <td><span className="role-badge" style={{ backgroundColor: getRoleBadgeColor(user.role) }}>{user.role || 'No Role'}</span></td>
                  <td><span className={`mu-status ${user.status === 'active' ? 'is-active' : 'is-inactive'}`}><span className="mu-status-dot"></span>{user.status === 'active' ? 'ACTIVE' : 'INACTIVE'}</span></td>
                  <td><div className="location-info"><span className="location-icon">📍</span>{user.department || 'N/A'}</div></td>
                  <td><div className="contact-info"><span className="contact-icon">📞</span>{user.phone || 'N/A'}</div></td>
                  <td><div className="joined-info"><span className="joined-icon">📅</span>{user.joinedDate || 'N/A'}</div></td>
                  <td>
                    <div className="action-buttons">
                      <button className="action-btn view-btn" onClick={() => openDetails(user)} title="View / Edit details">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                        </svg>
                      </button>
                      <button className={`action-btn status-toggle-btn ${user.status === 'active' ? 'deactivate-btn' : 'activate-btn'}`} onClick={() => handleToggleStatus(user)} title={user.status === 'active' ? 'Deactivate' : 'Activate'}>
                        {user.status === 'active' ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></svg> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /><polyline points="16 11 18 13 22 9" /></svg>}
                      </button>
                      <button className="action-btn delete-btn" onClick={() => handleDeleteUser(user)} title="Delete User"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredUsers.length === 0 && <div className="empty-state"><p>No users found</p></div>}
      </div>

      {/* ---------- View / Edit user details modal ---------- */}
      {showDetailsModal && detailsUser && (() => {
        const isEOC = detailsUser.userType === 'eoc';
        const rows: [string, string][] = [
          ['Full name', detailsUser.name],
          ['Role', detailsUser.role],
          ['Email', detailsUser.email],
          ['Mobile number', detailsUser.phone || 'N/A'],
          [isEOC ? 'ID / Badge' : 'Responder ID', detailsUser.badgeNumber || 'N/A'],
          ['Department', detailsUser.department || 'N/A'],
          ...(isEOC ? [] : [
            ['Team', editData.team || 'N/A'],
            ['Capabilities', editData.capabilities || 'N/A'],
            ['Gender', editData.gender || 'N/A'],
            ['Age', String(editData.age || 'N/A')],
          ] as [string, string][]),
          ['Status (civil)', editData.civilStatus || 'N/A'],
          ['Account status', detailsUser.status === 'active' ? 'Active' : 'Inactive'],
          ['Joined', detailsUser.joinedDate || 'N/A'],
        ];

        return (
          <div className="modal-overlay" onClick={closeDetails}>
            <div className="modal-box" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-header-left">
                  <div className="modal-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                  </div>
                  <div className="modal-title-section">
                    <h3>{isEditing ? 'Edit User' : 'User Details'}</h3>
                    <p>{isEditing ? 'Update the information below' : detailsUser.email}</p>
                  </div>
                </div>
                <button className="close-btn" onClick={closeDetails}>✕</button>
              </div>

              {/* ---------- Profile update request being reviewed ---------- */}
              {reviewRequest && (
                <div style={{ margin: '12px 20px 0', background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 8, padding: '10px 14px' }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#92400E' }}>
                    📝 Profile update request from {reviewRequest.responderName || reviewRequest.email}
                  </p>
                  {Object.entries(reviewRequest.changes).map(([k, v]) => (
                    <p key={k} style={{ margin: '4px 0 0', fontSize: 12.5, color: '#92400E' }}>
                      • {FIELD_LABELS[k] || k}: {reviewRequest.previous?.[k] ? `${reviewRequest.previous[k]} → ` : ''}{v}
                    </p>
                  ))}
                  {reviewRequest.reason && (
                    <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#92400E' }}>Reason: {reviewRequest.reason}</p>
                  )}
                  <p style={{ margin: '6px 0 0', fontSize: 12, color: '#92400E' }}>
                    Requested values are pre-filled. Click “Save changes” to approve and apply them.
                  </p>
                  <button
                    type="button"
                    className="cancel-btn"
                    style={{ marginTop: 8 }}
                    onClick={async () => { if (await rejectProfileRequest(reviewRequest)) closeDetails(); }}
                  >
                    Reject request
                  </button>
                </div>
              )}

              {!isEditing ? (
                <div className="details-body">
                  <div className="details-top">
                    <div className="details-avatar">
                      {detailsUser.profile && detailsUser.profile !== 'https://i.imgur.com/HeIi0wU.png'
                        ? <img src={detailsUser.profile} alt={detailsUser.name} />
                        : <span>{getInitials(detailsUser.name)}</span>}
                    </div>
                    <div>
                      <h4 className="details-name">{detailsUser.name || 'Unnamed User'}</h4>
                      <span className="role-badge" style={{ backgroundColor: getRoleBadgeColor(detailsUser.role) }}>{detailsUser.role || 'No Role'}</span>
                    </div>
                  </div>
                  <div className="details-grid">
                    {rows.map(([label, value]) => (
                      <div key={label} className="ud-item">
                        <span className="ud-label">{label}</span>
                        <span className="ud-value">{value}</span>
                      </div>
                    ))}
                  </div>
                  <div className="modal-actions">
                    <button type="button" className="cancel-btn" onClick={closeDetails}>Close</button>
                    <button type="button" className="save-btn" onClick={() => setIsEditing(true)}>✎ Edit details</button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSaveEdit}>
                  {isEOC ? (
                    <div className="form-row">
                      <div className="form-group">
                        <label>Full name<span className="required">*</span></label>
                        <input type="text" value={editData.name} onChange={setEdit('name')} required />
                      </div>
                      <div className="form-group">
                        <label>Department</label>
                        <input type="text" value={editData.department} onChange={setEdit('department')} />
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="form-row">
                        <div className="form-group">
                          <label>First name<span className="required">*</span></label>
                          <input type="text" value={editData.firstName} onChange={setEdit('firstName')} required />
                        </div>
                        <div className="form-group">
                          <label>Last name<span className="required">*</span></label>
                          <input type="text" value={editData.lastName} onChange={setEdit('lastName')} required />
                        </div>
                      </div>
                      <div className="form-row">
                        <div className="form-group">
                          <label>Gender</label>
                          <select value={editData.gender} onChange={setEdit('gender')}>
                            <option value="">Select gender</option>
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                          </select>
                        </div>
                        <div className="form-group">
                          <label>Age</label>
                          <input type="number" min={18} max={80} value={editData.age} onChange={setEdit('age')} />
                        </div>
                      </div>
                      <div className="form-row">
                        <ComboField label="Team" value={editData.team} options={TEAM_OPTIONS} onChange={(v) => setEditData((p: any) => ({ ...p, team: v }))} />
                        <ComboField label="Capabilities" value={editData.capabilities} options={CAPABILITIES_OPTIONS} onChange={(v) => setEditData((p: any) => ({ ...p, capabilities: v }))} />
                      </div>
                    </>
                  )}

                  <div className="form-row">
                    {isEOC
                      ? <div className="form-group">
                          <label>Role<span className="required">*</span></label>
                          <input type="text" value={editData.role} onChange={setEdit('role')} required />
                        </div>
                      : <ComboField label="Role" value={editData.role} options={RESPONDER_ROLES} required onChange={(v) => setEditData((p: any) => ({ ...p, role: v }))} />}
                    <div className="form-group">
                      <label>Status</label>
                      <select value={editData.civilStatus} onChange={setEdit('civilStatus')}>
                        <option value="">Select status</option>
                        <option value="Single">Single</option>
                        <option value="Married">Married</option>
                      </select>
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label>Email</label>
                      <input type="email" className="auto-field" value={detailsUser.email} readOnly />
                      <small>Email can't be changed here.</small>
                    </div>
                    <div className="form-group">
                      <label>Mobile number</label>
                      <input
                        type="tel" inputMode="numeric" placeholder="09XXXXXXXXX" value={editData.phone}
                        className={editPhoneError ? 'has-error' : ''}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, '').slice(0, 11);
                          setEditData((p: any) => ({ ...p, phone: digits }));
                          setEditPhoneError(digits.length > 0 && digits.length !== 11 ? `${digits.length}/11 digits` : '');
                        }}
                      />
                      {editPhoneError && <span className="vot-field-hint error">{editPhoneError}</span>}
                    </div>
                  </div>

                  <div className="modal-actions" style={{ padding: '16px 0 0' }}>
                    <button type="button" className="cancel-btn" onClick={() => (reviewRequest ? closeDetails() : setIsEditing(false))} disabled={isSavingEdit}>Cancel</button>
                    <button type="submit" className="save-btn" disabled={isSavingEdit}>{isSavingEdit ? 'Saving...' : 'Save changes'}</button>
                  </div>
                </form>
              )}
            </div>
          </div>
        );
      })()}

      {showResetLinkModal && selectedRequest && (
        <div className="modal-overlay" onClick={() => !isSendingLink && setShowResetLinkModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <div className="modal-header-left"><div className="modal-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg></div><div className="modal-title-section"><h3>Send Password Reset Link</h3><p>A secure, time-limited link will be emailed to this responder.</p></div></div>
              <button className="close-btn" onClick={() => !isSendingLink && setShowResetLinkModal(false)}>✕</button>
            </div>
            <div style={{ padding: '20px' }}>
              {resetLinkSuccess ? (
                <div style={{ background: '#dcfce7', color: '#15803d', padding: '16px', borderRadius: '10px', textAlign: 'center', border: '1px solid #bbf7d0' }}>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#15803d" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" strokeLinecap="round" strokeLinejoin="round"/><polyline points="22 4 12 14.01 9 11.01" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  <p style={{ marginTop: '8px', fontWeight: 600 }}>✅ Reset link sent!</p>
                  <p style={{ fontSize: '13px', marginTop: '4px' }}>Check <strong>{selectedRequest.email}</strong> (and Spam).</p>
                </div>
              ) : (
                <>
                  <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px' }}>
                    <p style={{ fontSize: '13px', color: '#92400E', margin: 0 }}>📧 A password-reset email will be sent to:</p>
                    <p style={{ fontSize: '15px', color: '#92400E', margin: '6px 0 0 0', fontWeight: 700 }}>{selectedRequest.email}</p>
                  </div>
                  <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px' }}>
                    <p style={{ fontSize: '12px', color: '#1E40AF', margin: 0, lineHeight: 1.5 }}>ℹ️ The link is <strong>time-limited</strong> and <strong>single-use</strong>. The responder will use it to set their own new password, then log in again.</p>
                  </div>
                  {resetLinkError && <div style={{ background: '#FEF2F2', color: '#DC2626', padding: '8px 12px', borderRadius: '6px', border: '1px solid #FCA5A5', fontSize: '13px', marginBottom: '12px' }}>{resetLinkError}</div>}
                  <div className="modal-actions">
                    <button type="button" className="cancel-btn" onClick={() => setShowResetLinkModal(false)} disabled={isSendingLink}>Cancel</button>
                    <button type="button" className="save-btn" onClick={handleSendResetLink} disabled={isSendingLink} style={{ background: '#3B6DF0' }}>{isSendingLink ? 'Sending...' : 'Send Reset Link'}</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showUserTypeModal && (
        <div className="modal-overlay" onClick={() => setShowUserTypeModal(false)}>
          <div className="modal-box user-type-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><div className="modal-header-left"><div className="modal-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></div><div className="modal-title-section"><h3>Add User</h3><p>Select the type of user you want to create</p></div></div><button className="close-btn" onClick={() => setShowUserTypeModal(false)}>✕</button></div>
            <div className="user-type-options">
              <div className="user-type-option" onClick={() => handleUserTypeSelect('eoc')}><div className="user-type-icon eoc-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg></div><div className="user-type-info"><h4>EOC Personnel</h4><p>Create an account for EOC access</p></div><span className="user-type-arrow">→</span></div>
              <div className="user-type-option" onClick={() => handleUserTypeSelect('responder')}><div className="user-type-icon responder-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 8v4l3 3"></path><circle cx="12" cy="12" r="10"></circle></svg></div><div className="user-type-info"><h4>Responder</h4><p>Create an account for field responders</p></div><span className="user-type-arrow">→</span></div>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><div className="modal-header-left"><div className="modal-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></div><div className="modal-title-section"><h3>Add {selectedUserType === 'eoc' ? 'EOC Personnel' : 'Responder'}</h3></div></div><button className="close-btn" onClick={() => setShowModal(false)}>✕</button></div>
            <form onSubmit={handleAddUser}>
              {/* ---------- Profile photo ---------- */}
              <div className="profile-upload-section">
                <div className="profile-preview">
                  {previewUrl ? (
                    <img src={previewUrl} alt="Preview" />
                  ) : (
                    <div className="profile-placeholder">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                    </div>
                  )}
                  {uploadingImage && <div className="upload-spinner"><div className="spinner" /></div>}
                </div>
                <label className="upload-btn" style={{ cursor: 'pointer' }}>
                  {selectedFile ? 'Change photo' : 'Upload photo (optional)'}
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} />
                </label>
              </div>

              {/* ---------- Personal information ---------- */}
              <div className="credentials-section"><div className="credentials-divider">Personal information</div></div>

              {selectedUserType === 'eoc' ? (
                <div className="eoc-fields">
                  <div className="form-row">
                    <div className="form-group">
                      <label>Full name<span className="required">*</span></label>
                      <input type="text" placeholder="e.g. Juan Dela Cruz" value={formData.name} onChange={setField('name')} required />
                    </div>
                    {renderSelect('Status', 'status', ['Single', 'Married'])}
                  </div>
                </div>
              ) : (
                <div className="responder-fields">
                  <div className="form-row">
                    <div className="form-group">
                      <label>First name<span className="required">*</span></label>
                      <input type="text" placeholder="First name" value={formData.firstName} onChange={setField('firstName')} required />
                    </div>
                    <div className="form-group">
                      <label>Last name<span className="required">*</span></label>
                      <input type="text" placeholder="Last name" value={formData.lastName} onChange={setField('lastName')} required />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Responder ID</label>
                      <input type="text" className="auto-field" value={formData.responderId} readOnly />
                      <small>Auto-generated</small>
                    </div>
                    {renderSelect('Gender', 'gender', ['Male', 'Female'])}
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Age</label>
                      <input type="number" min={18} max={80} placeholder="Age" value={formData.age} onChange={setField('age')} />
                    </div>
                    {renderSelect('Status', 'status', ['Single', 'Married'])}
                  </div>
                  <div className="form-row">
                    <ComboField label="Role" value={formData.role} options={RESPONDER_ROLES} required onChange={(v) => setFormData(prev => ({ ...prev, role: v }))} />
                  </div>

                  <div className="credentials-section"><div className="credentials-divider">Team &amp; capabilities</div></div>
                  <div className="form-row">
                    <ComboField label="Team" value={formData.team} options={TEAM_OPTIONS} onChange={(v) => setFormData(prev => ({ ...prev, team: v }))} />
                    <ComboField label="Capabilities" value={formData.capabilities} options={CAPABILITIES_OPTIONS} onChange={(v) => setFormData(prev => ({ ...prev, capabilities: v }))} />
                  </div>
                </div>
              )}

              {/* ---------- Contact ---------- */}
              <div className="credentials-section"><div className="credentials-divider">Contact</div></div>
              <div className="form-row">
                <div className="form-group">
                  <label>Email<span className="required">*</span></label>
                  <input type="email" placeholder="name@gmail.com" value={formData.email} onChange={setField('email')} required />
                  <small>Use the user's own, working email address.</small>
                </div>
                <div className="form-group">
                  <label>Mobile number</label>
                  <input type="tel" inputMode="numeric" placeholder="09XXXXXXXXX" value={formData.phone} onChange={handlePhoneChange} className={phoneError ? 'has-error' : ''} />
                  {phoneError && <span className="vot-field-hint error">{phoneError}</span>}
                </div>
              </div>

              {/* ---------- Credentials ---------- */}
              <div className="credentials-section"><div className="credentials-divider">Account password</div></div>
              <div className="form-row">
                <div className="form-group">
                  <label>Password<span className="required">*</span></label>
                  <div className="password-input-wrapper">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={formData.password}
                      onChange={setField('password')}
                      onFocus={() => setPwFocused(true)}
                      onBlur={() => setPwFocused(false)}
                      required
                    />
                    <button type="button" className="password-toggle-btn" onClick={() => setShowPassword(!showPassword)} aria-label="Toggle password visibility">{showPassword ? '🙈' : '👁'}</button>
                  </div>
                </div>
                <div className="form-group">
                  <label>Confirm password<span className="required">*</span></label>
                  <div className="password-input-wrapper">
                    <input type={showConfirmPassword ? 'text' : 'password'} value={formData.confirmPassword} onChange={setField('confirmPassword')} required />
                    <button type="button" className="password-toggle-btn" onClick={() => setShowConfirmPassword(!showConfirmPassword)} aria-label="Toggle confirm password visibility">{showConfirmPassword ? '🙈' : '👁'}</button>
                  </div>
                </div>
              </div>

              {/* Live password requirements */}
              {(pwFocused || PASSWORD_RULES.some(r => !r.test(formData.password))) && (
                <ul className="pw-live-list">
                  {PASSWORD_RULES.map(r => {
                    const ok = r.test(formData.password);
                    return (
                      <li key={r.key} className={ok ? 'ok' : 'bad'}>
                        <span className="pw-rule-icon">{ok ? '✓' : '✕'}</span>{r.label}
                      </li>
                    );
                  })}
                </ul>
              )}

              <div style={{ marginBottom: 4 }}>
                <button type="button" className="regenerate-btn" onClick={regeneratePassword}>↻ Generate new password</button>
                <small style={{ display: 'block', marginTop: 6, color: 'var(--ink-soft)' }}>12+ characters with uppercase, lowercase, number and symbol.</small>
              </div>

              <div className="modal-actions" style={{ padding: '20px 0 0' }}>
                <button type="button" className="cancel-btn" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="save-btn" disabled={isCreating || uploadingImage}>{isCreating || uploadingImage ? 'Creating...' : `Create ${selectedUserType === 'eoc' ? 'EOC Personnel' : 'Responder'}`}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------- Password requirements popup ---------- */}
      {showPasswordRules && (
        <div className="modal-overlay" onClick={() => setShowPasswordRules(false)}>
          <div className="modal-box pw-rules-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-title-section">
                  <h3>Password requirements</h3>
                  <p>The password must meet all rules before the account can be created.</p>
                </div>
              </div>
              <button className="close-btn" onClick={() => setShowPasswordRules(false)}>✕</button>
            </div>
            <div style={{ padding: 20 }}>
              <ul className="pw-rules-list">
                {PASSWORD_RULES.map(r => {
                  const ok = r.test(formData.password);
                  return (
                    <li key={r.key} className={ok ? 'ok' : 'bad'}>
                      <span className="pw-rule-icon">{ok ? '✓' : '✕'}</span>{r.label}
                    </li>
                  );
                })}
              </ul>
              <div className="modal-actions">
                <button type="button" className="cancel-btn" onClick={() => { regeneratePassword(); setShowPasswordRules(false); }}>Generate strong password</button>
                <button type="button" className="save-btn" onClick={() => setShowPasswordRules(false)}>Fix password</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showSuccessModal && createdUser && (
        <div className="modal-overlay" onClick={handleCloseSuccessModal}>
          <div className="modal-box success-modal" onClick={(e) => e.stopPropagation()}>
             <div className="modal-header"><div className="modal-header-left"><div className="modal-icon success-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" strokeLinecap="round" strokeLinejoin="round"/><polyline points="22 4 12 14.01 9 11.01" strokeLinecap="round" strokeLinejoin="round"/></svg></div><div className="modal-title-section"><h3 style={{ color: '#86EFAC' }}>Account Created Successfully</h3><p>Please provide these credentials to the user.</p></div></div><button className="close-btn" onClick={handleCloseSuccessModal}>✕</button></div>
            <div className="success-modal-body" style={{ padding: '20px' }}>
              <div className="credential-card"><div className="credential-item"><span className="credential-label">👤 Name</span><span className="credential-value">{createdUser.name}</span></div><div className="credential-item"><span className="credential-label">📧 Email</span><span className="credential-value">{createdUser.email}</span></div><div className="credential-item"><span className="credential-label">🔑 Password</span><span className="credential-value" style={{ fontFamily: 'monospace' }}>{createdUser.password}</span></div><div className="credential-item"><span className="credential-label">📋 Role</span><span className="credential-value">{createdUser.role}</span></div></div>
              <div className="success-actions" style={{ display: 'flex', gap: '10px', marginTop: '12px' }}><button className="copy-btn" onClick={handleCopyCredentials} style={{ flex: 1, padding: '10px 16px', background: '#3B6DF0', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Copy Credentials</button><button className="copy-btn" onClick={handleDownloadTicket} style={{ flex: 1, padding: '10px 16px', background: '#0B1A3E', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>⬇ Download Ticket</button><button className="done-btn" onClick={handleCloseSuccessModal} style={{ padding: '10px 24px', background: '#0F1F4A', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Done</button></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManageUsers;