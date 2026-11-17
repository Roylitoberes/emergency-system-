// EOCcomponents/SmsFallback.tsx
import React, { useState, useEffect } from 'react';
import '../css/smsfallback.css';

interface SmsMessage {
  id: string;
  from: string;
  message: string;
  timestamp: string;
  read: boolean;
  priority: 'high' | 'medium' | 'low';
  status: 'sent' | 'delivered' | 'failed' | 'pending';
}

interface SmsFallbackProps {
  onSmsReceived?: (message: SmsMessage) => void;
  isOpen?: boolean;
  onToggle?: () => void;
  onClose?: () => void;
}

const SmsFallback: React.FC<SmsFallbackProps> = ({ 
  onSmsReceived, 
  isOpen = false, 
  onToggle}) => {
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isConnected, setIsConnected] = useState(true);

  // Simulate SMS gateway connection status
  useEffect(() => {
    const connectionInterval = setInterval(() => {
      const random = Math.random();
      if (random < 0.1) {
        setIsConnected(false);
        setTimeout(() => {
          setIsConnected(true);
        }, 5000);
      }
    }, 30000);

    return () => clearInterval(connectionInterval);
  }, []);

  // Simulate receiving SMS messages
  useEffect(() => {
    const initialMessages: SmsMessage[] = [
      {
        id: '1',
        from: '+1 (555) 123-4567',
        message: '🚨 Emergency: Flooding reported at Main Street and 5th Ave. Multiple vehicles trapped.',
        timestamp: new Date(Date.now() - 180000).toLocaleTimeString(),
        read: false,
        priority: 'high',
        status: 'delivered'
      },
      {
        id: '2',
        from: '+1 (555) 987-6543',
        message: '⚠️ Weather Alert: Severe thunderstorm warning issued for Zone 4.',
        timestamp: new Date(Date.now() - 360000).toLocaleTimeString(),
        read: false,
        priority: 'medium',
        status: 'delivered'
      }
    ];
    setMessages(initialMessages);
    setUnreadCount(2);

    const smsInterval = setInterval(() => {
      const newMessages: SmsMessage[] = [
        {
          id: Date.now().toString(),
          from: '+1 (555) 234-5678',
          message: '🚨 SOS: Citizen reported fire at Oak Street building. Need immediate response.',
          timestamp: new Date().toLocaleTimeString(),
          read: false,
          priority: 'high',
          status: 'delivered'
        },
        {
          id: (Date.now() + 1).toString(),
          from: '+1 (555) 876-5432',
          message: '📢 Update: Evacuation order issued for Sector B. Residents advised to move to higher ground.',
          timestamp: new Date().toLocaleTimeString(),
          read: false,
          priority: 'high',
          status: 'sent'
        },
        {
          id: (Date.now() + 2).toString(),
          from: '+1 (555) 345-6789',
          message: 'ℹ️ Information: Medical supplies delivered to Riverside shelter.',
          timestamp: new Date().toLocaleTimeString(),
          read: false,
          priority: 'low',
          status: 'delivered'
        },
        {
          id: (Date.now() + 3).toString(),
          from: '+1 (555) 654-3210',
          message: '⚠️ Security Alert: Unauthorized access detected at perimeter gate 3.',
          timestamp: new Date().toLocaleTimeString(),
          read: false,
          priority: 'medium',
          status: 'pending'
        }
      ];

      const randomSms = newMessages[Math.floor(Math.random() * newMessages.length)];
      
      setMessages(prev => [randomSms, ...prev]);
      setUnreadCount(prev => prev + 1);

      if (onSmsReceived) {
        onSmsReceived(randomSms);
      }

    }, 40000);

    return () => clearInterval(smsInterval);
  }, [onSmsReceived]);

  const markAsRead = (id: string) => {
    setMessages(prev => 
      prev.map(msg => 
        msg.id === id ? { ...msg, read: true } : msg
      )
    );
    setUnreadCount(prev => Math.max(0, prev - 1));
  };

  const markAllAsRead = () => {
    setMessages(prev => 
      prev.map(msg => ({ ...msg, read: true }))
    );
    setUnreadCount(0);
  };

  const getPriorityColor = (priority: string) => {
    switch(priority) {
      case 'high': return '#dc3545';
      case 'medium': return '#ffc107';
      case 'low': return '#28a745';
      default: return '#6C7293';
    }
  };

  const getStatusIcon = (status: string) => {
    switch(status) {
      case 'sent': return 'fa-check';
      case 'delivered': return 'fa-check-double';
      case 'failed': return 'fa-times';
      case 'pending': return 'fa-clock-o';
      default: return 'fa-envelope';
    }
  };

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'sent': return '#17a2b8';
      case 'delivered': return '#28a745';
      case 'failed': return '#dc3545';
      case 'pending': return '#ffc107';
      default: return '#6C7293';
    }
  };

  // ✅ Handle button click
  const handleButtonClick = () => {
    if (onToggle) {
      onToggle();
    }
  };

  return (
    <div className="sms-fallback-wrapper">
      {/* SMS Button */}
      <div 
        className="sms-fallback-button"
        onClick={handleButtonClick}
      >
        <i className="fa fa-sms"></i>
        {unreadCount > 0 && (
          <span className="sms-badge">{unreadCount}</span>
        )}
        <span className={`sms-connection-dot ${isConnected ? 'connected' : 'disconnected'}`}></span>
      </div>

      {/* Dropdown - ✅ Controlled by isOpen prop */}
      {isOpen && (
        <div className="sms-dropdown">
          <div className="sms-dropdown-header">
            <div>
              <i className="fa fa-sms me-2" style={{ color: '#EB1616' }}></i>
              <span>SMS Fallback</span>
              <span className={`sms-connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
                <i className={`fa ${isConnected ? 'fa-wifi' : 'fa-exclamation-triangle'}`}></i>
                {isConnected ? ' Connected' : ' Disconnected'}
              </span>
            </div>
            {unreadCount > 0 && (
              <button 
                className="sms-mark-all-read"
                onClick={markAllAsRead}
              >
                Mark all as read
              </button>
            )}
          </div>

          <div className="sms-dropdown-body">
            {messages.length === 0 ? (
              <div className="sms-no-messages">
                <i className="fa fa-sms" style={{ fontSize: '30px', color: '#6C7293' }}></i>
                <p>No SMS messages</p>
              </div>
            ) : (
              messages.map(msg => (
                <div 
                  key={msg.id} 
                  className={`sms-message-item ${!msg.read ? 'unread' : ''}`}
                  onClick={() => markAsRead(msg.id)}
                >
                  <div className="sms-message-priority" style={{ backgroundColor: getPriorityColor(msg.priority) }}></div>
                  <div className="sms-message-content">
                    <div className="sms-message-header">
                      <span className="sms-message-from">{msg.from}</span>
                      <span className="sms-message-status" style={{ color: getStatusColor(msg.status) }}>
                        <i className={`fa ${getStatusIcon(msg.status)}`}></i>
                        {msg.status}
                      </span>
                    </div>
                    <div className="sms-message-text">{msg.message}</div>
                    <div className="sms-message-footer">
                      <span className="sms-message-timestamp">
                        <i className="fa fa-clock-o"></i> {msg.timestamp}
                      </span>
                      <span className={`sms-priority-badge ${msg.priority}`}>
                        {msg.priority}
                      </span>
                    </div>
                  </div>
                  {!msg.read && (
                    <div className="sms-unread-indicator"></div>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="sms-dropdown-footer">
            <button className="sms-compose-btn">
              <i className="fa fa-plus"></i> Compose SMS
            </button>
            <button className="sms-view-all-btn">
              View All Messages
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SmsFallback;