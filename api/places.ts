import type { VercelRequest, VercelResponse } from "@vercel/node";

import {
  MapboxUpstreamError,
  consumeRateLimit,
  fetchMapboxJson,
  getMapboxServerToken,
  getQueryValue,
  isValidSessionToken,
  normalizeLanguage,
} from "./_mapbox.js";

const AUTOCOMPLETE_URL = "https://api.mapbox.com/search/searchbox/v1/suggest";

type MapboxSuggestion = {
  name?: string;
  name_preferred?: string;
  mapbox_id?: string;
  feature_type?: string;
  address?: string;
  full_address?: string;
  place_formatted?: string;
  poi_category?: string[];
};

type MapboxAutocompleteResponse = {
  suggestions?: MapboxSuggestion[];
};

export type PlaceSuggestion = {
  provider: "mapbox";
  providerPlaceId: string;
  label: string;
  mainText: string;
  secondaryText: string;
  types: string[];
};

function suggestionLabel(suggestion: MapboxSuggestion) {
  const fullAddress = suggestion.full_address?.trim();
  if (fullAddress) return fullAddress;

  const name = (suggestion.name_preferred || suggestion.name || "").trim();
  const context = suggestion.place_formatted?.trim() ?? "";
  if (name && context) return `${name}, ${context}`;
  return name || suggestion.address?.trim() || context;
}

export function mapAutocompleteResponse(
  data: MapboxAutocompleteResponse,
): PlaceSuggestion[] {
  if (!Array.isArray(data.suggestions)) {
    return [];
  }

  return data.suggestions.flatMap((suggestion) => {
    const providerPlaceId = suggestion.mapbox_id?.trim() ?? "";
    const label = suggestionLabel(suggestion);
    const mainText = (suggestion.name_preferred || suggestion.name || label).trim();
    const secondaryText = suggestion.place_formatted?.trim() ?? "";

    if (!providerPlaceId || !label || !mainText) {
      return [];
    }

    const types = [suggestion.feature_type, ...(suggestion.poi_category ?? [])]
      .filter((value): value is string => typeof value === "string" && value.length > 0);

    return [{
      provider: "mapbox" as const,
      providerPlaceId,
      label,
      mainText,
      secondaryText,
      types,
    }];
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
    req.socket?.remoteAddress,
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

  const accessToken = getMapboxServerToken();
  if (!accessToken) {
    return res.status(503).json({
      error: "Adresų paieška laikinai nesukonfigūruota. Susisiekite su mumis.",
    });
  }

  const url = new URL(AUTOCOMPLETE_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("session_token", sessionToken);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("language", normalizeLanguage(getQueryValue(req.query.language)));
  url.searchParams.set("country", "LT");
  url.searchParams.set("limit", "6");
  url.searchParams.set("proximity", "23.9036,54.8985");
  url.searchParams.set("types", "address,poi,street,place,locality");

  try {
    const data = await fetchMapboxJson<MapboxAutocompleteResponse>(url.toString());
    return res.status(200).json(mapAutocompleteResponse(data));
  } catch (error) {
    const upstreamStatus =
      error instanceof MapboxUpstreamError ? error.status : "unknown";
    const status =
      error instanceof MapboxUpstreamError && error.status === 504 ? 504 : 502;

    console.error("Mapbox Search autocomplete klaida", {
      status: upstreamStatus,
      detail:
        error instanceof MapboxUpstreamError ? error.detail.slice(0, 500) : "",
    });

    return res.status(status).json({
      error:
        status === 504
          ? "Adresų paieška užtruko per ilgai. Bandykite dar kartą."
          : "Adresų paieška šiuo metu nepasiekiama. Bandykite dar kartą.",
    });
  }
}
