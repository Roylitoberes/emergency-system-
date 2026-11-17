// MessageBox.tsx
// ✅ Reads backup_requests from Firestore and shows the responder's
//    real name + profile photo when available.
// ✅ Clicking a message card blinks the card and jumps to the
//    Monitor Incidents page, highlighting the matching report row.
// ✅ Shows the responder's GPS location (lat/lng) with a Google Maps link.
// ✅ Plays sound + vibrates on new backup request (stops after 20s)
// ✅ FIXED: One click navigates immediately; read/verify writes run in the
//    background so the UI never appears to "do nothing" on first click.
// ✅ Stops the alarm sound immediately when a message card is clicked.
// ✅ NEW: "Delete all" button with an "Are you sure?" confirmation popup.
// ✅ NEW: Card menu only has Delete (Mark as Read/Unread removed).
//    New requests arrive UNREAD; clicking a card marks it READ.
// ✅ NEW: Time (e.g. "04:58 AM") removed from the message card footer.

import React, { useState, useRef, useEffect } from 'react';
import {
  getFirestore,
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import '../css/MessageBox.css';

interface MessageBoxProps {
  isOpen?: boolean;
  onToggle?: () => void;
  onClose?: () => void;
  onOpenIncident?: (incidentId: string) => void;
}

interface Message {
  id: number | string;
  sender: string;
  avatar: string;
  message: string;
  time: string;
  unread: boolean;
  type: 'dispatch' | 'urgent' | 'info' | 'alert';
  raw?: any;
  lat?: number | null;
  lng?: number | null;
}

const AVATAR_POOL = [
  'https://randomuser.me/api/portraits/men/1.jpg',
  'https://randomuser.me/api/portraits/women/2.jpg',
  'https://randomuser.me/api/portraits/men/3.jpg',
  'https://randomuser.me/api/portraits/women/4.jpg',
  'https://randomuser.me/api/portraits/men/5.jpg',
];

const avatarFor = (key: string) => {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return AVATAR_POOL[hash % AVATAR_POOL.length];
};

// ============================================================
// ✅ SOUND HELPERS (module-level, shared across mounts)
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
    console.log('🔇 MessageBox sound stopped');
  }
  if (currentAudioTimeout) {
    clearTimeout(currentAudioTimeout);
    currentAudioTimeout = null;
  }
};

const playNotificationSound = () => {
  try {
    console.log('🔊 playNotificationSound (MessageBox) called');
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
      console.log('⏱️ 20 seconds elapsed — stopping MessageBox sound');
      stopNotificationSound();
    }, 20000);
  } catch (error) {
    console.log('❌ Error playing MessageBox sound:', error);
  }
};

