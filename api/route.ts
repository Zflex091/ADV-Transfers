import type { VercelRequest, VercelResponse } from "@vercel/node";

import {
  GeoapifyUpstreamError,
  consumeRateLimit,
  fetchGeoapifyJson,
  getGeoapifyServerKey,
  isCoordinate,
} from "./_geoapify.js";
import { createRouteToken } from "./_route-token.js";

type RoutePoint = { latitude?: unknown; longitude?: unknown };
type RouteRequest = {
  origin?: RoutePoint;
  destination?: RoutePoint;
  language?: unknown;
};

type GeoapifyRouteFeature = {
  properties?: {
    distance?: number;
    time?: number;
    polyline6?: string;
  };
};

type GeoapifyRoutingResponse = { features?: GeoapifyRouteFeature[] };

type ParsedRoute = {
  provider: "geoapify";
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline: string;
  distanceKm: number;
  durationMin: number;
};

function parseCandidate(feature: GeoapifyRouteFeature): ParsedRoute | null {
  const distanceMeters = feature.properties?.distance;
  const durationSeconds = feature.properties?.time;
  const encodedPolyline = feature.properties?.polyline6?.trim() ?? "";
  if (
    !Number.isFinite(distanceMeters) || (distanceMeters ?? 0) <= 0 ||
    !Number.isFinite(durationSeconds) || (durationSeconds ?? 0) <= 0 ||
    !encodedPolyline
  ) return null;

  const roundedDistance = Math.round(distanceMeters as number);
  const roundedDuration = Math.max(1, Math.round(durationSeconds as number));
  return {
    provider: "geoapify",
    distanceMeters: roundedDistance,
    durationSeconds: roundedDuration,
    encodedPolyline,
    distanceKm: Number((roundedDistance / 1000).toFixed(1)),
    durationMin: Math.max(1, Math.ceil(roundedDuration / 60)),
  };
}

/** Preserve the current shortest-sensible-route rule when Geoapify returns alternatives. */
export function parseRouteResponse(data: GeoapifyRoutingResponse): ParsedRoute | null {
  const candidates = (data.features ?? [])
    .map(parseCandidate)
    .filter((route): route is ParsedRoute => route !== null);
  if (candidates.length === 0) return null;

  const fastestDuration = Math.min(...candidates.map((route) => route.durationSeconds));
  const reasonable = candidates.filter((route) => route.durationSeconds <= Math.ceil(fastestDuration * 1.35));
  return (reasonable.length > 0 ? reasonable : candidates).reduce((best, route) => {
    if (route.distanceMeters !== best.distanceMeters) {
      return route.distanceMeters < best.distanceMeters ? route : best;
    }
    return route.durationSeconds < best.durationSeconds ? route : best;
  });
}

function parsePoint(point: RoutePoint | undefined) {
  if (!isCoordinate(point?.latitude, -90, 90) || !isCoordinate(point?.longitude, -180, 180)) {
    return null;
  }
  return { latitude: point.latitude, longitude: point.longitude };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Leidžiamos tik POST užklausos." });
  }

  const body = (req.body ?? {}) as RouteRequest;
  const origin = parsePoint(body.origin);
  const destination = parsePoint(body.destination);
  if (!origin || !destination) {
    return res.status(400).json({ error: "Neteisingos maršruto koordinatės." });
  }
  if (origin.latitude === destination.latitude && origin.longitude === destination.longitude) {
    return res.status(400).json({ error: "Paėmimo ir kelionės tikslo adresai turi skirtis." });
  }

  const rateLimit = consumeRateLimit(req.headers, req.socket?.remoteAddress, "routes", 20);
  res.setHeader("RateLimit-Limit", String(rateLimit.limit));
  res.setHeader("RateLimit-Remaining", String(rateLimit.remaining));
  res.setHeader("RateLimit-Reset", String(Math.ceil(rateLimit.resetAt / 1000)));
  if (!rateLimit.allowed) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000))));
    return res.status(429).json({ error: "Per daug maršruto skaičiavimo užklausų. Palaukite minutę." });
  }

  const apiKey = getGeoapifyServerKey();
  if (!apiKey) {
    return res.status(503).json({ error: "Maršrutų skaičiavimas laikinai nesukonfigūruotas. Susisiekite su mumis." });
  }

  const url = new URL("https://api.geoapify.com/v1/routing");
  // Routing expects latitude,longitude; map GeoJSON and Places use longitude,latitude.
  url.searchParams.set("waypoints", `${origin.latitude},${origin.longitude}|${destination.latitude},${destination.longitude}`);
  url.searchParams.set("mode", "drive");
  url.searchParams.set("units", "metric");
  url.searchParams.set("format", "geojson");
  url.searchParams.set("details", "polyline6");
  url.searchParams.set("apiKey", apiKey);

  try {
    const data = await fetchGeoapifyJson<GeoapifyRoutingResponse>(url.toString());
    const route = parseRouteResponse(data);
    if (!route) {
      return res.status(422).json({
        error: "Maršruto tarp pasirinktų adresų rasti nepavyko. Patikslinkite adresus arba susisiekite su mumis.",
      });
    }

    const routeToken = createRouteToken({
      origin,
      destination,
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
    });
    if (!routeToken) {
      return res.status(503).json({ error: "Kainos skaičiavimas laikinai nepasiekiamas. Bandykite vėliau." });
    }
    return res.status(200).json({ ...route, routeToken });
  } catch (error) {
    console.error("Geoapify Routing klaida", {
      status: error instanceof GeoapifyUpstreamError ? error.status : "unknown",
      detail: error instanceof GeoapifyUpstreamError ? error.detail.slice(0, 500) : "",
    });
    return res.status(error instanceof GeoapifyUpstreamError && error.status === 504 ? 504 : 502)
      .json({ error: "Maršruto apskaičiuoti nepavyko. Patikrinkite adresus arba susisiekite su mumis." });
  }
}
