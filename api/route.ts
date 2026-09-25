import type { VercelRequest, VercelResponse } from "@vercel/node";

import {
  MapboxUpstreamError,
  consumeRateLimit,
  fetchMapboxJson,
  getMapboxServerToken,
  isCoordinate,
} from "./_mapbox.js";
import { createRouteToken } from "./_route-token.js";

type RoutePoint = {
  latitude?: unknown;
  longitude?: unknown;
};

type RouteRequest = {
  origin?: RoutePoint;
  destination?: RoutePoint;
  language?: unknown;
};

type MapboxDirectionsResponse = {
  code?: string;
  message?: string;
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: string;
  }>;
};

export function parseRouteResponse(data: MapboxDirectionsResponse) {
  const route = data.routes?.[0];
  const distanceMeters = route?.distance;
  const durationSeconds = route?.duration;
  const encodedPolyline = route?.geometry?.trim() ?? "";

  if (
    !Number.isFinite(distanceMeters) ||
    (distanceMeters ?? 0) <= 0 ||
    !Number.isFinite(durationSeconds) ||
    (durationSeconds ?? 0) <= 0 ||
    !encodedPolyline
  ) {
    return null;
  }

  const roundedDistance = Math.round(distanceMeters as number);
  const roundedDuration = Math.max(1, Math.round(durationSeconds as number));

  return {
    provider: "mapbox" as const,
    distanceMeters: roundedDistance,
    durationSeconds: roundedDuration,
    encodedPolyline,
    distanceKm: Number((roundedDistance / 1000).toFixed(1)),
    durationMin: Math.max(1, Math.ceil(roundedDuration / 60)),
  };
}

function parsePoint(point: RoutePoint | undefined) {
  if (
    !isCoordinate(point?.latitude, -90, 90) ||
    !isCoordinate(point?.longitude, -180, 180)
  ) {
    return null;
  }

  return {
    latitude: point.latitude,
    longitude: point.longitude,
  };
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
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

  if (
    origin.latitude === destination.latitude &&
    origin.longitude === destination.longitude
  ) {
    return res.status(400).json({
      error: "Paėmimo ir kelionės tikslo adresai turi skirtis.",
    });
  }

  const rateLimit = consumeRateLimit(
    req.headers,
    req.socket?.remoteAddress,
    "routes",
    20,
  );
  res.setHeader("RateLimit-Limit", String(rateLimit.limit));
  res.setHeader("RateLimit-Remaining", String(rateLimit.remaining));
  res.setHeader("RateLimit-Reset", String(Math.ceil(rateLimit.resetAt / 1000)));

  if (!rateLimit.allowed) {
    res.setHeader(
      "Retry-After",
      String(Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000))),
    );
    return res.status(429).json({
      error: "Per daug maršruto skaičiavimo užklausų. Palaukite minutę.",
    });
  }

  const accessToken = getMapboxServerToken();
  if (!accessToken) {
    return res.status(503).json({
      error: "Maršrutų skaičiavimas laikinai nesukonfigūruotas. Susisiekite su mumis.",
    });
  }

  const profile =
    process.env.MAPBOX_ROUTES_TRAFFIC_AWARE === "true"
      ? "mapbox/driving-traffic"
      : "mapbox/driving";
  const coordinates = [
    `${origin.longitude},${origin.latitude}`,
    `${destination.longitude},${destination.latitude}`,
  ].join(";");
  const url = new URL(
    `https://api.mapbox.com/directions/v5/${profile}/${coordinates}`,
  );
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("alternatives", "false");
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "polyline6");
  url.searchParams.set("steps", "false");

  try {
    const data = await fetchMapboxJson<MapboxDirectionsResponse>(url.toString());
    const route = parseRouteResponse(data);

    if (!route) {
      return res.status(422).json({
        error:
          "Maršruto tarp pasirinktų adresų rasti nepavyko. Patikslinkite adresus arba susisiekite su mumis.",
      });
    }

    const routeToken = createRouteToken({
      origin,
      destination,
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
    });
    if (!routeToken) {
      return res.status(503).json({
        error: "Kainos skaičiavimas laikinai nepasiekiamas. Bandykite vėliau.",
      });
    }

    return res.status(200).json({ ...route, routeToken });
  } catch (error) {
    console.error("Mapbox Directions klaida", {
      status: error instanceof MapboxUpstreamError ? error.status : "unknown",
      detail:
        error instanceof MapboxUpstreamError ? error.detail.slice(0, 500) : "",
    });

    return res.status(
      error instanceof MapboxUpstreamError && error.status === 504 ? 504 : 502,
    ).json({
      error:
        "Maršruto apskaičiuoti nepavyko. Patikrinkite adresus arba susisiekite su mumis.",
    });
  }
}
