// src/components/LeafletMap.tsx

import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default markers in Leaflet with React
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const PIN_COLOR = '#ef4444';

// ✅ Red map pin (white outline + ring). Created ONCE so the spawn
// animation only plays when a marker first appears, not on every re-render.
const PIN_ICON = L.divIcon({
  className: 'custom-pin-marker',
  html: `
    <div class="pin-wrap">
      <svg class="pin-svg" viewBox="0 0 32 44" width="32" height="44" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 2C8.8 2 3 7.8 3 15c0 9.5 13 27 13 27s13-17.5 13-27C29 7.8 23.2 2 16 2z"
              fill="${PIN_COLOR}" stroke="#ffffff" stroke-width="2.5"/>
        <circle cx="16" cy="15" r="5" fill="${PIN_COLOR}" stroke="#ffffff" stroke-width="2.5"/>
      </svg>
    </div>
  `,
  iconSize: [32, 44],
  iconAnchor: [16, 44], // tip of the pin sits exactly on the coordinate
  popupAnchor: [0, -40],
});

// ✅ Pulse ring animation (red, centered on the pin tip)
const createPulseRing = (color: string) => {
  return L.divIcon({
    className: 'pulse-ring-marker',
    html: `
      <div class="pulse-ring-container">
        <div class="pulse-ring wave-1" style="border-color: ${color};"></div>
        <div class="pulse-ring wave-2" style="border-color: ${color};"></div>
        <div class="pulse-ring wave-3" style="border-color: ${color};"></div>
      </div>
    `,
    iconSize: [60, 60],
    iconAnchor: [30, 30],
  });
};

const PULSE_ICON = createPulseRing(PIN_COLOR);

// Component to handle flying to selected incident
function FlyToSelected({ selectedId, incidents }: { selectedId: number | null; incidents: any[] }) {
  const map = useMap();

  useEffect(() => {
    if (selectedId !== null) {
      const incident = incidents.find(i => i.id === selectedId);
      if (incident && incident.lat && incident.lng) {
        map.flyTo([incident.lat, incident.lng], 15, {
          duration: 1.5,
          easeLinearity: 0.25,
        });
      }
    }
  }, [selectedId, incidents, map]);

  return null;
}

interface LeafletMapProps {
  incidents: any[];
  center: { lat: number; lng: number };
  zoom: number;
}

