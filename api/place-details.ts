import type { VercelRequest, VercelResponse } from "@vercel/node";

import {
  MapboxUpstreamError,
  consumeRateLimit,
  fetchMapboxJson,
  getMapboxServerToken,
  getQueryValue,
  isCoordinate,
  isValidMapboxId,
  isValidSessionToken,
  normalizeLanguage,
} from "./_mapbox.js";
import { createVerifiedPlaceToken } from "./_place-token.js";

type MapboxFeature = {
  geometry?: {
    type?: string;
    coordinates?: unknown[];
  };
  properties?: {
    name?: string;
    name_preferred?: string;
    mapbox_id?: string;
    address?: string;
    full_address?: string;
    place_formatted?: string;
    coordinates?: {
      latitude?: number;
      longitude?: number;
      routable_points?: Array<{
        latitude?: number;
        longitude?: number;
      }>;
    };
  };
};

type MapboxRetrieveResponse = {
  features?: MapboxFeature[];
};

function placeLabel(feature: MapboxFeature) {
  const properties = feature.properties;
  const fullAddress = properties?.full_address?.trim();
  if (fullAddress) return fullAddress;

  const name = (properties?.name_preferred || properties?.name || "").trim();
  const context = properties?.place_formatted?.trim() ?? "";
  if (name && context) return `${name}, ${context}`;
  return name || properties?.address?.trim() || context;
}

export function mapPlaceDetails(data: MapboxRetrieveResponse) {
  const feature = data.features?.[0];
  const properties = feature?.properties;
  const providerPlaceId = properties?.mapbox_id?.trim() ?? "";
  const label = feature ? placeLabel(feature) : "";

  const routable = properties?.coordinates?.routable_points?.find(
    (point) =>
      isCoordinate(point?.latitude, -90, 90) &&
      isCoordinate(point?.longitude, -180, 180),
  );

  const geometryCoordinates = feature?.geometry?.coordinates;
  const geometryLongitude = Array.isArray(geometryCoordinates)
    ? geometryCoordinates[0]
    : undefined;
  const geometryLatitude = Array.isArray(geometryCoordinates)
    ? geometryCoordinates[1]
    : undefined;

  const latitude = routable?.latitude ?? properties?.coordinates?.latitude ?? geometryLatitude;
  const longitude = routable?.longitude ?? properties?.coordinates?.longitude ?? geometryLongitude;

  if (
    !providerPlaceId ||
    !label ||
    !isCoordinate(latitude, -90, 90) ||
    !isCoordinate(longitude, -180, 180)
  ) {
    return null;
  }

  return {
    provider: "mapbox" as const,
    providerPlaceId,
    label,
    latitude,
    longitude,
  };
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Leidžiamos tik GET užklausos." });
  }

  const placeId = getQueryValue(req.query.placeId).trim();
  const sessionToken = getQueryValue(req.query.sessionToken).trim();

  if (!isValidMapboxId(placeId) || !isValidSessionToken(sessionToken)) {
    return res.status(400).json({ error: "Neteisingai pasirinktas adresas." });
  }

  const rateLimit = consumeRateLimit(
    req.headers,
    req.socket?.remoteAddress,
    "place-details",
    30,
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
      error: "Per daug adreso tikslinimo užklausų. Palaukite minutę.",
    });
  }

  const accessToken = getMapboxServerToken();
  if (!accessToken) {
    return res.status(503).json({
      error: "Adresų paieška laikinai nesukonfigūruota. Susisiekite su mumis.",
    });
  }

  const url = new URL(
    `https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(placeId)}`,
  );
  url.searchParams.set("session_token", sessionToken);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("language", normalizeLanguage(getQueryValue(req.query.language)));

  try {
    const data = await fetchMapboxJson<MapboxRetrieveResponse>(url.toString());
    const place = mapPlaceDetails(data);

    if (!place || place.providerPlaceId !== placeId) {
      return res.status(502).json({
        error: "Pasirinkto adreso koordinatės negautos. Pasirinkite kitą rezultatą.",
      });
    }

    const placeToken = createVerifiedPlaceToken(place);
    if (!placeToken) {
      return res.status(503).json({
        error: "Adreso patvirtinimas laikinai nepasiekiamas. Bandykite dar kartą.",
      });
    }

    return res.status(200).json({ ...place, placeToken });
  } catch (error) {
    console.error("Mapbox Search retrieve klaida", {
      status: error instanceof MapboxUpstreamError ? error.status : "unknown",
      detail:
        error instanceof MapboxUpstreamError ? error.detail.slice(0, 500) : "",
    });

    return res.status(
      error instanceof MapboxUpstreamError && error.status === 504 ? 504 : 502,
    ).json({
      error: "Nepavyko patvirtinti pasirinkto adreso. Bandykite dar kartą.",
    });
  }
}
