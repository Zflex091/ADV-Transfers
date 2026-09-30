import { AlertCircle, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { decodePolyline } from "../maps/polyline";

const LEAFLET_SCRIPT_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const LEAFLET_STYLE_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_SCRIPT_INTEGRITY = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";
const LEAFLET_STYLE_INTEGRITY = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";

type LeafletNamespace = {
  Browser: { retina: boolean };
  map: (element: HTMLElement, options: Record<string, unknown>) => any;
  tileLayer: (url: string, options: Record<string, unknown>) => any;
  polyline: (points: [number, number][], options: Record<string, unknown>) => any;
  circleMarker: (point: [number, number], options: Record<string, unknown>) => any;
};

declare global {
  interface Window { L?: LeafletNamespace }
}

let loaderPromise: Promise<LeafletNamespace> | null = null;

function loadLeaflet(): Promise<LeafletNamespace> {
  if (loaderPromise) return loaderPromise;
  if (window.L && document.querySelector<HTMLLinkElement>(`link[href="${LEAFLET_STYLE_URL}"]`)?.sheet) {
    return Promise.resolve(window.L);
  }

  const stylePromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLLinkElement>(`link[href="${LEAFLET_STYLE_URL}"]`);
    if (existing?.sheet) {
      resolve();
      return;
    }
    const link = existing ?? document.createElement("link");
    if (!existing) {
      link.rel = "stylesheet";
      link.href = LEAFLET_STYLE_URL;
      link.integrity = LEAFLET_STYLE_INTEGRITY;
      link.crossOrigin = "anonymous";
    }
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => {
      link.remove();
      reject(new Error("Leaflet žemėlapio stiliaus nepavyko įkelti."));
    }, { once: true });
    if (!existing) document.head.appendChild(link);
  });

  const scriptPromise = new Promise<LeafletNamespace>((resolve, reject) => {
    if (window.L) {
      resolve(window.L);
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${LEAFLET_SCRIPT_URL}"]`);
    const script = existing ?? document.createElement("script");
    if (!existing) {
      script.src = LEAFLET_SCRIPT_URL;
      script.integrity = LEAFLET_SCRIPT_INTEGRITY;
      script.crossOrigin = "anonymous";
      script.async = true;
    }
    const complete = () => {
      if (window.L) resolve(window.L);
      else {
        script.remove();
        reject(new Error("Leaflet žemėlapio nepavyko įkelti."));
      }
    };
    script.addEventListener("load", complete, { once: true });
    script.addEventListener("error", () => {
      script.remove();
      reject(new Error("Leaflet žemėlapio nepavyko įkelti."));
    }, { once: true });
    if (!existing) document.head.appendChild(script);
  });

  loaderPromise = Promise.all([stylePromise, scriptPromise]).then(([, leaflet]) => leaflet).catch((error) => {
    loaderPromise = null;
    throw error;
  });

  return loaderPromise;
}

type Props = {
  encodedPolyline: string;
  language?: "lt" | "en";
  ariaLabel?: string;
};

export default function GoogleRouteMap({ encodedPolyline, language = "lt", ariaLabel }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const leafletRef = useRef<LeafletNamespace | null>(null);
  const routeLayersRef = useRef<any[]>([]);
  const tileFailedRef = useRef(false);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const apiKey = import.meta.env.VITE_GEOAPIFY_API_KEY?.trim();
  const copy = language === "en"
    ? {
        loading: "Loading the route map...",
        unavailable: "The route map is temporarily unavailable. The distance and duration are still shown below.",
        label: "Complete driving route map",
      }
    : {
        loading: "Kraunamas maršruto žemėlapis...",
        unavailable: "Maršruto žemėlapis laikinai nepasiekiamas. Atstumas ir trukmė pateikti žemiau.",
        label: "Viso važiavimo maršruto žemėlapis",
      };

  useEffect(() => {
    let cancelled = false;
    const mapKey = apiKey || "";
    if (!mapKey) {
      setMapFailed(true);
      return;
    }

    async function initialize() {
      try {
        tileFailedRef.current = false;
        const leaflet = await loadLeaflet();
        if (cancelled || !containerRef.current) return;
        leafletRef.current = leaflet;

        const map = leaflet.map(containerRef.current, {
          zoomControl: false,
          scrollWheelZoom: false,
          attributionControl: true,
        }).setView([54.8985, 23.9036], 10);
        mapRef.current = map;

        const tilePath = leaflet.Browser.retina
          ? "{z}/{x}/{y}@2x.png"
          : "{z}/{x}/{y}.png";
        const tiles = leaflet.tileLayer(
          `https://maps.geoapify.com/v1/tile/osm-bright/${tilePath}?apiKey=${encodeURIComponent(mapKey)}`,
          {
            maxZoom: 20,
            attribution: 'Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noopener noreferrer">Geoapify</a> | <a href="https://openmaptiles.org/" target="_blank" rel="noopener noreferrer">© OpenMapTiles</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a> contributors',
          },
        );
        tiles.on("tileerror", () => {
          tileFailedRef.current = true;
          if (!cancelled) setMapFailed(true);
        });
        tiles.addTo(map);
        map.invalidateSize();
        setMapsReady(true);
        setMapFailed(tileFailedRef.current);
      } catch {
        if (!cancelled) setMapFailed(true);
      }
    }

    void initialize();
    return () => {
      cancelled = true;
      routeLayersRef.current.forEach((layer) => layer.remove?.());
      routeLayersRef.current = [];
      mapRef.current?.remove?.();
      mapRef.current = null;
      leafletRef.current = null;
      tileFailedRef.current = false;
      setMapsReady(false);
    };
  }, [apiKey]);

  useEffect(() => {
    const map = mapRef.current;
    const leaflet = leafletRef.current;
    if (!mapsReady || !map || !leaflet || !encodedPolyline) return;
    routeLayersRef.current.forEach((layer) => layer.remove?.());
    routeLayersRef.current = [];

    try {
      const points = decodePolyline(encodedPolyline, 6)
        .map((point) => [point.lat, point.lng] as [number, number]);
      const route = leaflet.polyline(points, {
        color: "#12664f",
        weight: 6,
        opacity: 0.95,
        lineJoin: "round",
        lineCap: "round",
      }).addTo(map);
      const markerStyle = {
        radius: 8,
        color: "#ffffff",
        weight: 3,
        fillColor: "#12664f",
        fillOpacity: 1,
      };
      const start = leaflet.circleMarker(points[0], markerStyle).addTo(map);
      const finish = leaflet.circleMarker(points[points.length - 1], markerStyle).addTo(map);
      routeLayersRef.current = [route, start, finish];
      map.fitBounds(route.getBounds(), { padding: [44, 44], maxZoom: 15, animate: false });
      if (!tileFailedRef.current) setMapFailed(false);
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
