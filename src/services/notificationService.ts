// web/src/services/notificationService.ts
import { firestore } from '../firebase';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  doc, 
  updateDoc,
  getDocs,
  where,
  writeBatch,
  limit,
  deleteDoc,
  addDoc,
  serverTimestamp
} from 'firebase/firestore';

export interface Notification {
  id: string;
  reportId: string;
  incidentType: string;
  specificType?: string | null;
  reporter: {
    fullName: string;
    phoneNumber: string;
  };
  location: any;
  description: string;
  photoUrl: string | null;
  hasPhoto: boolean;
  status: 'pending' | 'acknowledged' | 'dispatched' | 'resolved';
  timestamp: any;
  read: boolean;
  createdAt: any;
  type: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  casualties: {
    injured: number;
    fatalities: number;
    trapped: number;
  };
}

class NotificationService {
  private static instance: NotificationService;
  private unsubscribe: (() => void) | null = null;
  private notificationCallbacks: ((notification: Notification) => void)[] = [];

  private constructor() {}

  public static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  // ─────────────────────────────────────────────────────────
  // ✅ NEW: Send a real remote push via Expo Push API
  //    Called automatically whenever we write to user_notifications
  //    so the phone shows a banner even when the app is closed.
  // ─────────────────────────────────────────────────────────
  async sendPushToUser(
    userId: string,
    title: string,
    body: string,
    data: Record<string, any> = {}
  ): Promise<void> {
    try {
      // 1) Look up the user's Expo push token
      const tokenSnap = await getDocs(
        query(
          collection(firestore, 'user_push_tokens'),
          where('userId', '==', userId),
          limit(1)
        )
      );

      if (tokenSnap.empty) {
        console.warn('⚠️ No push token for user:', userId);
        return;
      }

      const tokenData = tokenSnap.docs[0].data();
      const token = tokenData?.token?.toString();
      if (!token) return;

      // 2) Send to Expo Push API
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: token,
          sound: 'default',
          title,
          body,
          data,
          priority: 'high',
          channelId: 'default',
        }),
      });

      const result = await response.json();
      console.log('📤 Push sent to', userId, ':', result);
    } catch (e) {
      console.warn('sendPushToUser error:', e);
    }
  }

  async sendEmergencyReport(incidentData: any): Promise<string> {
    try {
      const notificationsRef = collection(firestore, 'notifications');
      
      const reportData = {
        reportId: incidentData.reportId || `RPT-${Date.now()}`,
        incidentType: incidentData.incidentType || 'Unknown',
        specificType: incidentData.specificType || null,
        reporter: incidentData.reporter || { fullName: 'Unknown', phoneNumber: 'N/A' },
        location: incidentData.location || { address: 'Unknown location' },
        description: incidentData.description || 'No description provided',
        photoUrl: incidentData.photoUrl || null,
        hasPhoto: incidentData.hasPhoto || false,
        status: 'pending',
        read: false,
        type: 'incident_report',
        priority: incidentData.priority || 'normal',
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
        casualties: incidentData.casualties || {
          injured: 0,
          fatalities: 0,
          trapped: 0
        },
        lat: incidentData.lat || null,
        lng: incidentData.lng || null,
      };

      const docRef = await addDoc(notificationsRef, reportData);
      console.log('✅ Emergency report sent directly to Firebase:', docRef.id);
      
      const incidentQueueRef = collection(firestore, 'incident_queue');
      const queueData = {
        incidentId: reportData.reportId,
        type: incidentData.incidentType || 'Unknown',
        specificType: incidentData.specificType || null,
        location: incidentData.location?.address || incidentData.location || 'Unknown location',
        reportedAt: new Date().toLocaleString(),
        priority: incidentData.priority === 'critical' ? 'high' : 
                  incidentData.priority === 'high' ? 'medium' : 'low',
        source: 'Mobile App',
        status: 'review',
        reporter: incidentData.reporter || { fullName: 'Unknown', phoneNumber: 'N/A' },
        description: incidentData.description || 'No description provided',
        lat: incidentData.lat || 14.5995,
        lng: incidentData.lng || 120.9842,
        address: incidentData.location?.address || incidentData.location || 'Unknown location',
        photoUrl: incidentData.photoUrl || null,
        hasPhoto: incidentData.hasPhoto || false,
        casualties: incidentData.casualties || {
          injured: 0,
          fatalities: 0,
          trapped: 0
        },
        isDeleted: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      
      await addDoc(incidentQueueRef, queueData);
      return docRef.id;
    } catch (error) {
      console.error('❌ Error sending emergency report:', error);
      throw error;
    }
  }

  listenForNotifications(
    onUpdate: (notifications: Notification[]) => void,
    onError: (error: Error) => void,
    limitCount: number = 50
  ): () => void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    const notificationsRef = collection(firestore, 'notifications');
    const q = query(
      notificationsRef,
      orderBy('createdAt', 'desc'),
      limit(limitCount)
    );

    this.unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const notifications: Notification[] = [];
        
        snapshot.forEach((doc) => {
          const data = doc.data();
          notifications.push({
            id: doc.id,
            reportId: data.reportId || '',
            incidentType: data.incidentType || 'Unknown',
            specificType: data.specificType || null,
            reporter: data.reporter || { fullName: 'Unknown', phoneNumber: '' },
            location: data.location || { address: 'Unknown location' },
            description: data.description || '',
            photoUrl: data.photoUrl || null,
            hasPhoto: data.hasPhoto || false,
            status: data.status || 'pending',
            timestamp: data.timestamp,
            read: data.read || false,
            createdAt: data.createdAt,
            type: data.type || 'incident_report',
            priority: data.priority || 'normal',
            casualties: data.casualties || {
              injured: 0,
              fatalities: 0,
              trapped: 0
            },
          });
        });

        const newNotifications = notifications.filter(n => !n.read);
        if (newNotifications.length > 0) {
          newNotifications.forEach(n => {
            this.notificationCallbacks.forEach(cb => cb(n));
          });
        }

        onUpdate(notifications);
      },
      (error) => {
        console.error('Error listening for notifications:', error);
        onError(error);
      }
    );

    return this.unsubscribe;
  }

  onNewNotification(callback: (notification: Notification) => void): void {
    this.notificationCallbacks.push(callback);
  }

  async markAsRead(notificationId: string): Promise<void> {
    try {
      const notificationRef = doc(firestore, 'notifications', notificationId);
      await updateDoc(notificationRef, { read: true });
    } catch (error) {
      console.error('Error marking notification as read:', error);
      throw error;
    }
  }

  async markAsVerified(notificationId: string): Promise<void> {
    try {
      const notificationRef = doc(firestore, 'notifications', notificationId);
      await updateDoc(notificationRef, {
        status: 'verified',
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Error marking notification as verified:', error);
      throw error;
    }
  }

  // ✅ Send notification to NagaReady app user when report is verified
  //    ✅ UPDATED: also sends a real remote push so the phone shows a
  //                banner even when the app is closed.
  async sendVerificationNotification(
    userId: string,
    reportId: string,
    incidentType: string
  ): Promise<void> {
    try {
      const title = '✅ Report Verified';
      const message = `Your emergency report #${reportId} has been verified by CDRRMO.`;

      // 1) Write to user_notifications (in-app list)
      const userNotificationsRef = collection(firestore, 'user_notifications');
      await addDoc(userNotificationsRef, {
        userId: userId,
        reportId: reportId,
        title,
        message,
        incidentType: incidentType,
        read: false,
        createdAt: serverTimestamp(),
        type: 'verification',
      });
      console.log('✅ Verification notification sent to user:', userId);

      // 2) Fire the real remote push (works when app is closed)
      await this.sendPushToUser(userId, title, message, {
        reportId,
        type: 'verification',
      });
    } catch (error) {
      console.error('Error sending verification notification:', error);
      throw error;
    }
  }

  async markAllAsRead(): Promise<void> {
    try {
      const notificationsRef = collection(firestore, 'notifications');
      const q = query(notificationsRef, where('read', '==', false));
      const snapshot = await getDocs(q);
      
      const batch = writeBatch(firestore);
      snapshot.forEach((doc) => {
        batch.update(doc.ref, { read: true });
      });
      
      await batch.commit();
    } catch (error) {
      console.error('Error marking all as read:', error);
      throw error;
    }
  }

  async updateNotificationStatus(
    notificationId: string,
    status: 'pending' | 'acknowledged' | 'dispatched' | 'resolved'
  ): Promise<void> {
    try {
      const notificationRef = doc(firestore, 'notifications', notificationId);
      await updateDoc(notificationRef, {
        status: status,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error updating notification status:', error);
      throw error;
    }
  }

  async deleteNotification(notificationId: string): Promise<void> {
    try {
      const notificationRef = doc(firestore, 'notifications', notificationId);
      await deleteDoc(notificationRef);
    } catch (error) {
      console.error('Error deleting notification:', error);
      throw error;
    }
  }

  // ✅ NEW: Delete every notification (used by the "Delete all" button)
  async deleteAllNotifications(): Promise<void> {
    try {
      const snapshot = await getDocs(collection(firestore, 'notifications'));
      let batch = writeBatch(firestore);
      let count = 0;

      for (const d of snapshot.docs) {
        batch.delete(d.ref);
        count++;
        // Firestore allows max 500 operations per batch
        if (count === 450) {
          await batch.commit();
          batch = writeBatch(firestore);
          count = 0;
        }
      }

      if (count > 0) {
        await batch.commit();
      }
    } catch (error) {
      console.error('Error deleting all notifications:', error);
      throw error;
    }
  }

  async getUnreadCount(): Promise<number> {
    try {
      const notificationsRef = collection(firestore, 'notifications');
      const q = query(notificationsRef, where('read', '==', false));
      const snapshot = await getDocs(q);
      return snapshot.size;
    } catch (error) {
      console.error('Error getting unread count:', error);
      return 0;
    }
  }

  cleanup(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}

export const notificationService = NotificationService.getInstance();