// ============================================================
// ✅ VIBRATION (Android only — no-ops elsewhere)
// ============================================================
const triggerVibration = () => {
  try {
    console.log('📳 triggerVibration (MessageBox) called');
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
// ✅ OFFLINE-SAFE WRITE HELPERS (fire-and-forget)
// ============================================================
const markSmsRead = (id: string, isRead: boolean) => {
  try {
    const db = getFirestore();
    updateDoc(doc(db, 'backup_requests', id), {
      isRead,
      readAt: isRead ? serverTimestamp() : null,
    }).catch((err) =>
      console.warn('Could not update backup_requests (offline?):', err?.message)
    );
  } catch (err) {
    console.warn('updateDoc setup failed:', err);
  }
};

const deleteBackupRequest = (id: string) => {
  try {
    const db = getFirestore();
    deleteDoc(doc(db, 'backup_requests', id)).catch((err) =>
      console.warn('Could not delete backup_request (offline?):', err?.message)
    );
  } catch (err) {
    console.warn('deleteDoc setup failed:', err);
  }
};

// Map a backup_requests doc → Message
const backupRequestToMessage = (docSnap: any): Message => {
  const data = docSnap.data() || {};
  const id = docSnap.id;

  const category = data.category || data.type || 'Backup Request';
  const responderName = data.responderName || data.responder || 'Responder';
  const description = (data.description || '').toString().trim();

  const reportId = (data.reportId || data.incidentId || '').toString().trim();
  const reportTag = reportId ? ` [${reportId}]` : '';

  const messageText = description
    ? `${category}${reportTag} — ${description}`
    : `${category}${reportTag}`;

  let displayTime = 'Just now';
  const raw = data.createdAt;
  if (raw) {
    try {
      const date = raw?.toDate
        ? raw.toDate()
        : typeof raw === 'object' && raw?.seconds
        ? new Date(raw.seconds * 1000)
        : new Date(raw);
      if (!isNaN(date.getTime())) {
        displayTime = date.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
      }
    } catch {
      // keep default
    }
  }

  let type: Message['type'] = 'urgent';
  const catLower = category.toLowerCase();
  if (catLower.includes('medical')) type = 'urgent';
  else if (catLower.includes('traffic') || catLower.includes('route'))
    type = 'alert';
  else if (catLower.includes('equipment') || catLower.includes('responders'))
    type = 'dispatch';
  else if (catLower.includes('dangerous') || catLower.includes('danger'))
    type = 'urgent';
  else type = 'alert';

  const realPhoto =
    typeof data.responderPhoto === 'string' &&
    data.responderPhoto.startsWith('http')
      ? data.responderPhoto
      : null;

  const lat =
    typeof data.lat === 'number'
      ? data.lat
      : typeof data.lat === 'string' && data.lat.trim() !== ''
      ? parseFloat(data.lat)
      : null;
  const lng =
    typeof data.lng === 'number'
      ? data.lng
      : typeof data.lng === 'string' && data.lng.trim() !== ''
      ? parseFloat(data.lng)
      : null;

  return {
    id,
    sender: responderName,
    avatar: realPhoto ?? avatarFor(responderName + id),
    message: messageText,
    time: displayTime,
    unread: !(data.isRead === true || data.read === true),
    type,
    raw: data,
    lat: lat !== null && !isNaN(lat) ? lat : null,
    lng: lng !== null && !isNaN(lng) ? lng : null,
  };
};

const MessageBox: React.FC<MessageBoxProps> = ({
  isOpen = false,
  onToggle,
  onClose,
  onOpenIncident,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [dropdownOpenId, setDropdownOpenId] = useState<
    number | string | null
  >(null);
  const [blinkingId, setBlinkingId] = useState<number | string | null>(null);
  // ✅ NEW: controls the "Are you sure you want to delete all?" popup
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);

  const dropdownRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const alertedMessageIdsRef = useRef<Set<string>>(new Set());
  const isFirstLoadRef = useRef(true);

  // ✅ Refs so the click-outside listener can be set up once
  const dropdownOpenIdRef = useRef<number | string | null>(null);
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
            console.log('🔓 Audio unlocked for future MessageBox notifications');
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
  // ✅ FIRESTORE LISTENER — backup_requests
  // ============================================================
  useEffect(() => {
    let unsub: (() => void) | undefined;

    try {
      const db = getFirestore();
      const backupRef = collection(db, 'backup_requests');

      let q;
      try {
        q = query(backupRef, orderBy('createdAt', 'desc'));
      } catch {
        q = query(backupRef);
      }

      unsub = onSnapshot(
        q,
        (snapshot) => {
          const list: Message[] = [];
          snapshot.forEach((docSnap) => {
            list.push(backupRequestToMessage(docSnap));
          });

          console.log(`📨 MessageBox: ${list.length} backup request(s) loaded`);
          setMessages(list);

          if (isFirstLoadRef.current) {
            list.forEach((m) =>
              alertedMessageIdsRef.current.add(String(m.id))
            );
            isFirstLoadRef.current = false;
          } else {
            list.forEach((m) => {
              const key = String(m.id);
              if (!alertedMessageIdsRef.current.has(key)) {
                alertedMessageIdsRef.current.add(key);
                console.log('🆕 New backup request detected:', key);
                playNotificationSound();
                triggerVibration();
              }
            });
          }
        },
        (error) => {
          console.error('❌ MessageBox backup_requests error:', error);
        }
      );
    } catch (error) {
      console.error('❌ MessageBox failed to set up Firestore listener:', error);
    }

    return () => {
      if (unsub) unsub();
      stopNotificationSound();
    };
  }, []);

  // ============================================================
  // ✅ CLICK-OUTSIDE — set up ONCE, reads ref
  // ============================================================
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const openId = dropdownOpenIdRef.current;
      if (openId !== null) {
        const ref = dropdownRefs.current[String(openId)];
        if (ref && !ref.contains(event.target as Node)) {
          setDropdownOpenId(null);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleToggle = () => {
    if (onToggle) onToggle();
  };

  const getUnreadCount = () => messages.filter((msg) => msg.unread).length;

  // ✅ Optimistic UI + fire-and-forget writes (never awaited on click path)
  const markAsRead = (id: number | string) => {
    setMessages((prev) =>
      prev.map((msg) => (msg.id === id ? { ...msg, unread: false } : msg))
    );
    markSmsRead(String(id), true);
  };

  const markAllAsRead = () => {
    const unread = messages.filter((m) => m.unread);
    if (unread.length === 0) return;
    setMessages((prev) => prev.map((msg) => ({ ...msg, unread: false })));
    unread.forEach((m) => markSmsRead(String(m.id), true));
  };

  // (kept as-is; the "Mark as Read/Unread" menu item was removed from the card,
  //  so this is currently unused)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars

  const handleDelete = (id: number | string, e: React.MouseEvent) => {
    e.stopPropagation();
    setMessages((prev) => prev.filter((msg) => msg.id !== id));
    setDropdownOpenId(null);
    deleteBackupRequest(String(id));
  };

  // ✅ NEW: Delete every message (runs only after the user confirms)
  const handleDeleteAll = () => {
    const toDelete = messages.map((m) => String(m.id));
    setMessages([]);
    setDropdownOpenId(null);
    setShowDeleteAllConfirm(false);
    toDelete.forEach((id) => deleteBackupRequest(id));
  };

  const toggleThreeDotMenu = (id: number | string, event: React.MouseEvent) => {
    event.stopPropagation();
    setDropdownOpenId(dropdownOpenId === id ? null : id);
  };

  // ============================================================
  // ✅ ONE CLICK: blink → navigate immediately → write in background.
  // ✅ ALSO: stop the alarm sound immediately on click.
  // ✅ Clicking a card automatically marks it as READ.
  // ============================================================
  const handleCardClick = (message: Message) => {
    // ✅ STOP THE ALARM SOUND IMMEDIATELY
    stopNotificationSound();

    const reportId = (
      message.raw?.reportId ||
      message.raw?.incidentId ||
      ''
    )
      .toString()
      .trim();

    // 1. Blink (short, just visual feedback)
    setBlinkingId(message.id);
    setTimeout(() => setBlinkingId(null), 500);

    // 2. Fire-and-forget read write (no await)
    if (message.unread) {
      markAsRead(message.id);
    }

    // 3. Navigate quickly — the blink is 500ms, navigate at ~180ms so
    //    the click feels instant while still showing feedback.
    if (reportId && onOpenIncident) {
      window.setTimeout(() => {
        onOpenIncident(reportId);
        if (onClose) onClose();
      }, 180);
    } else if (onClose) {
      // No matching report → still close the panel
      window.setTimeout(() => onClose(), 180);
    }
  };

  const handleOpenLocation = (
    e: React.MouseEvent,
    lat: number,
    lng: number
  ) => {
    e.stopPropagation();
    const url = `https://www.google.com/maps?q=${lat},${lng}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'urgent':
        return 'fa-exclamation-circle';
      case 'alert':
        return 'fa-bell';
      case 'dispatch':
        return 'fa-truck';
      default:
        return 'fa-comment';
    }
  };

  const getTypeClass = (type: string) => {
    switch (type) {
      case 'urgent':
        return 'msg-urgent';
      case 'alert':
        return 'msg-alert';
      case 'dispatch':
        return 'msg-dispatch';
      default:
        return 'msg-info';
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'urgent':
        return '#dc3545';
      case 'alert':
        return '#f59e0b';
      case 'dispatch':
        return '#2563EB';
      default:
        return '#17a2b8';
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'urgent':
        return 'Urgent';
      case 'alert':
        return 'Alert';
      case 'dispatch':
        return 'Dispatch';
      default:
        return 'Info';
    }
  };

  const getStatusBadgeClass = (type: string) => {
    switch (type) {
      case 'urgent':
        return 'msg-status-urgent';
      case 'alert':
        return 'msg-status-alert';
      case 'dispatch':
        return 'msg-status-dispatch';
      default:
        return 'msg-status-info';
    }
  };

  return (
    <div className="message-box-container">
      <div className="nav-item dropdown">
        <a
          href="#"
          className="nav-link dropdown-toggle msg-toggle"
          onClick={(e) => {
            e.preventDefault();
            handleToggle();
          }}
        >
          <i className="fa fa-envelope"></i>
          {getUnreadCount() > 0 && (
            <span className="msg-badge pulse-badge">{getUnreadCount()}</span>
          )}
        </a>

        {isOpen && (
          <>
            <div
              className="msg-backdrop"
              onClick={() => onClose && onClose()}
            ></div>

            <div className="msg-dropdown">
              <div className="msg-header">
                <h6>
                  <i className="fa fa-envelope"></i>
                  Messages
                </h6>
                <div className="msg-header-actions">
                  {getUnreadCount() > 0 && (
                    <button className="msg-mark-all" onClick={markAllAsRead}>
                      Mark all as read
                    </button>
                  )}
                  {messages.length > 0 && (
                    <button
                      className="msg-delete-all"
                      onClick={() => setShowDeleteAllConfirm(true)}
                    >
                      Delete all
                    </button>
                  )}
                </div>
              </div>

              <div className="msg-list">
                {messages.length === 0 ? (
                  <div className="msg-empty">
                    <i className="fa fa-inbox"></i>
                    <p>No backup requests yet</p>
                  </div>
                ) : (
                  messages.map((message) => {
                    const color = getTypeColor(message.type);
                    const isBlinking = blinkingId === message.id;
                    const hasLocation =
                      message.lat !== null && message.lng !== null;

                    return (
                      <div
                        key={String(message.id)}
                        className={`msg-item ${
                          message.unread ? 'unread' : ''
                        } ${getTypeClass(message.type)} ${
                          isBlinking ? 'msg-item-blink' : ''
                        }`}
                        onClick={() => handleCardClick(message)}
                      >
                        {message.unread && (
                          <div className="msg-unread-indicator">
                            <div className="msg-unread-dot"></div>
                            <div className="msg-unread-pulse"></div>
                          </div>
                        )}
                        {!message.unread && (
                          <div className="msg-read-indicator">
                            <i className="fa fa-check-circle"></i>
                          </div>
                        )}

                        <div className="msg-avatar-wrapper">
                          <div className="msg-avatar">
                            <img src={message.avatar} alt={message.sender} />
                          </div>
                          <div
                            className="msg-type-icon"
                            style={{ background: color }}
                          >
                            <i
                              className={`fa ${getTypeIcon(message.type)}`}
                            ></i>
                          </div>
                        </div>

                        <div className="msg-content">
                          <div className="msg-item-header">
                            <span className="msg-sender">{message.sender}</span>
                            <div className="msg-actions">
                              <span
                                className={`msg-status-badge ${getStatusBadgeClass(
                                  message.type
                                )}`}
                              >
                                {getTypeLabel(message.type)}
                              </span>
                              <button
                                className="msg-three-dot-btn"
                                onClick={(e) =>
                                  toggleThreeDotMenu(message.id, e)
                                }
                              >
                                <i className="fa fa-ellipsis-v"></i>
                              </button>
                              {dropdownOpenId === message.id && (
                                <div
                                  className="msg-three-dot-dropdown"
                                  ref={(el) => {
                                    dropdownRefs.current[String(message.id)] =
                                      el;
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {/* ✅ "Mark as Read/Unread" removed — only Delete remains */}
                                  <div
                                    className="msg-three-dot-item"
                                    onClick={(e) => handleDelete(message.id, e)}
                                  >
                                    <i className="fa fa-trash"></i>
                                    Delete
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>

                          <p className="msg-text">{message.message}</p>

                          {hasLocation && (
                            <div className="msg-location-row">
                              <i className="fa fa-map-marker msg-location-icon"></i>
                              <span className="msg-location-text">
                                {message.lat!.toFixed(5)},{' '}
                                {message.lng!.toFixed(5)}
                              </span>
                              <button
                                className="msg-location-btn"
                                onClick={(e) =>
                                  handleOpenLocation(
                                    e,
                                    message.lat!,
                                    message.lng!
                                  )
                                }
                                title="Open in Google Maps"
                              >
                                <i className="fa fa-external-link"></i>
                                View Map
                              </button>
                            </div>
                          )}

                          {/* ✅ Time removed — footer now only shows READ/UNREAD */}
                          <div className="msg-footer-row">
                            {message.unread && (
                              <span className="msg-unread-badge">
                                🔴 UNREAD
                              </span>
                            )}
                            {!message.unread && (
                              <span className="msg-read-badge">🟢 READ</span>
                            )}
                          </div>

                          <div className="msg-click-hint">
                            <i className="fa fa-arrow-right"></i> Click to open
                            conversation
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="msg-dropdown-footer">
                <a
                  href="#"
                  className="msg-view-all"
                  onClick={(e) => e.preventDefault()}
                >
                  View All Messages <i className="fa fa-arrow-right"></i>
                </a>
              </div>

              {/* ✅ NEW: Delete-all confirmation popup */}
              {showDeleteAllConfirm && (
                <div
                  className="msg-confirm-overlay"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="msg-confirm-box">
                    <i className="fa fa-trash msg-confirm-icon"></i>
                    <h6>Are you sure you want to delete all?</h6>
                    <p>This will permanently remove all messages.</p>
                    <div className="msg-confirm-actions">
                      <button
                        className="msg-confirm-cancel"
                        onClick={() => setShowDeleteAllConfirm(false)}
                      >
                        Cancel
                      </button>
                      <button
                        className="msg-confirm-delete"
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

export default MessageBox;