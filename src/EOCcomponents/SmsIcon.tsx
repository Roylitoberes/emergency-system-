// SmsIcon.tsx - FIXED: Works offline + Exact Philippine date/time
// + Sends full SMS data to IncidentIntake via sessionStorage
// + ✅ Auto-verifies SMS in the BACKGROUND after navigating (one click)
// + ✅ Plays sound + vibrates on new SMS (stops after 20s)
// + ✅ Stops the alarm sound immediately when a message is clicked
// + ✅ NEW: "Delete all" button with an "Are you sure?" confirmation popup
// + ✅ NEW: Card menu only has Delete (Mark as Read/Unread removed)
// + ✅ NEW: New SMS stay UNREAD until clicked; clicking a message marks it READ
// + ✅ NEW: Real-time received date & time (stable, never changes after arrival)
// + ✅ REMOVED: Active-report guard (queueing) — any SMS can now be opened even if
//          the current report in Incident Intake has not been forwarded to Dispatch
import React, { useState, useEffect, useRef } from 'react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import { firestore } from '../firebase';
import '../css/SmsIcon.css';

interface SmsMessage {
  id: string;
  sender: string;
  phoneNumber: string;
  message: string;
  timestamp: Date;
  read: boolean;
  priority: 'high' | 'normal' | 'low';
  incidentType?: string;
  location?: string;
  address?: string;
  code?: string;
  source?: string;
}

interface SmsIconProps {
  onClick?: () => void;
  className?: string;
  onNavigateToIncidentIntake?: () => void;
}

// ============================================================
// ✅ SOUND HELPERS (module-level so unmount can stop cleanly)
// ============================================================
let currentAudio: HTMLAudioElement | null = null;
let currentAudioTimeout: ReturnType<typeof setTimeout> | null = null;

const stopNotificationSound = () => {
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    } catch {
      // ignore
    }
    currentAudio = null;
    console.log('🔇 SMS sound stopped');
  }
  if (currentAudioTimeout) {
    clearTimeout(currentAudioTimeout);
    currentAudioTimeout = null;
  }
};

const playNotificationSound = () => {
  try {
    console.log('🔊 playNotificationSound (SMS) called');
    stopNotificationSound();

    const audio = new Audio('/notification-sound.mp3');
    audio.volume = 0.5;
    audio.loop = true;
    currentAudio = audio;

    audio
      .play()
      .then(() => console.log('   ✅ audio playing (will stop after 20s)'))
      .catch((e) => console.log('   ❌ audio failed:', e?.message || e));

    currentAudioTimeout = setTimeout(() => {
      console.log('⏱️ 20 seconds elapsed — stopping SMS sound');
      stopNotificationSound();
    }, 20000);
  } catch (error) {
    console.log('❌ Error playing SMS sound:', error);
  }
};

// ============================================================
// ✅ VIBRATION (Android only — silently no-ops elsewhere)
// ============================================================
const triggerVibration = () => {
  try {
    console.log('📳 triggerVibration (SMS) called');
    const supported =
      typeof navigator !== 'undefined' && 'vibrate' in navigator;
    if (!supported) {
      console.log('   ❌ Vibration API not supported');
      return;
    }
    const ok = navigator.vibrate([200, 100, 200]);
    console.log('   vibrate() returned:', ok);
  } catch (error) {
    console.log('❌ Vibration error:', error);
  }
};

// ============================================================
// ✅ OFFLINE-SAFE UPDATE HELPER
// updateDoc may hang or reject when offline; we never await it
// on the click path — callers fire-and-forget.
// ============================================================
const updateSmsDoc = (id: string, data: Record<string, any>) => {
  updateDoc(doc(firestore, 'emergencyMessages', id), data).catch((error) => {
    console.warn('Could not update SMS doc (offline?):', error?.message || error);
  });
};

// ✅ NEW: fire-and-forget delete (used by "Delete all")
const deleteSmsDoc = (id: string) => {
  deleteDoc(doc(firestore, 'emergencyMessages', id)).catch((error) => {
    console.warn('Could not delete SMS doc (offline?):', error?.message || error);
  });
};

