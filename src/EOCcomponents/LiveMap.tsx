// src/components/LiveMap.tsx

import { useEffect, useState } from 'react';
import LeafletMap from './LeafletMap'; // Import the new Leaflet map

interface Incident {
  id: number;
  incident_type: string;
  device_id?: string;
  latitude: string | number;
  longitude: string | number;
  status: string;
  // Add any other fields your incident has
}

interface LiveMapProps {
  incidents: Incident[];
  selectedId: number | null;
}

export default function LiveMap({ incidents, selectedId }: LiveMapProps) {
  const [mapIncidents, setMapIncidents] = useState<any[]>([]);

  useEffect(() => {
    // Convert your incidents to the format expected by LeafletMap
    const formatted = incidents
      .filter(i => !isNaN(Number(i.latitude)) && !isNaN(Number(i.longitude)))
      .map(inc => ({
        id: inc.id,
        lat: Number(inc.latitude),
        lng: Number(inc.longitude),
        title: `🚨 ${inc.incident_type}`,
        type: inc.incident_type,
        severity: inc.status === 'pending' ? 'high' : 'medium',
        description: inc.incident_type,
        time: 'Just now',
        dispatchedUnits: 'N/A',
        location: `${Number(inc.latitude).toFixed(6)}, ${Number(inc.longitude).toFixed(6)}`,
        originalId: String(inc.id)
      }));

    setMapIncidents(formatted);

    // Store selected incident for LeafletMap to highlight
    if (selectedId !== null) {
      const selectedIncident = incidents.find(i => i.id === selectedId);
      if (selectedIncident) {
        sessionStorage.setItem('selectedIncidentForMap', JSON.stringify({
          id: String(selectedIncident.id)
        }));
      }
    } else {
      sessionStorage.removeItem('selectedIncidentForMap');
    }

    // Force map update when selection changes
    window.dispatchEvent(new Event('incidentSelected'));

  }, [incidents, selectedId]);

  const pendingCount = incidents.filter((i) => i.status === 'pending').length;

  return (
    // ✅ zIndex: 0 + isolation: 'isolate' keeps the map and its floating chip
    // (zIndex 1000) from rendering on top of panels that sit above the map,
    // such as the LoRa Alerts dropdown.
    <div
      style={{
        position: 'relative',
        height: '100%',
        width: '100%',
        zIndex: 0,
        isolation: 'isolate',
      }}
    >
      {/* Floating live-count chip */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          zIndex: 1000,
          background: 'rgba(17,17,20,0.85)',
          backdropFilter: 'blur(6px)',
          color: '#fff',
          padding: '8px 14px',
          borderRadius: 10,
          fontSize: 12,
          fontWeight: 600,
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#dc2626',
            display: 'inline-block',
            animation: pendingCount > 0 ? 'naga-pulse-dot 1.4s infinite' : 'none'
          }}
        />
        {mapIncidents.length} on map · {pendingCount} pending
      </div>

      {/* Use the new Leaflet map component */}
      <LeafletMap
        incidents={mapIncidents}
        center={{ lat: 10.2167, lng: 123.7833 }}
        zoom={13}
      />

      {/* Add the pulse animation style */}
      <style>{`
        @keyframes naga-pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        
        /* Custom popup styles */
        .custom-popup .leaflet-popup-content-wrapper {
          border-radius: 10px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.15);
          padding: 0;
        }
        
        .custom-popup .leaflet-popup-content {
          padding: 12px 14px;
          margin: 0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
        }
        
        /* Map zoom controls style */
        .leaflet-control-zoom {
          border: none !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.15) !important;
        }
        
        .leaflet-control-zoom a {
          background: white !important;
          color: #333 !important;
          border: 1px solid #e5e7eb !important;
        }
        
        .leaflet-control-zoom a:hover {
          background: #f3f4f6 !important;
        }
        
        /* Attribution style */
        .leaflet-control-attribution {
          background: rgba(255,255,255,0.9) !important;
          font-size: 10px !important;
          padding: 2px 8px !important;
        }
      `}</style>
    </div>
  );
}