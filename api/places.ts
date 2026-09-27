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
const KAUNAS_PROXIMITY = "23.9036,54.8985";
const MAX_RESULTS = 6;

type MapboxSuggestion = {
  name?: string;
  name_preferred?: string;
  mapbox_id?: string;
  feature_type?: string;
  address?: string;
  full_address?: string;
  place_formatted?: string;
  poi_category?: string[];
  distance?: number;
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
  featureType?: string;
  distanceMeters?: number;
};

function suggestionLabel(suggestion: MapboxSuggestion) {
  const fullAddress = suggestion.full_address?.trim();
  if (fullAddress) return fullAddress;

  const name = (suggestion.name_preferred || suggestion.name || "").trim();
  const context = suggestion.place_formatted?.trim() ?? "";
  if (name && context) return `${name}, ${context}`;
  return name || suggestion.address?.trim() || context;
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("lt-LT")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function featurePriority(featureType: string | undefined) {
  switch (featureType) {
    case "poi":
      return 0;
    case "address":
      return 1;
    case "street":
      return 2;
    case "place":
    case "locality":
      return 4;
    default:
      return 3;
  }
}

function relevanceScore(suggestion: PlaceSuggestion, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedMain = normalizeSearchText(suggestion.mainText);
  const normalizedLabel = normalizeSearchText(suggestion.label);

  let score = featurePriority(suggestion.featureType) * 10;

  if (normalizedQuery && normalizedMain === normalizedQuery) {
    score -= 18;
  } else if (
    normalizedQuery &&
    (normalizedMain.startsWith(normalizedQuery) ||
      normalizedQuery.startsWith(normalizedMain))
  ) {
    score -= 12;
  } else if (normalizedQuery && normalizedLabel.includes(normalizedQuery)) {
    score -= 7;
  }

  // Proximity should only break close ties; exact text/type relevance matters more.
  if (
    typeof suggestion.distanceMeters === "number" &&
    Number.isFinite(suggestion.distanceMeters)
  ) {
    score += Math.min(4, Math.max(0, suggestion.distanceMeters) / 25_000);
  }

  return score;
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
      .filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0,
      );

    return [
      {
        provider: "mapbox" as const,
        providerPlaceId,
        label,
        mainText,
        secondaryText,
        types,
        featureType: suggestion.feature_type,
        distanceMeters:
          typeof suggestion.distance === "number" &&
          Number.isFinite(suggestion.distance)
            ? suggestion.distance
            : undefined,
      },
    ];
  });
}

async function fetchSuggestions(
  query: string,
  sessionToken: string,
  language: "lt" | "en",
  accessToken: string,
  types: string,
  limit: number,
) {
  const url = new URL(AUTOCOMPLETE_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("session_token", sessionToken);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("language", language);
  url.searchParams.set("country", "LT");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("proximity", KAUNAS_PROXIMITY);
  url.searchParams.set("types", types);

  const data = await fetchMapboxJson<MapboxAutocompleteResponse>(url.toString());
  return mapAutocompleteResponse(data);
}

function mergeAndRankSuggestions(
  primary: PlaceSuggestion[],
  fallback: PlaceSuggestion[],
  query: string,
) {
  const unique = new Map<string, PlaceSuggestion>();

  for (const suggestion of [...primary, ...fallback]) {
    if (!unique.has(suggestion.providerPlaceId)) {
      unique.set(suggestion.providerPlaceId, suggestion);
    }
  }

  return [...unique.values()]
    .map((suggestion, originalIndex) => ({
      suggestion,
      originalIndex,
      score: relevanceScore(suggestion, query),
    }))
    .sort((a, b) => a.score - b.score || a.originalIndex - b.originalIndex)
    .slice(0, MAX_RESULTS)
    .map(({ suggestion }) => {
      // Keep the public API response backwards-compatible with the frontend.
      const { featureType: _featureType, distanceMeters: _distance, ...result } =
        suggestion;
      return result;
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

  const language = normalizeLanguage(getQueryValue(req.query.language));

  try {
    // First pass intentionally excludes cities/localities so hotels, airports,
    // POIs and exact addresses do not get pushed out by similarly named towns.
    const primary = await fetchSuggestions(
      query,
      sessionToken,
      language,
      accessToken,
      "poi,address,street",
      10,
    );

    // Only ask for broader administrative results when the useful pickup/dropoff
    // result set is too small. This keeps city/village names as a fallback.
    const fallback =
      primary.length >= MAX_RESULTS
        ? []
        : await fetchSuggestions(
            query,
            sessionToken,
            language,
            accessToken,
            "place,locality",
            6,
          );

    return res.status(200).json(mergeAndRankSuggestions(primary, fallback, query));
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
