import type { VercelRequest, VercelResponse } from "@vercel/node";

import {
  GoogleMapsUpstreamError,
  consumeRateLimit,
  fetchGoogleJson,
  getGoogleMapsServerKey,
  isCoordinate,
  normalizeLanguage,
} from "./_google-maps.js";
import { createRouteToken } from "./_route-token.js";

const ROUTES_URL =
  "https://routes.googleapis.com/directions/v2:computeRoutes";
const ROUTES_FIELDS = [
  "routes.distanceMeters",
  "routes.duration",
  "routes.polyline.encodedPolyline",
].join(",");

type RoutePoint = {
  latitude?: unknown;
  longitude?: unknown;
};

type RouteRequest = {
  origin?: RoutePoint;
  destination?: RoutePoint;
  language?: unknown;
};

type GoogleRoutesResponse = {
  routes?: Array<{
    distanceMeters?: number;
    duration?: string;
    polyline?: { encodedPolyline?: string };
  }>;
};

export function parseRouteResponse(data: GoogleRoutesResponse) {
  const route = data.routes?.[0];
  const distanceMeters = route?.distanceMeters;
  const durationMatch = route?.duration?.match(/^(\d+(?:\.\d+)?)s$/);
  const durationSeconds = durationMatch
    ? Math.max(1, Math.round(Number(durationMatch[1])))
    : Number.NaN;
  const encodedPolyline = route?.polyline?.encodedPolyline?.trim() ?? "";

  if (
    !Number.isFinite(distanceMeters) ||
    (distanceMeters ?? 0) <= 0 ||
    !Number.isFinite(durationSeconds) ||
    !encodedPolyline
  ) {
    return null;
  }

  return {
    provider: "google" as const,
    distanceMeters: Math.round(distanceMeters as number),
    durationSeconds,
    encodedPolyline,
    distanceKm: Number(((distanceMeters as number) / 1000).toFixed(1)),
    durationMin: Math.max(1, Math.ceil(durationSeconds / 60)),
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
    req.socket.remoteAddress,
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

  const apiKey = getGoogleMapsServerKey();

  if (!apiKey) {
    return res.status(503).json({
      error: "Maršrutų skaičiavimas laikinai nesukonfigūruotas. Susisiekite su mumis.",
    });
  }

  const trafficAware =
    process.env.GOOGLE_ROUTES_TRAFFIC_AWARE === "true";

  try {
    const data = await fetchGoogleJson<GoogleRoutesResponse>(
      ROUTES_URL,
      apiKey,
      ROUTES_FIELDS,
      {
        method: "POST",
        body: JSON.stringify({
          origin: { location: { latLng: origin } },
          destination: { location: { latLng: destination } },
          travelMode: "DRIVE",
          routingPreference: trafficAware
            ? "TRAFFIC_AWARE"
            : "TRAFFIC_UNAWARE",
          computeAlternativeRoutes: false,
          languageCode: normalizeLanguage(body.language),
          units: "METRIC",
        }),
      },
    );
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
    console.error("Google Routes klaida", {
      status:
        error instanceof GoogleMapsUpstreamError ? error.status : "unknown",
    });

    return res.status(
      error instanceof GoogleMapsUpstreamError && error.status === 504
        ? 504
        : 502,
    ).json({
      error:
        "Maršruto apskaičiuoti nepavyko. Patikrinkite adresus arba susisiekite su mumis.",
    });
  }
}
