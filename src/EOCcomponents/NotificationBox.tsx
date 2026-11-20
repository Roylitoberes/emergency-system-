// web/src/EOCcomponents/NotificationBox.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  doc,
  setDoc,
  collection,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { firestore } from '../firebase';
import { notificationService } from '../services/notificationService';
import type { Notification } from '../services/notificationService';
import '../css/NotificationBox.css';

interface NotificationBoxProps {
  onNavigateToIncidentIntake?: () => void;
  isOpen?: boolean;
  onToggle?: () => void;
  onClose?: () => void;
}

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

// ============================================================
// ✅ HELPER: Play notification sound (stops after 20 seconds)
// ============================================================
let currentAudio: HTMLAudioElement | null = null;
let currentAudioTimeout: ReturnType<typeof setTimeout> | null = null;

const stopNotificationSound = () => {
  // ✅ Also cancel any vibration (passing 0 stops it)
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(0);
      navigator.vibrate([]);
    }
  } catch (e) {
    // ignore
  }

  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    } catch (e) {
      // ignore
    }
    currentAudio = null;
    console.log('🔇 Notification sound stopped');
  }
  if (currentAudioTimeout) {
    clearTimeout(currentAudioTimeout);
    currentAudioTimeout = null;
  }
};

const playNotificationSound = () => {
  try {
    console.log('🔊 playNotificationSound called');

    // Stop any previous sound first (avoid overlap)
    stopNotificationSound();

    const audio = new Audio('/notification-sound.mp3');
    audio.volume = 0.5;
    audio.loop = true; // keep playing until we stop it
    currentAudio = audio;

    audio
      .play()
      .then(() => console.log('   ✅ audio playing (will stop after 20s)'))
      .catch((e) => console.log('   ❌ audio failed:', e?.message || e));

    // ✅ Automatically stop after 20 seconds
    currentAudioTimeout = setTimeout(() => {
      console.log('⏱️ 20 seconds elapsed — stopping notification sound');
      stopNotificationSound();
    }, 20000);
  } catch (error) {
    console.log('❌ Error playing notification sound:', error);
  }
};

// ============================================================
// ✅ HELPER: Trigger vibration (Android only — silently no-ops on iOS/desktop)
// ============================================================
const triggerVibration = () => {
  try {
    console.log('📳 triggerVibration called');
    const supported =
      typeof navigator !== 'undefined' && 'vibrate' in navigator;
    console.log('   navigator.vibrate exists?', supported);
    console.log('   document.hidden?', document.hidden);

    if (!supported) {
      console.log('   ❌ Vibration API not supported on this device/browser');
      return;
    }
    const ok = navigator.vibrate([200, 100, 200]);
    console.log('   vibrate() returned:', ok);
  } catch (error) {
    console.log('❌ Vibration error:', error);
  }
};

// ============================================================
// ✅ HELPER: Find the real app user who sent a report (not 'eoc-user').
// Uses targeted lookups instead of downloading the whole
// incident_reports collection.
// ============================================================
const findReporterUserId = async (reportId: string): Promise<string | null> => {
  if (!reportId) return null;

  const reportsRef = collection(firestore, 'incident_reports');
  const candidates: any[] = [];

  try {
    const [byDocId, byIncidentId, byReportId] = await Promise.all([
      getDoc(doc(firestore, 'incident_reports', reportId)).catch(() => null),
      getDocs(query(reportsRef, where('incidentId', '==', reportId))).catch(() => null),
      getDocs(query(reportsRef, where('reportId', '==', reportId))).catch(() => null),
    ]);

    if (byDocId && byDocId.exists()) candidates.push(byDocId.data());
    byIncidentId?.forEach((d) => candidates.push(d.data()));
    byReportId?.forEach((d) => candidates.push(d.data()));
  } catch (error) {
    console.error('Error looking up reporter:', error);
  }

  const match = candidates.find((c) => c?.userId && c.userId !== 'eoc-user');
  return match ? String(match.userId) : null;
};

