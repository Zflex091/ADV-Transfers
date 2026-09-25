import { AlertCircle, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { decodePolyline } from "../maps/polyline";

const MAPBOX_GL_VERSION = "3.30.0";
const MAPBOX_SCRIPT_URL = `https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_GL_VERSION}/mapbox-gl.js`;
const MAPBOX_STYLE_URL = `https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_GL_VERSION}/mapbox-gl.css`;

type MapboxNamespace = {
  Map: new (options: Record<string, unknown>) => any;
  Marker: new (options?: Record<string, unknown>) => any;
  LngLatBounds: new (sw?: [number, number], ne?: [number, number]) => any;
};

declare global {
  interface Window {
    mapboxgl?: MapboxNamespace;
  }
}

let loaderPromise: Promise<MapboxNamespace> | null = null;

function loadMapboxGl(): Promise<MapboxNamespace> {
  if (window.mapboxgl) return Promise.resolve(window.mapboxgl);
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise<MapboxNamespace>((resolve, reject) => {
    if (!document.querySelector(`link[href="${MAPBOX_STYLE_URL}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = MAPBOX_STYLE_URL;
      document.head.appendChild(link);
    }

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${MAPBOX_SCRIPT_URL}"]`,
    );

    const complete = () => {
      if (window.mapboxgl) resolve(window.mapboxgl);
      else reject(new Error("Mapbox GL nepavyko įkelti."));
    };

    if (existing) {
      if (window.mapboxgl) complete();
      else {
        existing.addEventListener("load", complete, { once: true });
        existing.addEventListener(
          "error",
          () => reject(new Error("Mapbox GL nepavyko įkelti.")),
          { once: true },
        );
      }
      return;
    }

    const script = document.createElement("script");
    script.src = MAPBOX_SCRIPT_URL;
    script.async = true;
    script.addEventListener("load", complete, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Mapbox GL nepavyko įkelti.")),
      { once: true },
    );
    document.head.appendChild(script);
  });

  return loaderPromise;
}

type Props = {
  encodedPolyline: string;
  language?: "lt" | "en";
  ariaLabel?: string;
};

export default function GoogleRouteMap({
  encodedPolyline,
  language = "lt",
  ariaLabel,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const mapboxRef = useRef<MapboxNamespace | null>(null);
  const markersRef = useRef<any[]>([]);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN?.trim();
  const copy =
    language === "en"
      ? {
          loading: "Loading the route map...",
          unavailable:
            "The route map is temporarily unavailable. The distance and duration are still shown below.",
          label: "Complete driving route map",
        }
      : {
          loading: "Kraunamas maršruto žemėlapis...",
          unavailable:
            "Maršruto žemėlapis laikinai nepasiekiamas. Atstumas ir trukmė pateikti žemiau.",
          label: "Viso važiavimo maršruto žemėlapis",
        };

  useEffect(() => {
    let cancelled = false;

    if (!accessToken) {
      setMapFailed(true);
      return;
    }

    async function initialize() {
      try {
        const mapboxgl = await loadMapboxGl();
        if (cancelled || !containerRef.current) return;

        mapboxRef.current = mapboxgl;
        const map = new mapboxgl.Map({
          accessToken,
          container: containerRef.current,
          style: "mapbox://styles/mapbox/streets-v12",
          center: [23.9036, 54.8985],
          zoom: 10,
          attributionControl: true,
          cooperativeGestures: true,
        });
        mapRef.current = map;
        map.on("load", () => {
          if (!cancelled) {
            setMapsReady(true);
            setMapFailed(false);
          }
        });
      } catch {
        if (!cancelled) setMapFailed(true);
      }
    }

    void initialize();

    return () => {
      cancelled = true;
      markersRef.current.forEach((marker) => marker.remove?.());
      markersRef.current = [];
      mapRef.current?.remove?.();
      mapRef.current = null;
      mapboxRef.current = null;
      setMapsReady(false);
    };
  }, [accessToken]);

  useEffect(() => {
    const map = mapRef.current;
    const mapboxgl = mapboxRef.current;
    if (!mapsReady || !map || !mapboxgl || !encodedPolyline) return;

    markersRef.current.forEach((marker) => marker.remove?.());
    markersRef.current = [];

    try {
      const path = decodePolyline(encodedPolyline, 6);
      const coordinates = path.map(
        (point) => [point.lng, point.lat] as [number, number],
      );

      if (map.getLayer?.("adv-route")) map.removeLayer("adv-route");
      if (map.getSource?.("adv-route")) map.removeSource("adv-route");

      map.addSource("adv-route", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates },
        },
      });
      map.addLayer({
        id: "adv-route",
        type: "line",
        source: "adv-route",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#12664f",
          "line-width": 6,
          "line-opacity": 0.95,
        },
      });

      const start = new mapboxgl.Marker({ color: "#12664f" })
        .setLngLat(coordinates[0])
        .addTo(map);
      const finish = new mapboxgl.Marker({ color: "#12664f" })
        .setLngLat(coordinates[coordinates.length - 1])
        .addTo(map);
      markersRef.current = [start, finish];

      const bounds = new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]);
      coordinates.slice(1).forEach((coordinate) => bounds.extend(coordinate));
      map.fitBounds(bounds, { padding: 44, maxZoom: 15, duration: 0 });
      setMapFailed(false);
    } catch {
      setMapFailed(true);
    }
  }, [encodedPolyline, mapsReady]);

  return (
    <section className="google-route-map" aria-label={ariaLabel || copy.label}>
      <div ref={containerRef} className="google-route-map-canvas" />
      {!mapsReady && !mapFailed && (
        <div className="route-map-state" role="status">
          <LoaderCircle className="spin" aria-hidden="true" />
          <span>{copy.loading}</span>
        </div>
      )}
      {mapFailed && (
        <div className="route-map-state route-map-error" role="alert">
          <AlertCircle aria-hidden="true" />
          <span>{copy.unavailable}</span>
        </div>
      )}
    </section>
  );
}
