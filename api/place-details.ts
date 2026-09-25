import type { VercelRequest, VercelResponse } from "@vercel/node";

import {
  GoogleMapsUpstreamError,
  consumeRateLimit,
  fetchGoogleJson,
  getGoogleMapsServerKey,
  getQueryValue,
  isCoordinate,
  isValidPlaceId,
  isValidSessionToken,
  normalizeLanguage,
} from "./_google-maps.js";
import { createVerifiedPlaceToken } from "./_place-token.js";

const PLACE_DETAILS_FIELDS = "id,formattedAddress,location";

type GooglePlaceDetails = {
  id?: string;
  formattedAddress?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
};

export function mapPlaceDetails(data: GooglePlaceDetails) {
  const providerPlaceId = data.id?.trim() ?? "";
  const label = data.formattedAddress?.trim() ?? "";
  const latitude = data.location?.latitude;
  const longitude = data.location?.longitude;

  if (
    !providerPlaceId ||
    !label ||
    !isCoordinate(latitude, -90, 90) ||
    !isCoordinate(longitude, -180, 180)
  ) {
    return null;
  }

  return {
    provider: "google" as const,
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

  if (!isValidPlaceId(placeId) || !isValidSessionToken(sessionToken)) {
    return res.status(400).json({ error: "Neteisingai pasirinktas adresas." });
  }

  const rateLimit = consumeRateLimit(
    req.headers,
    req.socket.remoteAddress,
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

  const apiKey = getGoogleMapsServerKey();

  if (!apiKey) {
    return res.status(503).json({
      error: "Adresų paieška laikinai nesukonfigūruota. Susisiekite su mumis.",
    });
  }

  const url = new URL(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
  );
  url.searchParams.set(
    "languageCode",
    normalizeLanguage(getQueryValue(req.query.language)),
  );
  url.searchParams.set("regionCode", "LT");
  url.searchParams.set("sessionToken", sessionToken);

  try {
    const data = await fetchGoogleJson<GooglePlaceDetails>(
      url.toString(),
      apiKey,
      PLACE_DETAILS_FIELDS,
      { method: "GET" },
    );
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
    console.error("Google Place Details klaida", {
      status:
        error instanceof GoogleMapsUpstreamError ? error.status : "unknown",
    });

    return res.status(
      error instanceof GoogleMapsUpstreamError && error.status === 504
        ? 504
        : 502,
    ).json({
      error: "Nepavyko patvirtinti pasirinkto adreso. Bandykite dar kartą.",
    });
  }
}
