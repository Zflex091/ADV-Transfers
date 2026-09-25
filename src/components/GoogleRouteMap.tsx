import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { AlertCircle, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { decodeGooglePolyline } from "../maps/polyline";

let loaderKey: string | null = null;

function configureLoader(apiKey: string) {
  if (loaderKey === null) {
    setOptions({ key: apiKey, v: "weekly" });
    loaderKey = apiKey;
    return;
  }

  if (loaderKey !== apiKey) {
    throw new Error("Google Maps rakto negalima pakeisti neperkraunant puslapio.");
  }
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
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlaysRef = useRef<google.maps.MVCObject[]>([]);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_API_KEY?.trim();
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
    const resolvedApiKey = apiKey ?? "";

    if (!resolvedApiKey) {
      setMapFailed(true);
      return;
    }

    async function initialize() {
      try {
        configureLoader(resolvedApiKey);
        const { Map } = await importLibrary("maps");

        if (cancelled || !containerRef.current) {
          return;
        }

        mapRef.current = new Map(containerRef.current, {
          center: { lat: 54.8985, lng: 23.9036 },
          zoom: 10,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          clickableIcons: false,
          gestureHandling: "cooperative",
        });
        setMapsReady(true);
        setMapFailed(false);
      } catch {
        if (!cancelled) {
          setMapFailed(true);
        }
      }
    }

    void initialize();

    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  useEffect(() => {
    overlaysRef.current.forEach((overlay) => {
      if ("setMap" in overlay) {
        (overlay as google.maps.Polyline | google.maps.Circle).setMap(null);
      }
    });
    overlaysRef.current = [];

    if (!mapsReady || !mapRef.current || !encodedPolyline) {
      return;
    }

    try {
      const path = decodeGooglePolyline(encodedPolyline);
      const route = new google.maps.Polyline({
        path,
        strokeColor: "#12664f",
        strokeOpacity: 0.95,
        strokeWeight: 6,
        map: mapRef.current,
      });
      const endpointOptions = {
        radius: 7,
        fillColor: "#ffffff",
        fillOpacity: 1,
        strokeColor: "#12664f",
        strokeOpacity: 1,
        strokeWeight: 4,
        map: mapRef.current,
      };
      const start = new google.maps.Circle({
        ...endpointOptions,
        center: path[0],
      });
      const finish = new google.maps.Circle({
        ...endpointOptions,
        center: path[path.length - 1],
      });
      const bounds = new google.maps.LatLngBounds();
      path.forEach((point) => bounds.extend(point));
      mapRef.current.fitBounds(bounds, 44);
      overlaysRef.current = [route, start, finish];
      setMapFailed(false);
    } catch {
      setMapFailed(true);
    }

    return () => {
      overlaysRef.current.forEach((overlay) => {
        if ("setMap" in overlay) {
          (overlay as google.maps.Polyline | google.maps.Circle).setMap(null);
        }
      });
      overlaysRef.current = [];
    };
  }, [encodedPolyline, mapsReady]);

  return (
    <section
      className="google-route-map"
      aria-label={ariaLabel || copy.label}
    >
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
