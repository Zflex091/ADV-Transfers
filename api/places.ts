import type { VercelRequest, VercelResponse } from "@vercel/node";

import {
  GoogleMapsUpstreamError,
  consumeRateLimit,
  fetchGoogleJson,
  getGoogleMapsServerKey,
  getQueryValue,
  isValidSessionToken,
  normalizeLanguage,
} from "./_google-maps.js";

const AUTOCOMPLETE_URL =
  "https://places.googleapis.com/v1/places:autocomplete";
const AUTOCOMPLETE_FIELDS = [
  "suggestions.placePrediction.placeId",
  "suggestions.placePrediction.text.text",
  "suggestions.placePrediction.structuredFormat.mainText.text",
  "suggestions.placePrediction.structuredFormat.secondaryText.text",
  "suggestions.placePrediction.types",
].join(",");

type GoogleAutocompleteResponse = {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
      types?: string[];
    };
  }>;
};

export type PlaceSuggestion = {
  provider: "google";
  providerPlaceId: string;
  label: string;
  mainText: string;
  secondaryText: string;
  types: string[];
};

export function mapAutocompleteResponse(
  data: GoogleAutocompleteResponse,
): PlaceSuggestion[] {
  if (!Array.isArray(data.suggestions)) {
    return [];
  }

  return data.suggestions.flatMap((suggestion) => {
    const prediction = suggestion.placePrediction;
    const providerPlaceId = prediction?.placeId?.trim() ?? "";
    const label = prediction?.text?.text?.trim() ?? "";

    if (!providerPlaceId || !label) {
      return [];
    }

    return [
      {
        provider: "google" as const,
        providerPlaceId,
        label,
        mainText:
          prediction?.structuredFormat?.mainText?.text?.trim() ||
          label,
        secondaryText:
          prediction?.structuredFormat?.secondaryText?.text?.trim() ||
          "",
        types: Array.isArray(prediction?.types)
          ? prediction.types.filter(
              (type): type is string => typeof type === "string",
            )
          : [],
      },
    ];
  });
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

  const query = getQueryValue(req.query.q).trim();

  if (query.length < 2) {
    return res.status(200).json([]);
  }

  if (query.length > 160) {
    return res.status(400).json({ error: "Adreso paieškos tekstas per ilgas." });
  }

  const sessionToken = getQueryValue(req.query.sessionToken).trim();

  if (!isValidSessionToken(sessionToken)) {
    return res.status(400).json({
      error: "Nepavyko pradėti saugios adresų paieškos sesijos.",
    });
  }

  const rateLimit = consumeRateLimit(
    req.headers,
    req.socket.remoteAddress,
    "places-autocomplete",
    90,
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
      error: "Per daug adresų paieškų. Palaukite minutę ir bandykite dar kartą.",
    });
  }

  const apiKey = getGoogleMapsServerKey();

  if (!apiKey) {
    return res.status(503).json({
      error: "Adresų paieška laikinai nesukonfigūruota. Susisiekite su mumis.",
    });
  }

  const languageCode = normalizeLanguage(
    getQueryValue(req.query.language),
  );

  try {
    const data = await fetchGoogleJson<GoogleAutocompleteResponse>(
      AUTOCOMPLETE_URL,
      apiKey,
      AUTOCOMPLETE_FIELDS,
      {
        method: "POST",
        body: JSON.stringify({
          input: query,
          sessionToken,
          languageCode,
          regionCode: "LT",
          locationBias: {
            circle: {
              center: {
                latitude: 54.8985,
                longitude: 23.9036,
              },
              radius: 50_000,
            },
          },
        }),
      },
    );

    return res.status(200).json(mapAutocompleteResponse(data));
  } catch (error) {
    const status =
      error instanceof GoogleMapsUpstreamError && error.status === 504
        ? 504
        : 502;

    console.error("Google Places autocomplete klaida", {
      status:
        error instanceof GoogleMapsUpstreamError ? error.status : "unknown",
    });

    return res.status(status).json({
      error:
        status === 504
          ? "Adresų paieška užtruko per ilgai. Bandykite dar kartą."
          : "Adresų paieška šiuo metu nepasiekiama. Bandykite dar kartą.",
    });
  }
}