const NotificationBox: React.FC<NotificationBoxProps> = ({
  onNavigateToIncidentIntake,
  isOpen: externalIsOpen,
  onToggle,
  onClose,
}) => {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dropdownOpenId, setDropdownOpenId] = useState<string | null>(null);
  // ✅ controls the "Are you sure you want to delete all?" popup
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const dropdownRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const panelRef = useRef<HTMLDivElement | null>(null);

  // ✅ Track already-logged notifications so we don't spam the feed
  const loggedNotificationIdsRef = useRef<Set<string>>(new Set());

  // ✅ Track already-alerted notifications so we don't spam sound/vibration
  const alertedNotificationIdsRef = useRef<Set<string>>(new Set());

  // ✅ Notifications currently being verified in the background
  const verifyingIdsRef = useRef<Set<string>>(new Set());

  const isFirstLoadRef = useRef(true);

  const isOpen = externalIsOpen !== undefined ? externalIsOpen : internalIsOpen;

  // ✅ Always-current copies of values the long-lived listeners need.
  // (This lets the listeners below be set up ONCE instead of being torn down
  //  and re-created every time the parent re-renders.)
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dropdownOpenIdRef = useRef(dropdownOpenId);
  dropdownOpenIdRef.current = dropdownOpenId;

  const closeDropdown = () => {
    if (onClose) {
      onClose();
    } else {
      setInternalIsOpen(false);
    }
  };

  // ============================================================
  // ✅ AUDIO UNLOCK: browsers block audio until user interacts.
  //    We "prime" an Audio element on the first click/keypress.
  // ============================================================
  useEffect(() => {
    const unlockAudio = () => {
      try {
        const audio = new Audio('/notification-sound.mp3');
        audio.volume = 0;
        audio
          .play()
          .then(() => {
            audio.pause();
            audio.currentTime = 0;
            console.log('🔓 Audio unlocked for future notifications');
          })
          .catch((err) => {
            console.log('Audio unlock failed:', err?.message || err);
          });
      } catch (err) {
        console.log('Audio unlock error:', err);
      }
      document.removeEventListener('click', unlockAudio);
      document.removeEventListener('keydown', unlockAudio);
      document.removeEventListener('touchstart', unlockAudio);
    };

    document.addEventListener('click', unlockAudio);
    document.addEventListener('keydown', unlockAudio);
    document.addEventListener('touchstart', unlockAudio);

    return () => {
      document.removeEventListener('click', unlockAudio);
      document.removeEventListener('keydown', unlockAudio);
      document.removeEventListener('touchstart', unlockAudio);
    };
  }, []);

  // ============================================================
  // ✅ FIRESTORE LISTENER — set up ONCE.
  // Before, this effect depended on [dropdownOpenId, isOpen, onClose], so it
  // re-subscribed every time the dropdown opened or the parent re-rendered
  // (and stacked up a new new-notification callback each time).
  // ============================================================
  useEffect(() => {
    const unsubscribe = notificationService.listenForNotifications(
      (newNotifications) => {
        console.log(
          '🔔 [listenForNotifications] snapshot received, count:',
          newNotifications.length
        );

        setNotifications(newNotifications);
        setUnreadCount(newNotifications.filter((n) => !n.read).length);
        setLoading(false);

        if (isFirstLoadRef.current) {
          // Mark everything as already-seen on first load so we don't alert on mount
          newNotifications.forEach((n) => {
            loggedNotificationIdsRef.current.add(n.id);
            alertedNotificationIdsRef.current.add(n.id);
          });
          isFirstLoadRef.current = false;
        } else {
          newNotifications.forEach((n) => {
            // Log to activity feed only once
            if (!loggedNotificationIdsRef.current.has(n.id)) {
              loggedNotificationIdsRef.current.add(n.id);
              const type =
                n.incidentType === 'Other' && n.specificType
                  ? `Others – ${n.specificType}`
                  : n.incidentType;
              logActivity({
                icon: 'alert-triangle',
                tone: n.priority === 'critical' ? 'clay' : 'gold',
                title: 'New incident report',
                meta: `${type} at ${
                  n.location?.address || 'unknown location'
                } — reported by ${n.reporter?.fullName || 'Unknown'}`,
              });
            }

            // Play sound + vibrate once per new notification
            if (!alertedNotificationIdsRef.current.has(n.id)) {
              alertedNotificationIdsRef.current.add(n.id);
              console.log('🆕 New notification detected:', n.id);
              playNotificationSound();
              triggerVibration();
            }
          });
        }
      },
      (error) => {
        console.error('Notification error:', error);
        setLoading(false);
      }
    );

    notificationService.onNewNotification((notification) => {
      console.log(
        '🚨 [onNewNotification] fired for:',
        notification.id,
        notification.incidentType
      );

      // Gate by ref so we don't spam sound/vibration
      if (alertedNotificationIdsRef.current.has(notification.id)) {
        console.log('   ↳ already alerted, skipping');
        return;
      }
      alertedNotificationIdsRef.current.add(notification.id);

      playNotificationSound();
      triggerVibration();

      if (typeof window !== 'undefined' && 'Notification' in window) {
        if (window.Notification.permission === 'granted') {
          new window.Notification('🚨 New Incident Report', {
            body: `${notification.incidentType} reported by ${notification.reporter.fullName}`,
            icon: '/favicon.ico',
          });
        }
      }
    });

    if (typeof window !== 'undefined' && 'Notification' in window) {
      window.Notification.requestPermission();
    }

    return () => {
      unsubscribe();
      notificationService.cleanup();
      // ✅ Stop any playing sound when component unmounts
      stopNotificationSound();
    };
  }, []);

  // ============================================================
  // ✅ CLICK-OUTSIDE HANDLER — also set up ONCE (reads current values via refs)
  // ============================================================
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const openMenuId = dropdownOpenIdRef.current;
      if (openMenuId) {
        const ref = dropdownRefs.current[openMenuId];
        if (ref && !ref.contains(event.target as Node)) {
          setDropdownOpenId(null);
        }
      }

      if (isOpenRef.current && onCloseRef.current) {
        const panel = panelRef.current;
        if (panel && !panel.contains(event.target as Node)) {
          onCloseRef.current();
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const toggleDropdown = () => {
    // ✅ Stop the alarm the moment the EOC user opens the panel
    stopNotificationSound();

    if (onToggle) {
      onToggle();
    } else {
      setInternalIsOpen(!internalIsOpen);
    }

    // ✅ CHANGED: opening the bell NO LONGER marks everything as read.
    // New reports stay UNREAD until the EOC user clicks the report card.
  };

  const handleMarkAllAsRead = async () => {
    try {
      const unreadCountBefore = notifications.filter((n) => !n.read).length;
      await notificationService.markAllAsRead();
      setNotifications(notifications.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);

      if (unreadCountBefore > 0) {
        logActivity({
          icon: 'check-circle-2',
          tone: 'forest',
          title: 'Notifications marked as read',
          meta: `${unreadCountBefore} notification${
            unreadCountBefore > 1 ? 's' : ''
          } marked as read by EOC`,
        });
      }
    } catch (error) {
      console.error('Error marking all as read:', error);
    }
  };

  // ============================================================
  // ✅ DELETE ALL (runs only after the user confirms in the popup)
  // ============================================================
  const handleDeleteAll = async () => {
    try {
      const count = notifications.length;
      await notificationService.deleteAllNotifications();
      setNotifications([]);
      setUnreadCount(0);
      setDropdownOpenId(null);
      setShowDeleteAllConfirm(false);

      if (count > 0) {
        logActivity({
          icon: 'trash-2',
          tone: 'clay',
          title: 'All notifications deleted',
          meta: `${count} notification${count > 1 ? 's' : ''} deleted by EOC`,
        });
      }
    } catch (error) {
      console.error('Error deleting all notifications:', error);
      setShowDeleteAllConfirm(false);
    }
  };

  // ============================================================
  // ✅ VERIFY IN THE BACKGROUND
  // Marks the report verified, logs it, and notifies the reporter.
  // This used to run BEFORE navigating, so after one click nothing happened
  // for a few seconds (and people clicked a second time). It now runs AFTER
  // the page has already switched, and it will not run twice for the same
  // notification.
  // ============================================================
  const verifyNotificationInBackground = async (notification: Notification) => {
    // Already verified earlier → nothing more to send
    if ((notification.status as string) === 'verified') return;
    // Already being verified (e.g. a second click) → don't do it twice
    if (verifyingIdsRef.current.has(notification.id)) return;
    verifyingIdsRef.current.add(notification.id);

    try {
      await notificationService.markAsVerified(notification.id);

      const displayType =
        notification.incidentType === 'Other' && notification.specificType
          ? `Others – ${notification.specificType}`
          : notification.incidentType;
      logActivity({
        icon: 'check-circle-2',
        tone: 'forest',
        title: 'Incident report verified',
        meta: `${displayType} at ${
          notification.location?.address || 'unknown location'
        } — verified by EOC`,
      });

      try {
        const userId = await findReporterUserId(notification.reportId);
        if (userId) {
          await notificationService.sendVerificationNotification(
            userId,
            notification.reportId,
            notification.incidentType
          );
        }
      } catch (notifError) {
        console.error('Error sending verification notification:', notifError);
      }
    } catch (error) {
      console.error('Error auto-verifying notification:', error);
    } finally {
      verifyingIdsRef.current.delete(notification.id);
    }
  };

  // ============================================================
  // ✅ ONE CLICK: go to Incident Intake IMMEDIATELY, verify afterwards.
  // ✅ ALSO: stop the alarm sound immediately on click.
  // ✅ NEW: clicking a report automatically marks it as READ.
  // (no active-report guard anymore — any report can be opened at any time)
  // ============================================================
  const handleNotificationClick = (notification: Notification) => {
    // ✅ STOP THE ALARM SOUND IMMEDIATELY
    stopNotificationSound();

    // ✅ Make sure nothing already shown can ring/vibrate again after this click
    notifications.forEach((n) => alertedNotificationIdsRef.current.add(n.id));

    // ✅ NEW: automatically mark as read when the report is clicked
    if (!notification.read) {
      notificationService.markAsRead(notification.id).catch(console.error);
      setUnreadCount((c) => Math.max(0, c - 1));
    }

    const verifiedNotification = { ...notification, status: 'verified', read: true };

    // 1) Hand the notification to Incident Intake + close + navigate — right now
    sessionStorage.setItem(
      'selectedNotification',
      JSON.stringify(verifiedNotification)
    );

    setNotifications((prev) =>
      prev.map((n) =>
        n.id === notification.id
          ? { ...n, status: 'verified' as any, read: true }
          : n
      )
    );

    closeDropdown();

    window.dispatchEvent(
      new CustomEvent('newIncidentNotification', {
        detail: verifiedNotification,
      })
    );

    if (onNavigateToIncidentIntake) {
      onNavigateToIncidentIntake();
    }

    // 2) Do the slow network work in the background
    void verifyNotificationInBackground(notification);
  };

  const toggleThreeDotMenu = (
    notificationId: string,
    event: React.MouseEvent
  ) => {
    event.stopPropagation();
    setDropdownOpenId(
      dropdownOpenId === notificationId ? null : notificationId
    );
  };

  // (kept as-is; the "Mark as Read/Unread" menu item was removed from the card,
  //  so this is currently unused)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars

  const handleDelete = async (
    notificationId: string,
    event: React.MouseEvent
  ) => {
    event.stopPropagation();
    try {
      const notification = notifications.find((n) => n.id === notificationId);

      await notificationService.deleteNotification(notificationId);
      const updatedNotifications = notifications.filter(
        (n) => n.id !== notificationId
      );
      setNotifications(updatedNotifications);
      setUnreadCount(updatedNotifications.filter((n) => !n.read).length);
      setDropdownOpenId(null);

      if (notification) {
        const displayType =
          notification.incidentType === 'Other' && notification.specificType
            ? `Others – ${notification.specificType}`
            : notification.incidentType;
        logActivity({
          icon: 'trash-2',
          tone: 'clay',
          title: 'Notification deleted',
          meta: `${displayType} at ${
            notification.location?.address || 'unknown location'
          }`,
        });
      }
    } catch (error) {
      console.error('Error deleting notification:', error);
    }
  };

  const getTypeClass = (priority: string) => {
    switch (priority) {
      case 'critical':
        return 'notification-critical';
      case 'high':
        return 'notification-high';
      case 'normal':
        return 'notification-normal';
      default:
        return 'notification-info';
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'pending':
        return 'status-pending';
      case 'acknowledged':
        return 'status-acknowledged';
      case 'dispatched':
        return 'status-dispatched';
      case 'resolved':
        return 'status-resolved';
      case 'verified':
        return 'status-verified';
      default:
        return '';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'pending':
        return 'Pending';
      case 'acknowledged':
        return 'Acknowledged';
      case 'dispatched':
        return 'Dispatched';
      case 'resolved':
        return 'Resolved';
      case 'verified':
        return 'Verified';
      default:
        return status;
    }
  };

  const getIncidentIcon = (type: string) => {
    const icons: { [key: string]: string } = {
      Fire: 'fa-fire',
      Medical: 'fa-ambulance',
      Flood: 'fa-water',
      Crime: 'fa-shield',
      Accident: 'fa-car',
      Other: 'fa-bell',
    };
    return icons[type] || 'fa-bell';
  };

  const getIncidentColor = (type: string) => {
    const colors: { [key: string]: string } = {
      Fire: '#FF6B35',
      Medical: '#dc3545',
      Flood: '#2196F3',
      Crime: '#9C27B0',
      Accident: '#FF9800',
      Other: '#607D8B',
    };
    return colors[type] || '#17a2b8';
  };

  const getCasualtiesText = (casualties: any) => {
    if (!casualties) return '';
    const parts = [];
    if (casualties.injured > 0) parts.push(`👨‍⚕️ ${casualties.injured} Injured`);
    if (casualties.fatalities > 0)
      parts.push(`💀 ${casualties.fatalities} Fatalities`);
    if (casualties.trapped > 0) parts.push(`🚧 ${casualties.trapped} Trapped`);
    return parts.length > 0 ? parts.join(' • ') : 'No casualties reported';
  };

  const getDisplayType = (notification: Notification) => {
    if (
      notification.incidentType === 'Other' &&
      notification.specificType &&
      notification.specificType.trim().length > 0
    ) {
      return `Others – ${notification.specificType}`;
    }
    return notification.incidentType;
  };

  if (loading) {
    return (
      <div className="notification-box-container">
        <div className="nav-item">
          <a href="#" className="nav-link">
            <i className="fa fa-bell"></i>
            <span className="badge">...</span>
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="notification-box-container">
      <div className="nav-item dropdown">
        <a
          href="#"
          className="nav-link dropdown-toggle"
          onClick={(e) => {
            e.preventDefault();
            toggleDropdown();
          }}
        >
          <i className="fa fa-bell"></i>
          {unreadCount > 0 && (
            <span className="badge pulse-badge">{unreadCount}</span>
          )}
        </a>

        {isOpen && (
          <>
            <div
              className="dropdown-backdrop"
              onClick={() => {
                closeDropdown();
              }}
            ></div>
            <div className="notification-dropdown" ref={panelRef}>
              <div className="dropdown-header">
                <h6>
                  <i className="fa fa-bell me-2"></i>Notifications
                </h6>
                <div className="header-actions">
                  {unreadCount > 0 && (
                    <button
                      className="mark-all-read"
                      onClick={handleMarkAllAsRead}
                    >
                      Mark all as read
                    </button>
                  )}
                  {notifications.length > 0 && (
                    <button
                      className="delete-all"
                      onClick={() => setShowDeleteAllConfirm(true)}
                    >
                      Delete all
                    </button>
                  )}
                </div>
              </div>

              <div className="notification-list">
                {notifications.length === 0 ? (
                  <div className="no-notifications">
                    <i className="fa fa-bell-slash"></i>
                    <p>No notifications</p>
                  </div>
                ) : (
                  notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={`notification-item ${
                        !notification.read ? 'unread' : ''
                      } ${getTypeClass(notification.priority)}`}
                      onPointerDown={() => stopNotificationSound()}
                      onClick={() => handleNotificationClick(notification)}
                    >
                      {!notification.read && (
                        <div className="unread-indicator">
                          <div className="unread-dot"></div>
                          <div className="unread-pulse"></div>
                        </div>
                      )}

                      {notification.read && (
                        <div className="read-indicator">
                          <i className="fa fa-check-circle"></i>
                        </div>
                      )}

                      <div
                        className="notification-icon"
                        style={{
                          background: `${getIncidentColor(
                            notification.incidentType
                          )}15`,
                        }}
                      >
                        <i
                          className={`fa ${getIncidentIcon(
                            notification.incidentType
                          )}`}
                          style={{
                            color: getIncidentColor(notification.incidentType),
                          }}
                        ></i>
                      </div>
                      <div className="notification-content">
                        <div className="notification-header">
                          <span className="notification-title">
                            🚨 {getDisplayType(notification)} Incident Report
                          </span>
                          <div className="notification-actions">
                            <span
                              className={`status-badge ${getStatusBadgeClass(
                                notification.status
                              )}`}
                            >
                              {getStatusLabel(notification.status)}
                            </span>
                            {notification.priority === 'critical' && (
                              <span className="priority-badge critical">
                                ⚠️ CRITICAL
                              </span>
                            )}
                            <button
                              className="three-dot-btn"
                              onClick={(e) =>
                                toggleThreeDotMenu(notification.id, e)
                              }
                            >
                              <i className="fa fa-ellipsis-v"></i>
                            </button>
                            {dropdownOpenId === notification.id && (
                              <div
                                className="three-dot-dropdown"
                                ref={(el) => {
                                  dropdownRefs.current[notification.id] = el;
                                }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {/* ✅ "Mark as Read/Unread" removed — only Delete remains */}
                                <div
                                  className="dropdown-item"
                                  onClick={(e) =>
                                    handleDelete(notification.id, e)
                                  }
                                >
                                  <i className="fa fa-trash"></i>
                                  Delete
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                        <p className="notification-message">
                          <strong>{notification.reporter.fullName}</strong>{' '}
                          reported a{' '}
                          <strong>{getDisplayType(notification)}</strong>{' '}
                          incident at{' '}
                          <strong>
                            {notification.location?.address ||
                              'unknown location'}
                          </strong>
                        </p>
                        <p className="notification-description">
                          {notification.description}
                        </p>
                        <div className="notification-casualties">
                          <span className="casualties-label">
                            <i className="fa fa-users"></i> Casualties:
                          </span>
                          <span className="casualties-details">
                            {getCasualtiesText(notification.casualties)}
                          </span>
                        </div>
                        {notification.incidentType === 'Other' &&
                          notification.specificType && (
                            <p className="notification-specific-type">
                              <i className="fa fa-tag"></i>{' '}
                              <span className="specific-type-label">
                                Specific Type:
                              </span>{' '}
                              <strong>{notification.specificType}</strong>
                            </p>
                          )}
                        <div className="notification-footer">
                          <span className="notification-time">
                            <i className="fa fa-clock-o"></i>{' '}
                            {notification.timestamp
                              ?.toDate?.()
                              .toLocaleString() || 'Just now'}
                          </span>
                          {!notification.read && (
                            <span className="unread-badge">🔴 UNREAD</span>
                          )}
                          {notification.read && (
                            <span className="read-badge">🟢 READ</span>
                          )}
                        </div>
                        {notification.hasPhoto && (
                          <div className="notification-photo-indicator">
                            <i className="fa fa-image"></i> Photo attached
                          </div>
                        )}
                        <div className="notification-click-hint">
                          <i className="fa fa-arrow-right"></i> Click to view
                          details
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="dropdown-footer">
                <a
                  href="#"
                  className="view-all"
                  onClick={(e) => {
                    e.preventDefault();
                    if (onNavigateToIncidentIntake) {
                      onNavigateToIncidentIntake();
                    }
                  }}
                >
                  View All Incidents <i className="fa fa-arrow-right"></i>
                </a>
              </div>

              {/* ✅ Delete-all confirmation popup */}
              {showDeleteAllConfirm && (
                <div
                  className="confirm-overlay"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="confirm-box">
                    <i className="fa fa-trash confirm-icon"></i>
                    <h6>Are you sure you want to delete all?</h6>
                    <p>This will permanently remove all notifications.</p>
                    <div className="confirm-actions">
                      <button
                        className="confirm-cancel"
                        onClick={() => setShowDeleteAllConfirm(false)}
                      >
                        Cancel
                      </button>
                      <button
                        className="confirm-delete"
                        onClick={handleDeleteAll}
                      >
                        Yes, delete all
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default NotificationBox;