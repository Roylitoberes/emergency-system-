// src/types/google-maps.d.ts
declare module '@react-google-maps/api' {
    export const useJsApiLoader: (options: {
      googleMapsApiKey: string;
      libraries?: string[];
    }) => {
      isLoaded: boolean;
      loadError: Error | undefined;
    };
  
    export const GoogleMap: React.FC<any>;
    export const Marker: React.FC<any>;
    export const InfoWindow: React.FC<any>;
  }