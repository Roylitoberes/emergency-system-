import React, { useState, useEffect, useRef } from 'react';
import { 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  type User,
  sendPasswordResetEmail
} from 'firebase/auth';
import { auth } from './firebase';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import Navbar from './components/Navbar';
import IncidentReports from './components/FinalReports';
import ValidateIncident from './components/View Available Traniess';
import ManageUsers from './components/ManageUsers';
import CDRRMOLogin from './components/CDRRMOLogin';
import AppEOC from './AppEOC';
import DashboardHome from './components/DashboardHome';

import './css/Navbar.css';


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

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [, setAuthError] = useState<string>('');
  const [userRole, setUserRole] = useState<'admin' | 'eoc' | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    const auth = localStorage.getItem('adminAuthenticated');
    return auth === 'true';
  });
  const [activeTab, setActiveTab] = useState<string>(() => {
    return localStorage.getItem('lastActiveTab') || 'dashboard';
  });
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  
  const isCreatingEOCRef = useRef<boolean>(false);
  const adminEmailRef = useRef<string | null>(null);

  // Original admin email (fallback only). Once the admin changes their email in
  // Admin Settings, their Firestore doc (manage_users/{uid}) has userType: 'admin',
  // which is what identifies them from then on.
  const ADMIN_EMAIL = 'adminnagaready@gmail.com';

  const handleForgotPassword = async (email: string): Promise<void> => {
    try {
      await sendPasswordResetEmail(auth, email);
      console.log('✅ Password reset email sent to:', email);
    } catch (error: any) {
      console.error('Forgot password error:', error);
      if (error.code === 'auth/user-not-found') throw new Error('No account found with this email address.');
      else if (error.code === 'auth/invalid-email') throw new Error('Invalid email address. Please check and try again.');
      else if (error.code === 'auth/too-many-requests') throw new Error('Too many requests. Please try again later.');
      else throw new Error('Failed to send reset email. Please try again.');
    }
  };

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    localStorage.setItem('lastActiveTab', tab);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (isCreatingEOCRef.current) return;

      setUser(currentUser);
      if (currentUser) {
        adminEmailRef.current = currentUser.email;
        
        if (currentUser.email === ADMIN_EMAIL) {
          setUserRole('admin');
          setIsAuthenticated(true);
          localStorage.setItem('adminAuthenticated', 'true');
          localStorage.setItem('adminUser', currentUser.email || '');
        } else {
          try {
            const db = getFirestore();
            let userDoc = await getDoc(doc(db, 'manage_users', currentUser.uid));
            if (!userDoc.exists()) userDoc = await getDoc(doc(db, 'users', currentUser.uid));
            
            if (userDoc.exists()) {
              const userData = userDoc.data();
              
              if (userData.status === 'inactive') {
                await signOut(auth);
                setIsAuthenticated(false);
                setUserRole(null);
                localStorage.removeItem('adminAuthenticated');
                localStorage.removeItem('adminUser');
                setLoading(false);
                alert('⚠️ Your account has been deactivated. Please contact your administrator.');
                return;
              }
              
              const userType = userData.userType || userData.type;
              
              if (userType === 'eoc') setUserRole('eoc');
              else if (userType === 'admin') setUserRole('admin');
              else setUserRole('eoc');
            } else {
              await signOut(auth);
              setIsAuthenticated(false);
              setUserRole(null);
              localStorage.removeItem('adminAuthenticated');
              localStorage.removeItem('adminUser');
              setLoading(false);
              alert('❌ User account not found. Please contact your administrator.');
              return;
            }
            
            setIsAuthenticated(true);
            localStorage.setItem('adminAuthenticated', 'true');
            localStorage.setItem('adminUser', currentUser.email || '');
          } catch (error) {
            console.error('Error fetching user role:', error);
            if (currentUser.email === ADMIN_EMAIL) setUserRole('admin');
            else setUserRole('eoc');
            setIsAuthenticated(true);
            localStorage.setItem('adminAuthenticated', 'true');
            localStorage.setItem('adminUser', currentUser.email || '');
          }
        }
      } else {
        setIsAuthenticated(false);
        setUserRole(null);
        localStorage.removeItem('adminAuthenticated');
        localStorage.removeItem('adminUser');
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleLogin = async (username: string, password: string): Promise<boolean> => {
    try {
      setAuthError('');
      const userCredential = await signInWithEmailAndPassword(auth, username, password);
      const loggedInUser = userCredential.user;
      let role: 'admin' | 'eoc' | null = null;
      
      adminEmailRef.current = loggedInUser.email;
      
      if (loggedInUser.email === ADMIN_EMAIL) {
        role = 'admin';
        setUserRole('admin');
        setUser(loggedInUser);
        setIsAuthenticated(true);
        localStorage.setItem('adminAuthenticated', 'true');
        localStorage.setItem('adminUser', loggedInUser.email || '');
        setActiveTab('dashboard');
        localStorage.setItem('lastActiveTab', 'dashboard');
        return true;
      } else {
        try {
          const db = getFirestore();
          let userDoc = await getDoc(doc(db, 'manage_users', loggedInUser.uid));
          if (!userDoc.exists()) userDoc = await getDoc(doc(db, 'users', loggedInUser.uid));
          
          if (userDoc.exists()) {
            const userData = userDoc.data();
            if (userData.status === 'inactive') {
              await signOut(auth);
              setAuthError('⚠️ Your account has been deactivated. Please contact your administrator.');
              return false;
            }
            
            const userType = userData.userType || userData.type;
            if (userType === 'eoc') { role = 'eoc'; setUserRole('eoc'); } 
            else if (userType === 'admin') { role = 'admin'; setUserRole('admin'); } 
            else { role = 'eoc'; setUserRole('eoc'); }
          } else {
            await signOut(auth);
            setAuthError('❌ User account not found. Please contact your administrator.');
            return false;
          }
        } catch (error) {
          role = 'eoc';
          setUserRole('eoc');
        }
      }
      
      if (!role) {
        if (loggedInUser.email === ADMIN_EMAIL) { role = 'admin'; setUserRole('admin'); } 
        else { role = 'eoc'; setUserRole('eoc'); }
      }
      
      setUser(loggedInUser);
      setIsAuthenticated(true);
      localStorage.setItem('adminAuthenticated', 'true');
      localStorage.setItem('adminUser', loggedInUser.email || '');
      
      if (role === 'admin') {
        setActiveTab('dashboard');
        localStorage.setItem('lastActiveTab', 'dashboard');
      }
      return true;
    } catch (error: any) {
      const errorMessages: { [key: string]: string } = {
        'auth/user-not-found': 'No account found with this email.',
        'auth/wrong-password': 'Incorrect password. Please try again.',
        'auth/invalid-email': 'Please enter a valid email address.',
        'auth/too-many-requests': 'Too many failed attempts. Please try again later.',
        'auth/network-request-failed': 'Network error. Please check your connection.',
      };
      setAuthError(errorMessages[error.code] || 'Invalid username or password. Please try again.');
      return false;
    }
  };

  const handleLogoutFromNavbar = async () => {
    try {
      await signOut(auth);
      setUser(null);
      setIsAuthenticated(false);
      setUserRole(null);
      adminEmailRef.current = null;
      localStorage.removeItem('adminAuthenticated');
      localStorage.removeItem('adminUser');
    } catch (error) { console.error('Logout error:', error); }
  };

  const setEOCCreating = (creating: boolean) => {
    isCreatingEOCRef.current = creating;
  };

  useEffect(() => {
    const mockIncidents: Incident[] = [
      { id: 1, type: '🔥 Fire', location: 'Downtown', status: 'Pending', severity: 'High', reportedAt: '2024-01-15T10:30:00', assignedTo: 'Team Alpha', description: 'Building fire on Main Street', responseTime: 4.2 },
      { id: 2, type: '🏥 Medical', location: 'Northside', status: 'Resolved', severity: 'Critical', reportedAt: '2024-01-15T09:15:00', assignedTo: 'Medic Unit 1', description: 'Heart attack emergency', responseTime: 2.5 },
      { id: 3, type: '🚗 Accident', location: 'Highway 101', status: 'In Progress', severity: 'High', reportedAt: '2024-01-15T11:00:00', assignedTo: 'Tow Team', description: 'Multi-vehicle collision', responseTime: 5.1 },
      { id: 4, type: '💧 Flood', location: 'East District', status: 'Pending', severity: 'Medium', reportedAt: '2024-01-15T08:45:00', assignedTo: null, description: 'Street flooding', responseTime: undefined },
      { id: 5, type: '🌊 Earthquake', location: 'West Hills', status: 'Resolved', severity: 'Critical', reportedAt: '2024-01-14T23:20:00', assignedTo: 'Rescue Squad', description: '4.2 magnitude earthquake', responseTime: 3.8 }
    ];
    setIncidents(mockIncidents);
  }, []);

  const renderDashboard = () => (
    <DashboardHome user={user} userRole={userRole} incidents={incidents} onTabChange={handleTabChange} />
  );

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard': return renderDashboard();
      case 'incidents': return <IncidentReports incidents={incidents} setSelectedIncident={setSelectedIncident} />;
      case 'validate': return <ValidateIncident />;
      case 'users': return <ManageUsers onEOCCreating={setEOCCreating} />;
      default: return renderDashboard();
    }
  };

  if (loading) {
    return (
      <div className="app-loading-container">
        <div className="app-loading-content">
          <div className="app-loading-spinner" />
          <p className="app-loading-text">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user || !isAuthenticated) {
    return <CDRRMOLogin onLogin={handleLogin} onForgotPassword={handleForgotPassword} />;
  }

  // Admin = the original admin email OR any account whose Firestore doc says userType: 'admin'
  // (this is what keeps the admin recognised after they change their email)
  const isAdminAccount = user.email === ADMIN_EMAIL || userRole === 'admin';

  if (!isAdminAccount && userRole === 'eoc' && !isCreatingEOCRef.current) {
    return <AppEOC onLogout={handleLogoutFromNavbar} />;
  }

  return (
    <div className="app">
      <Navbar activeTab={activeTab} setActiveTab={handleTabChange} onLogout={handleLogoutFromNavbar} />
      <main className="main-content">
        {renderContent()}
      </main>

      {selectedIncident !== null && (
        <div className="modal-overlay" onClick={() => setSelectedIncident(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Incident #{selectedIncident.id} Details</h3>
              <button className="modal-close" onClick={() => setSelectedIncident(null)}>×</button>
            </div>
            <div className="modal-body">
              <div className="detail-row"><span className="detail-label">Type:</span><span className="detail-value">{selectedIncident.type}</span></div>
              <div className="detail-row"><span className="detail-label">Location:</span><span className="detail-value">{selectedIncident.location}</span></div>
              <div className="detail-row"><span className="detail-label">Status:</span><span className={`status-badge ${selectedIncident.status.toLowerCase().replace(' ', '-')}`}>{selectedIncident.status}</span></div>
              <div className="detail-row"><span className="detail-label">Severity:</span><span className={`severity-badge ${selectedIncident.severity.toLowerCase()}`}>{selectedIncident.severity}</span></div>
              <div className="detail-row"><span className="detail-label">Description:</span><span className="detail-value">{selectedIncident.description ?? 'No description provided'}</span></div>
              <div className="detail-row"><span className="detail-label">Assigned To:</span><span className="detail-value">{selectedIncident.assignedTo ?? 'Unassigned'}</span></div>
              <div className="detail-row"><span className="detail-label">Reported At:</span><span className="detail-value">{new Date(selectedIncident.reportedAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}</span></div>
            </div>
            <div className="modal-footer">
              <button className="btn-primary">Assign Responder</button>
              <button className="btn-secondary">Update Status</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;