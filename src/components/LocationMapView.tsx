import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

interface LocationMapViewProps {
  locations: string[];
  radiusKm: number;
  mapboxToken: string;
}

export const LocationMapView = ({ locations, radiusKm, mapboxToken }: LocationMapViewProps) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<mapboxgl.Marker[]>([]);

  useEffect(() => {
    if (!mapContainer.current || !mapboxToken) return;

    mapboxgl.accessToken = mapboxToken;
    
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-46.6333, -23.5505], // São Paulo como centro padrão
      zoom: 4,
    });

    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

    return () => {
      markers.current.forEach(marker => marker.remove());
      map.current?.remove();
    };
  }, [mapboxToken]);

  useEffect(() => {
    if (!map.current || !locations.length) return;

    // Remove markers antigos
    markers.current.forEach(marker => marker.remove());
    markers.current = [];

    // Remove círculos antigos
    if (map.current.getSource('radius-circles')) {
      map.current.removeLayer('radius-circles-fill');
      map.current.removeLayer('radius-circles-outline');
      map.current.removeSource('radius-circles');
    }

    // Geocode locations e adiciona markers + círculos
    const geocodeLocations = async () => {
      const features: any[] = [];
      const bounds = new mapboxgl.LngLatBounds();

      for (const location of locations) {
        try {
          const response = await fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(location)}.json?access_token=${mapboxToken}&country=BR&limit=1`
          );
          const data = await response.json();
          
          if (data.features && data.features.length > 0) {
            const [lng, lat] = data.features[0].center;
            
            // Adiciona marker
            const marker = new mapboxgl.Marker({ color: '#8B5CF6' })
              .setLngLat([lng, lat])
              .setPopup(new mapboxgl.Popup().setHTML(`<strong>${location}</strong><br/>Raio: ${radiusKm}km`))
              .addTo(map.current!);
            
            markers.current.push(marker);
            bounds.extend([lng, lat]);

            // Cria círculo para o raio
            const circle = createGeoJSONCircle([lng, lat], radiusKm);
            features.push(circle);
          }
        } catch (error) {
          console.error(`Erro ao geocodificar ${location}:`, error);
        }
      }

      // Adiciona círculos ao mapa
      if (features.length > 0) {
        map.current!.addSource('radius-circles', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: features
          }
        });

        map.current!.addLayer({
          id: 'radius-circles-fill',
          type: 'fill',
          source: 'radius-circles',
          paint: {
            'fill-color': '#8B5CF6',
            'fill-opacity': 0.15
          }
        });

        map.current!.addLayer({
          id: 'radius-circles-outline',
          type: 'line',
          source: 'radius-circles',
          paint: {
            'line-color': '#8B5CF6',
            'line-width': 2,
            'line-opacity': 0.6
          }
        });

        // Ajusta o zoom para mostrar todas as localizações
        if (!bounds.isEmpty()) {
          map.current!.fitBounds(bounds, { padding: 50, maxZoom: 10 });
        }
      }
    };

    geocodeLocations();
  }, [locations, radiusKm, mapboxToken]);

  // Função auxiliar para criar círculo GeoJSON
  const createGeoJSONCircle = (center: [number, number], radiusInKm: number) => {
    const points = 64;
    const coords = {
      latitude: center[1],
      longitude: center[0]
    };

    const km = radiusInKm;
    const ret = [];
    const distanceX = km / (111.320 * Math.cos(coords.latitude * Math.PI / 180));
    const distanceY = km / 110.574;

    for (let i = 0; i < points; i++) {
      const theta = (i / points) * (2 * Math.PI);
      const x = distanceX * Math.cos(theta);
      const y = distanceY * Math.sin(theta);
      ret.push([coords.longitude + x, coords.latitude + y]);
    }
    ret.push(ret[0]);

    return {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [ret]
      }
    };
  };

  return (
    <div className="relative w-full h-[400px] rounded-lg overflow-hidden border border-border shadow-lg">
      <div ref={mapContainer} className="absolute inset-0" />
      {locations.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/50 backdrop-blur-sm">
          <p className="text-muted-foreground text-sm">
            Adicione localizações para visualizar no mapa
          </p>
        </div>
      )}
    </div>
  );
};
