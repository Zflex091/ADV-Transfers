import type { VercelRequest, VercelResponse } from "@vercel/node";

import {
  GeoapifyUpstreamError,
  consumeRateLimit,
  fetchGeoapifyJson,
  getGeoapifyServerKey,
  getQueryValue,
  isCoordinate,
  isValidGeoapifyId,
  isValidSessionToken,
  normalizeLanguage,
} from "./_geoapify.js";
import { createVerifiedPlaceToken } from "./_place-token.js";

type GeoapifyDetailsFeature = {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: {
    feature_type?: string;
    place_id?: string;
    name?: string;
    formatted?: string;
    address_line1?: string;
    address_line2?: string;
    lat?: number;
    lon?: number;
  };
};

type GeoapifyDetailsResponse = { features?: GeoapifyDetailsFeature[] };

export function mapPlaceDetails(data: GeoapifyDetailsResponse, requestedPlaceId: string) {
  const feature = data.features?.find((item) => item.properties?.feature_type === "details");
  const properties = feature?.properties;
  if (!properties) return null;

  const returnedId = properties.place_id?.trim();
  if (returnedId && returnedId !== requestedPlaceId) return null;

  const name = properties.name?.trim() ?? "";
  const formatted = properties.formatted?.trim() ||
    [properties.address_line1?.trim(), properties.address_line2?.trim()].filter(Boolean).join(", ");
  const label = name && formatted && !formatted.toLocaleLowerCase("lt-LT").includes(name.toLocaleLowerCase("lt-LT"))
    ? `${name}, ${formatted}`
    : formatted || name;
  const point = feature?.geometry?.type === "Point" && Array.isArray(feature.geometry.coordinates)
    ? feature.geometry.coordinates
    : null;
  const latitude = properties.lat ?? point?.[1];
  const longitude = properties.lon ?? point?.[0];

  if (
    !isValidGeoapifyId(requestedPlaceId) ||
    !label ||
    !isCoordinate(latitude, -90, 90) ||
    !isCoordinate(longitude, -180, 180)
  ) return null;

  return {
    provider: "geoapify" as const,
    providerPlaceId: requestedPlaceId,
    label,
    latitude,
    longitude,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Leidžiamos tik GET užklausos." });
  }

  const placeId = getQueryValue(req.query.placeId).trim();
  const sessionToken = getQueryValue(req.query.sessionToken).trim();
  if (!isValidGeoapifyId(placeId) || !isValidSessionToken(sessionToken)) {
    return res.status(400).json({ error: "Neteisingai pasirinktas adresas." });
  }

  const rateLimit = consumeRateLimit(req.headers, req.socket?.remoteAddress, "place-details", 30);
  res.setHeader("RateLimit-Limit", String(rateLimit.limit));
  res.setHeader("RateLimit-Remaining", String(rateLimit.remaining));
  res.setHeader("RateLimit-Reset", String(Math.ceil(rateLimit.resetAt / 1000)));
  if (!rateLimit.allowed) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000))));
    return res.status(429).json({ error: "Per daug adreso tikslinimo užklausų. Palaukite minutę." });
  }

  const apiKey = getGeoapifyServerKey();
  if (!apiKey) {
    return res.status(503).json({ error: "Adresų paieška laikinai nesukonfigūruota. Susisiekite su mumis." });
  }

  const url = new URL("https://api.geoapify.com/v2/place-details");
  url.searchParams.set("id", placeId);
  url.searchParams.set("features", "details");
  url.searchParams.set("lang", normalizeLanguage(getQueryValue(req.query.language)));
  url.searchParams.set("apiKey", apiKey);

  try {
    const data = await fetchGeoapifyJson<GeoapifyDetailsResponse>(url.toString());
    const place = mapPlaceDetails(data, placeId);
    if (!place) {
      return res.status(502).json({ error: "Pasirinkto adreso koordinatės negautos. Pasirinkite kitą rezultatą." });
    }

    const placeToken = createVerifiedPlaceToken(place);
    if (!placeToken) {
      return res.status(503).json({ error: "Adreso patvirtinimas laikinai nepasiekiamas. Bandykite dar kartą." });
    }
    return res.status(200).json({ ...place, placeToken });
  } catch (error) {
    console.error("Geoapify Place Details klaida", {
      status: error instanceof GeoapifyUpstreamError ? error.status : "unknown",
      detail: error instanceof GeoapifyUpstreamError ? error.detail.slice(0, 500) : "",
    });
    return res.status(error instanceof GeoapifyUpstreamError && error.status === 504 ? 504 : 502)
      .json({ error: "Nepavyko patvirtinti pasirinkto adreso. Bandykite dar kartą." });
  }
}