const SmsIcon: React.FC<SmsIconProps> = ({
  onClick,
  className = '',
  onNavigateToIncidentIntake,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dropdownOpenId, setDropdownOpenId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // ✅ NEW: controls the "Are you sure you want to delete all?" popup
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);

  const dropdownRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const smsRef = useRef<HTMLDivElement>(null);
  const hasRequestedPermission = useRef(false);

  // ✅ Track already-alerted SMS so we don't spam sound/vibration
  const alertedSmsIdsRef = useRef<Set<string>>(new Set());
  const isFirstLoadRef = useRef(true);

  // ✅ Remember the exact moment each SMS was first received (stable fallback time)
  const firstSeenTimesRef = useRef<Map<string, Date>>(new Map());

  // ✅ Track SMS already being verified (prevents double writes on fast clicks)
  const verifyingIdsRef = useRef<Set<string>>(new Set());

  // ✅ Refs so long-lived listeners read current values without re-subscribing
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  const dropdownOpenIdRef = useRef(dropdownOpenId);
  dropdownOpenIdRef.current = dropdownOpenId;

  // ============================================================
  // ✅ AUDIO UNLOCK
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
            console.log('🔓 Audio unlocked for future SMS notifications');
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
  // ✅ FIRESTORE LISTENER (offline-safe + sound/vibration gated)
  // ============================================================
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let isMounted = true;

    const loadingTimeout = setTimeout(() => {
      if (isMounted) {
        console.warn(
          '⏱️ Firestore did not respond in time — enabling UI (offline mode)'
        );
        setLoading(false);
      }
    }, 5000);

    try {
      const q = query(
        collection(firestore, 'emergencyMessages'),
        orderBy('timestamp', 'desc')
      );

      unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          if (!isMounted) return;
          clearTimeout(loadingTimeout);

          const newMessages: SmsMessage[] = [];
          let unread = 0;

          snapshot.forEach((d) => {
            const data = d.data();

            const typeMap: Record<string, string> = {
              MED: 'Medical',
              FIRE: 'Fire',
              CRIME: 'Crime',
              ACC: 'Accident',
              FLOOD: 'Flood',
              OTHER: 'Emergency',
            };

            const priorityMap: Record<string, 'high' | 'normal' | 'low'> = {
              MED: 'high',
              FIRE: 'high',
              CRIME: 'high',
              ACC: 'normal',
              FLOOD: 'normal',
              OTHER: 'normal',
            };

            const code = data.code || 'OTHER';
            const incidentType = typeMap[code] || 'Emergency';
            const priority = priorityMap[code] || 'normal';

            const message: SmsMessage = {
              id: d.id,
              sender: data.citizenPhone || 'Unknown Citizen',
              phoneNumber: data.citizenPhone || 'Unknown',
              message: data.fullMessage || data.message || '',
              timestamp: (() => {
                // Real server time if available, otherwise the moment we first received it
                const serverTime =
                  data.timestamp?.toDate?.() ||
                  data.createdAt?.toDate?.() ||
                  null;
                if (serverTime) return serverTime;
                if (!firstSeenTimesRef.current.has(d.id)) {
                  firstSeenTimesRef.current.set(d.id, new Date());
                }
                return firstSeenTimesRef.current.get(d.id)!;
              })(),
              read: data.isRead || false,
              priority,
              incidentType,
              location:
                data.location?.address ||
                `${data.location?.latitude || 0}, ${
                  data.location?.longitude || 0
                }`,
              address: data.location?.address || 'Unknown address',
              code,
              source: data.source || 'SMS',
            };

            if (!data.isRead) unread++;
            newMessages.push(message);
          });

          setMessages(newMessages);
          setUnreadCount(unread);
          setLoading(false);

          // ✅ Sound + vibration for NEW SMS only
          if (isFirstLoadRef.current) {
            newMessages.forEach((m) => alertedSmsIdsRef.current.add(m.id));
            isFirstLoadRef.current = false;
          } else {
            newMessages.forEach((m) => {
              if (!alertedSmsIdsRef.current.has(m.id)) {
                alertedSmsIdsRef.current.add(m.id);
                console.log('🆕 New SMS detected:', m.id);
                playNotificationSound();
                triggerVibration();
              }
            });
          }
        },
        (error) => {
          if (!isMounted) return;
          clearTimeout(loadingTimeout);
          console.warn(
            '⚠️ Firestore onSnapshot error (offline?):',
            error.message
          );
          setLoading(false);
        }
      );
    } catch (err) {
      console.error('❌ Failed to subscribe to emergencyMessages:', err);
      clearTimeout(loadingTimeout);
      setLoading(false);
    }

    return () => {
      isMounted = false;
      clearTimeout(loadingTimeout);
      if (unsubscribe) unsubscribe();
      stopNotificationSound();
    };
  }, [refreshKey]);

  // ============================================================
  // ✅ CLICK-OUTSIDE HANDLER — set up ONCE, reads refs
  // ============================================================
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (smsRef.current && !smsRef.current.contains(event.target as Node)) {
        if (isOpenRef.current) setIsOpen(false);
      }
      const openId = dropdownOpenIdRef.current;
      if (openId) {
        const ref = dropdownRefs.current[openId];
        if (ref && !ref.contains(event.target as Node)) {
          setDropdownOpenId(null);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const requestNotificationPermission = () => {
    if (hasRequestedPermission.current) return;
    hasRequestedPermission.current = true;
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch((err) => {
        console.log('Notification permission request failed:', err);
      });
    }
  };

  // ============================================================
  // ✅ TOGGLE — opens instantly.
  // ✅ CHANGED: opening NO LONGER marks everything as read.
  //    New SMS stay UNREAD until the EOC user clicks the message.
  // ============================================================
  const toggleDropdown = () => {
    requestNotificationPermission();
    // Stop the alarm the moment the panel is opened
    stopNotificationSound();
    setIsOpen(!isOpen);
  };

  const handleRefresh = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLoading(true);
    setRefreshKey((k) => k + 1);
  };

  const handleMarkAllAsRead = () => {
    const unreadMessages = messages.filter((m) => !m.read);
    if (unreadMessages.length === 0) return;
    setMessages((prev) => prev.map((m) => ({ ...m, read: true })));
    setUnreadCount(0);
    unreadMessages.forEach((msg) => updateSmsDoc(msg.id, { isRead: true }));
  };

  // ============================================================
  // ✅ NEW: DELETE ALL (runs only after the user confirms in the popup)
  // ============================================================
  const handleDeleteAll = () => {
    const toDelete = messages.map((m) => m.id);
    setMessages([]);
    setUnreadCount(0);
    setDropdownOpenId(null);
    setShowDeleteAllConfirm(false);
    toDelete.forEach((id) => deleteSmsDoc(id));
  };

  // ============================================================
  // ✅ ONE CLICK: navigate FIRST, verify in the BACKGROUND.
  // The slow network write no longer blocks the page switch, so no
  // second click is needed. Duplicate clicks are guarded by a Set.
  // ============================================================
  const verifySmsInBackground = (message: SmsMessage) => {
    if (verifyingIdsRef.current.has(message.id)) return;
    verifyingIdsRef.current.add(message.id);

    try {
      updateSmsDoc(message.id, {
        status: 'verified',
        verifiedAt: new Date(),
      });
    } finally {
      // No await, so clean up the guard on the next tick.
      setTimeout(() => verifyingIdsRef.current.delete(message.id), 1000);
    }
  };

  // (no active-report guard anymore — any SMS can be opened at any time)
  const handleMessageClick = (message: SmsMessage) => {
    // ✅ STOP THE ALARM SOUND IMMEDIATELY
    stopNotificationSound();

    // ✅ NEW: automatically mark as READ when the message is clicked
    if (!message.read) {
      setMessages((prev) =>
        prev.map((m) => (m.id === message.id ? { ...m, read: true } : m))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
      updateSmsDoc(message.id, { isRead: true });
    }

    // 1) Hand off + navigate — right now
    if (onNavigateToIncidentIntake) {
      const formattedReceived = message.timestamp.toLocaleString('en-PH', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZone: 'Asia/Manila',
      });

      const priorityLabel =
        message.priority === 'high'
          ? 'HIGH'
          : message.priority === 'normal'
          ? 'NORMAL'
          : 'LOW';

      sessionStorage.setItem(
        'smsIncidentData',
        JSON.stringify({
          // Legacy fields
          type: message.incidentType || 'Emergency',
          location: message.location || 'Unknown location',
          description: message.message,
          reporter: {
            fullName: message.sender,
            phoneNumber: message.phoneNumber,
          },
          source: 'SMS',
          code: message.code || 'OTHER',

          // Display fields
          sender: message.sender,
          phoneNumber: message.phoneNumber,
          emergencyType: message.incidentType || 'Emergency',
          priority: message.priority,
          priorityLabel,
          messageText: message.message,
          locationText: message.location || 'Unknown location',
          address: message.address || 'Unknown address',
          receivedTime: formattedReceived,
          statusText: message.read ? 'READ' : 'UNREAD',

          // Auto-verified flag
          status: 'verified',
        })
      );

      onNavigateToIncidentIntake();
    }

    setIsOpen(false);

    // 2) Slow network work in the background
    verifySmsInBackground(message);
  };

  const toggleThreeDotMenu = (messageId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setDropdownOpenId(dropdownOpenId === messageId ? null : messageId);
  };

  // (kept as-is; the "Mark as Read/Unread" menu item was removed from the card,
  //  so this is currently unused)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars

  const handleDelete = (messageId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (window.confirm('Are you sure you want to delete this SMS?')) {
      const updatedMessages = messages.filter((m) => m.id !== messageId);
      setMessages(updatedMessages);
      setUnreadCount(updatedMessages.filter((m) => !m.read).length);
      setDropdownOpenId(null);
    }
  };

  const getPriorityClass = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'sms-high';
      case 'normal':
        return 'sms-normal';
      case 'low':
        return 'sms-low';
      default:
        return 'sms-info';
    }
  };

  const getPriorityLabel = (priority: string) => {
    switch (priority) {
      case 'high':
        return '🔴 HIGH';
      case 'normal':
        return '🟡 NORMAL';
      case 'low':
        return '🟢 LOW';
      default:
        return 'ℹ️ INFO';
    }
  };

  const getIncidentIcon = (type: string) => {
    const icons: { [key: string]: string } = {
      Fire: 'fa-fire',
      Medical: 'fa-ambulance',
      Flood: 'fa-water',
      Crime: 'fa-shield',
      Accident: 'fa-car',
      Emergency: 'fa-exclamation-triangle',
      Other: 'fa-comment-alt',
    };
    return icons[type] || 'fa-comment-alt';
  };

  const getIncidentColor = (type: string) => {
    const colors: { [key: string]: string } = {
      Fire: '#FF6B35',
      Medical: '#dc3545',
      Flood: '#2196F3',
      Crime: '#9C27B0',
      Accident: '#FF9800',
      Emergency: '#EB1616',
      Other: '#607D8B',
    };
    return colors[type] || '#17a2b8';
  };

  const formatExactDateTime = (date: Date) => {
    const dateStr = date.toLocaleDateString('en-PH', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'Asia/Manila',
    });
    const timeStr = date.toLocaleTimeString('en-PH', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZone: 'Asia/Manila',
    });
    return `${dateStr} • ${timeStr}`;
  };

  useEffect(() => {
    if (unreadCount > 0 && !isOpen) {
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification('🚨 New Emergency SMS', {
            body: `You have ${unreadCount} unread emergency message${
              unreadCount > 1 ? 's' : ''
            }`,
            icon: '/emergency-icon.png',
          });
        } catch (err) {
          console.log('Notification failed:', err);
        }
      }
    }
  }, [unreadCount, isOpen]);

  return (
    <div className={`sms-icon-container ${className}`} ref={smsRef}>
      <div className="nav-item dropdown">
        <a
          href="#"
          role="button"
          className="nav-link dropdown-toggle"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleDropdown();
            if (onClick) onClick();
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <i className="fa fa-comment-alt"></i>
          {loading ? (
            <span className="badge">...</span>
          ) : unreadCount > 0 ? (
            <span className="badge pulse-badge">{unreadCount}</span>
          ) : null}
        </a>

        {isOpen && (
          <>
            <div
              className="dropdown-backdrop"
              onClick={() => setIsOpen(false)}
            ></div>
            <div className="sms-dropdown">
              <div className="dropdown-header">
                <h6>
                  <i className="fa fa-comment-alt me-2"></i>SMS Messages
                </h6>
                <div
                  style={{ display: 'flex', gap: '8px', alignItems: 'center' }}
                >
                  {!loading && unreadCount > 0 && (
                    <button
                      className="mark-all-read"
                      onClick={handleMarkAllAsRead}
                    >
                      Mark all as read
                    </button>
                  )}
                  {!loading && messages.length > 0 && (
                    <button
                      className="sms-delete-all"
                      onClick={() => setShowDeleteAllConfirm(true)}
                    >
                      Delete all
                    </button>
                  )}
                  <button
                    className="refresh-btn"
                    onClick={handleRefresh}
                    title="Refresh"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#64748B',
                      fontSize: '14px',
                      padding: '4px 6px',
                    }}
                  >
                    <i
                      className={`fa fa-refresh ${loading ? 'fa-spin' : ''}`}
                    ></i>
                  </button>
                </div>
              </div>

              <div className="sms-list">
                {loading ? (
                  <div className="no-messages">
                    <i className="fa fa-spinner fa-spin"></i>
                    <p>Loading messages...</p>
                    <span>Connecting to server...</span>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="no-messages">
                    <i className="fa fa-comment-slash"></i>
                    <p>No SMS messages</p>
                    <span>
                      Waiting for emergency messages from the responder app...
                    </span>
                  </div>
                ) : (
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className={`sms-item ${
                        !message.read ? 'unread' : ''
                      } ${getPriorityClass(message.priority)}`}
                      onClick={() => handleMessageClick(message)}
                    >
                      {!message.read && (
                        <div className="unread-indicator">
                          <div className="unread-dot"></div>
                          <div className="unread-pulse"></div>
                        </div>
                      )}

                      {message.read && (
                        <div className="read-indicator">
                          <i className="fa fa-check-circle"></i>
                        </div>
                      )}

                      <div
                        className="sms-icon-wrapper"
                        style={{
                          background: `${getIncidentColor(
                            message.incidentType || 'Other'
                          )}15`,
                        }}
                      >
                        <i
                          className={`fa ${getIncidentIcon(
                            message.incidentType || 'Other'
                          )}`}
                          style={{
                            color: getIncidentColor(
                              message.incidentType || 'Other'
                            ),
                          }}
                        ></i>
                      </div>

                      <div className="sms-content">
                        <div className="sms-header">
                          <span className="sms-sender">
                            <strong>{message.sender}</strong>
                          </span>
                          <div className="sms-actions">
                            <span
                              className={`priority-badge ${message.priority}`}
                            >
                              {getPriorityLabel(message.priority)}
                            </span>
                            <button
                              className="three-dot-btn"
                              onClick={(e) => toggleThreeDotMenu(message.id, e)}
                            >
                              <i className="fa fa-ellipsis-v"></i>
                            </button>
                            {dropdownOpenId === message.id && (
                              <div
                                className="three-dot-dropdown"
                                ref={(el) => {
                                  dropdownRefs.current[message.id] = el;
                                }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {/* ✅ "Mark as Read/Unread" removed — only Delete remains */}
                                <div
                                  className="dropdown-item"
                                  onClick={(e) => handleDelete(message.id, e)}
                                >
                                  <i className="fa fa-trash"></i>
                                  Delete
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="sms-message">{message.message}</div>

                        {message.incidentType && (
                          <div className="sms-tags">
                            <span
                              className="tag incident-tag"
                              style={{
                                backgroundColor:
                                  getIncidentColor(message.incidentType) +
                                  '20',
                                color: getIncidentColor(message.incidentType),
                              }}
                            >
                              <i
                                className={`fa ${getIncidentIcon(
                                  message.incidentType
                                )}`}
                              ></i>
                              {message.incidentType}
                            </span>
                            {message.code && (
                              <span
                                className="tag code-tag"
                                style={{
                                  backgroundColor: '#4A9EFF20',
                                  color: '#4A9EFF',
                                }}
                              >
                                <i className="fa fa-tag"></i>
                                {message.code}
                              </span>
                            )}
                            {message.source && (
                              <span
                                className="tag source-tag"
                                style={{
                                  backgroundColor: '#10B98120',
                                  color: '#10B981',
                                }}
                              >
                                <i className="fa fa-mobile-alt"></i>
                                {message.source}
                              </span>
                            )}
                            {message.location && (
                              <span className="tag location-tag">
                                <i className="fa fa-map-marker-alt"></i>
                                {message.location}
                              </span>
                            )}
                            <span className="tag phone-tag">
                              <i className="fa fa-phone"></i>
                              {message.phoneNumber}
                            </span>
                          </div>
                        )}

                        <div className="sms-footer">
                          <span
                            className="sms-time"
                            title={formatExactDateTime(message.timestamp)}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <i className="fa fa-clock-o"></i>
                            <span style={{ fontWeight: 600 }}>
                              {formatExactDateTime(message.timestamp)}
                            </span>
                          </span>
                          {!message.read && (
                            <span className="unread-badge">🔴 UNREAD</span>
                          )}
                          {message.read && (
                            <span className="read-badge">🟢 READ</span>
                          )}
                        </div>

                        <div className="sms-click-hint">
                          <i className="fa fa-arrow-right"></i> Click to create
                          incident
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
                    e.stopPropagation();
                    if (onNavigateToIncidentIntake) {
                      onNavigateToIncidentIntake();
                    }
                    setIsOpen(false);
                  }}
                >
                  Create Incident from SMS <i className="fa fa-arrow-right"></i>
                </a>
              </div>

              {/* ✅ NEW: Delete-all confirmation popup */}
              {showDeleteAllConfirm && (
                <div
                  className="sms-confirm-overlay"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="sms-confirm-box">
                    <i className="fa fa-trash sms-confirm-icon"></i>
                    <h6>Are you sure you want to delete all?</h6>
                    <p>This will permanently remove all SMS messages.</p>
                    <div className="sms-confirm-actions">
                      <button
                        className="sms-confirm-cancel"
                        onClick={() => setShowDeleteAllConfirm(false)}
                      >
                        Cancel
                      </button>
                      <button
                        className="sms-confirm-delete"
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

export default SmsIcon;