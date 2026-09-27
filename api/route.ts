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

type MapboxRoute = {
  distance?: number;
  duration?: number;
  geometry?: string;
};

type MapboxDirectionsResponse = {
  code?: string;
  message?: string;
  routes?: MapboxRoute[];
};

type ParsedRoute = {
  provider: "mapbox";
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline: string;
  distanceKm: number;
  durationMin: number;
};

function parseCandidate(route: MapboxRoute | undefined): ParsedRoute | null {
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

/**
 * Pick the shortest sensible driving route instead of blindly using route[0].
 * Mapbox alternatives are already constrained to be reasonably competitive in
 * travel time. The extra 35% guard prevents an unusually slow shortcut from
 * being selected only because it is a little shorter in kilometres.
 */
export function parseRouteResponse(data: MapboxDirectionsResponse) {
  const candidates = (data.routes ?? [])
    .map(parseCandidate)
    .filter((route): route is ParsedRoute => route !== null);

  if (candidates.length === 0) {
    return null;
  }

  const fastestDuration = Math.min(
    ...candidates.map((route) => route.durationSeconds),
  );
  const reasonableDurationLimit = Math.ceil(fastestDuration * 1.35);
  const reasonable = candidates.filter(
    (route) => route.durationSeconds <= reasonableDurationLimit,
  );

  return (reasonable.length > 0 ? reasonable : candidates).reduce((best, route) => {
    if (route.distanceMeters !== best.distanceMeters) {
      return route.distanceMeters < best.distanceMeters ? route : best;
    }
    return route.durationSeconds < best.durationSeconds ? route : best;
  });
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

async function fetchDirections(
  profile: "mapbox/driving" | "mapbox/driving-traffic",
  coordinates: string,
  accessToken: string,
) {
  const url = new URL(
    `https://api.mapbox.com/directions/v5/${profile}/${coordinates}`,
  );
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("alternatives", "true");
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "polyline6");
  url.searchParams.set("steps", "false");
  url.searchParams.set("approaches", "unrestricted;unrestricted");

  return fetchMapboxJson<MapboxDirectionsResponse>(url.toString());
}

function chooseBestAcrossProfiles(
  responses: MapboxDirectionsResponse[],
): ParsedRoute | null {
  const allCandidates = responses.flatMap((response) =>
    (response.routes ?? [])
      .map(parseCandidate)
      .filter((route): route is ParsedRoute => route !== null),
  );

  if (allCandidates.length === 0) {
    return null;
  }

  const fastestDuration = Math.min(
    ...allCandidates.map((route) => route.durationSeconds),
  );
  const reasonableDurationLimit = Math.ceil(fastestDuration * 1.35);
  const reasonable = allCandidates.filter(
    (route) => route.durationSeconds <= reasonableDurationLimit,
  );
  const pool = reasonable.length > 0 ? reasonable : allCandidates;

  // Remove effectively duplicate alternatives before selecting the shortest one.
  const unique = new Map<string, ParsedRoute>();
  for (const route of pool) {
    const key = `${Math.round(route.distanceMeters / 25)}:${Math.round(
      route.durationSeconds / 10,
    )}`;
    if (!unique.has(key)) {
      unique.set(key, route);
    }
  }

  return [...unique.values()].reduce((best, route) => {
    if (route.distanceMeters !== best.distanceMeters) {
      return route.distanceMeters < best.distanceMeters ? route : best;
    }
    return route.durationSeconds < best.durationSeconds ? route : best;
  });
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

  const coordinates = [
    `${origin.longitude},${origin.latitude}`,
    `${destination.longitude},${destination.latitude}`,
  ].join(";");

  try {
    // Traffic-aware routing is the main source. We also ask the regular driving
    // profile for alternatives so a much shorter but still sensible city route
    // is not missed merely because a motorway-biased route was ranked first.
    const profiles: Array<"mapbox/driving" | "mapbox/driving-traffic"> =
      process.env.MAPBOX_ROUTES_TRAFFIC_AWARE === "false"
        ? ["mapbox/driving"]
        : ["mapbox/driving-traffic", "mapbox/driving"];

    const settled = await Promise.allSettled(
      profiles.map((profile) => fetchDirections(profile, coordinates, accessToken)),
    );
    const successful = settled.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );

    if (successful.length === 0) {
      const firstFailure = settled.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      throw firstFailure?.reason ?? new Error("Mapbox Directions failed");
    }

    const route = chooseBestAcrossProfiles(successful);

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
