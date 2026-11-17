// NavbarEOC.tsx
import React from 'react';

interface NavbarEOCProps {
  onToggleSidebar: () => void;
}

const NavbarEOC: React.FC<NavbarEOCProps> = ({ onToggleSidebar }) => {
  return (
    <nav className="navbar navbar-expand bg-white navbar-light sticky-top px-4 py-0 shadow-sm">
      <a href="#" className="navbar-brand d-flex d-lg-none me-4">
        <h2 className="text-primary mb-0"><i className="fa fa-shield-alt"></i></h2>
      </a>
      <button 
        className="sidebar-toggler shrink-0 btn btn-link" 
        onClick={onToggleSidebar}
        style={{ background: 'none', border: 'none' }}
      >
        <i className="fa fa-bars"></i>
      </button>
      <form className="d-none d-md-flex ms-4">
        <input className="form-control bg-light border-0" type="search" placeholder="Search..." />
      </form>
      <div className="navbar-nav align-items-center ms-auto">
        <div className="nav-item dropdown">
          <a href="#" className="nav-link dropdown-toggle" data-bs-toggle="dropdown">
            <i className="fa fa-envelope me-lg-2"></i>
            <span className="d-none d-lg-inline-flex">Messages</span>
          </a>
          <div className="dropdown-menu dropdown-menu-end border-0 rounded shadow-sm m-0">
            <a href="#" className="dropdown-item">
              <div className="d-flex align-items-center">
                <img className="rounded-circle" src="https://randomuser.me/api/portraits/men/1.jpg" alt="" style={{ width: '40px', height: '40px' }} />
                <div className="ms-2">
                  <h6 className="fw-normal mb-0">Jhon send you a message</h6>
                  <small>15 minutes ago</small>
                </div>
              </div>
            </a>
            <hr className="dropdown-divider" />
            <a href="#" className="dropdown-item text-center text-primary">See all messages</a>
          </div>
        </div>
        <div className="nav-item dropdown">
          <a href="#" className="nav-link dropdown-toggle" data-bs-toggle="dropdown">
            <i className="fa fa-bell me-lg-2"></i>
            <span className="d-none d-lg-inline-flex">Notifications</span>
          </a>
          <div className="dropdown-menu dropdown-menu-end border-0 rounded shadow-sm m-0">
            <a href="#" className="dropdown-item">
              <h6 className="fw-normal mb-0">New incident reported</h6>
              <small>5 minutes ago</small>
            </a>
            <hr className="dropdown-divider" />
            <a href="#" className="dropdown-item text-center text-primary">See all notifications</a>
          </div>
        </div>
        <div className="nav-item dropdown">
          <a href="#" className="nav-link dropdown-toggle" data-bs-toggle="dropdown">
            <img className="rounded-circle me-lg-2" src="https://randomuser.me/api/portraits/men/1.jpg" alt="" style={{ width: '40px', height: '40px' }} />
            <span className="d-none d-lg-inline-flex">John Doe</span>
          </a>
          <div className="dropdown-menu dropdown-menu-end border-0 rounded shadow-sm m-0">
            <a href="#" className="dropdown-item">My Profile</a>
            <a href="#" className="dropdown-item">Settings</a>
            <hr className="dropdown-divider" />
            <a href="#" className="dropdown-item">Log Out</a>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default NavbarEOC;