export default function LeafletMap({ incidents, center, zoom }: LeafletMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const [mapType, setMapType] = useState<'street' | 'satellite'>('street');

  // Get selected ID from sessionStorage
  const getSelectedId = () => {
    try {
      const data = sessionStorage.getItem('selectedIncidentForMap');
      if (data) {
        const parsed = JSON.parse(data);
        return parsed.id ? parseInt(parsed.id) : null;
      }
    } catch (e) {
      console.error('Error parsing selected incident:', e);
    }
    return null;
  };

  const selectedId = getSelectedId();

  // Add styles for animations and popups
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      /* ===== Red map pin ===== */
      .custom-pin-marker { background: none !important; border: none !important; }

      .pin-wrap { position: relative; width: 32px; height: 44px; }

      /* Spawn: pin drops in and bounces (plays once when the marker appears) */
      .pin-svg {
        display: block;
        transform-origin: 50% 100%;
        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.35));
        transition: transform 0.2s ease;
        animation: pinSpawn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
      }
      .custom-pin-marker:hover .pin-svg { transform: scale(1.2); }

      @keyframes pinSpawn {
        0%   { transform: translateY(-40px) scale(0.6); opacity: 0; }
        60%  { opacity: 1; }
        100% { transform: translateY(0) scale(1); opacity: 1; }
      }

      /* ===== Pulse rings ===== */
      @keyframes pulseRing {
        0% { transform: scale(0.5); opacity: 0.8; }
        50% { opacity: 0.4; }
        100% { transform: scale(1.8); opacity: 0; }
      }
      .pulse-ring-marker { background: none !important; border: none !important; }
      .pulse-ring-container {
        position: relative;
        width: 60px;
        height: 60px;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
      }
      .pulse-ring {
        position: absolute;
        border-radius: 50%;
        border: 2px solid;
        opacity: 0;
        animation: pulseRing 2s ease-out infinite;
      }
      .pulse-ring.wave-1 { width: 20px; height: 20px; animation-delay: 0s; }
      .pulse-ring.wave-2 { width: 30px; height: 30px; animation-delay: 0.6s; }
      .pulse-ring.wave-3 { width: 40px; height: 40px; animation-delay: 1.2s; }

      /* ✅ Map type toggle - Left Side, No Zoom Controls */
      .map-type-toggle {
        position: absolute;
        top: 20px;
        left: 12px;
        z-index: 1000; /* only competes inside the map's own stacking context */
        display: flex;
        flex-direction: column;
        gap: 2px;
        background: rgba(255,255,255,0.95);
        backdrop-filter: blur(8px);
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 4px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.12);
        transition: all 0.3s ease;
      }
      .map-type-toggle:hover {
        box-shadow: 0 4px 16px rgba(0,0,0,0.18);
      }
      .map-type-toggle button {
        width: 32px;
        height: 32px;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        cursor: pointer;
        transition: all 0.2s ease;
        background: transparent;
        color: #6B7280;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
      }
      .map-type-toggle button:hover {
        background: rgba(59, 130, 246, 0.1);
        color: #1F2937;
      }
      .map-type-toggle button.active {
        background: #2563EB;
        color: white;
        box-shadow: 0 2px 6px rgba(37, 99, 235, 0.3);
      }
      .map-type-toggle button.active:hover {
        background: #3B82F6;
      }
      .map-type-toggle button .tooltip {
        position: absolute;
        left: 40px;
        top: 50%;
        transform: translateY(-50%);
        background: rgba(0,0,0,0.8);
        color: white;
        padding: 3px 8px;
        border-radius: 4px;
        font-size: 11px;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s ease;
        font-weight: 500;
      }
      .map-type-toggle button:hover .tooltip {
        opacity: 1;
      }
      .map-type-toggle .divider {
        width: 100%;
        height: 1px;
        background: #e5e7eb;
        margin: 2px 0;
      }

      /* ✅ Disable default zoom controls */
      .leaflet-control-zoom {
        display: none !important;
      }

      /* Leaflet popup */
      .leaflet-popup-content-wrapper {
        border-radius: 12px !important;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15) !important;
        max-width: 380px !important;
      }
      .leaflet-popup-content {
        margin: 10px 14px !important;
        min-width: 120px !important;
        max-width: 350px !important;
      }

      /* Attribution style */
      .leaflet-control-attribution {
        background: rgba(255,255,255,0.9) !important;
        font-size: 10px !important;
        padding: 2px 8px !important;
        border-radius: 4px !important;
      }
    `;
    document.head.appendChild(style);

    return () => {
      document.head.removeChild(style);
    };
  }, []);

  // Create markers with the red map pin
  const renderMarkers = () => {
    return incidents.map((incident) => (
      <Marker
        key={incident.id}
        position={[incident.lat, incident.lng]}
        icon={PIN_ICON}
        riseOnHover={true}
        eventHandlers={{
          click: () => {
            sessionStorage.setItem('selectedIncidentForMap', JSON.stringify({
              id: String(incident.id)
            }));
            window.dispatchEvent(new Event('incidentSelected'));
          }
        }}
      >
        <Popup className="custom-popup">
          <div style={{ padding: '4px 8px', minWidth: '120px' }}>
            <div style={{ fontWeight: 'bold', color: PIN_COLOR }}>
              <i className="fa fa-map-pin" style={{ color: PIN_COLOR, marginRight: '6px' }}></i>
              {incident.title || incident.incident_type || 'Incident'}
            </div>
            <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '4px' }}>
              <i className="fa fa-location-dot" style={{ marginRight: '4px' }}></i>
              {incident.lat.toFixed(5)}, {incident.lng.toFixed(5)}
            </div>
            <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '2px' }}>
              <i className="fa fa-clock-o" style={{ marginRight: '4px' }}></i>
              {incident.time || 'Just now'}
            </div>
          </div>
        </Popup>
      </Marker>
    ));
  };

  // Render pulse rings for all incidents
  const renderPulseRings = () => {
    return incidents.map((incident) => (
      <Marker
        key={`pulse-${incident.id}`}
        position={[incident.lat, incident.lng]}
        icon={PULSE_ICON}
        interactive={false}
        zIndexOffset={-100}
      />
    ));
  };

  // Handle map type toggle
  const toggleMapType = (type: 'street' | 'satellite') => {
    setMapType(type);
  };

  return (
    // ✅ zIndex: 0 + isolation: 'isolate' creates its own stacking context so the
    // map, its Street/Satellite toggle and Leaflet's internal z-indexes can never
    // render on top of panels (like the LoRa Alerts dropdown) that sit above it.
    <div
      style={{
        position: 'relative',
        height: '100%',
        width: '100%',
        zIndex: 0,
        isolation: 'isolate',
      }}
    >
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={zoom}
        style={{ height: '100%', width: '100%', background: '#e8f0fe' }}
        zoomControl={false}
        attributionControl={true}
        ref={mapRef}
      >
        {/* Street Map Tiles */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
          opacity={mapType === 'street' ? 1 : 0}
        />

        {/* Satellite Map Tiles */}
        <TileLayer
          attribution='&copy; <a href="https://www.google.com/maps">Google</a>'
          url="https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
          maxZoom={20}
          subdomains={['mt0', 'mt1', 'mt2', 'mt3']}
          opacity={mapType === 'satellite' ? 1 : 0}
        />

        {/* Render pulse rings */}
        {renderPulseRings()}

        {/* Render markers */}
        {renderMarkers()}

        {/* Fly to selected incident */}
        <FlyToSelected selectedId={selectedId} incidents={incidents} />
      </MapContainer>

      {/* ✅ Map Type Toggle - Left Side, No Zoom Controls */}
      <div className="map-type-toggle">
        <button
          className={mapType === 'street' ? 'active' : ''}
          onClick={() => toggleMapType('street')}
          title="Street View"
        >
          <i className="fa fa-map"></i>
          <span className="tooltip">Street</span>
        </button>

        <div className="divider"></div>

        <button
          className={mapType === 'satellite' ? 'active' : ''}
          onClick={() => toggleMapType('satellite')}
          title="Satellite View"
        >
          <i className="fa fa-satellite"></i>
          <span className="tooltip">Satellite</span>
        </button>
      </div>
    </div>
  );
}