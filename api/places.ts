import type { VercelRequest, VercelResponse } from "@vercel/node";

import {
  GeoapifyUpstreamError,
  consumeRateLimit,
  fetchGeoapifyJson,
  getGeoapifyServerKey,
  getQueryValue,
  isValidGeoapifyId,
  isValidSessionToken,
  normalizeLanguage,
} from "./_geoapify.js";

const AUTOCOMPLETE_URL = "https://api.geoapify.com/v1/geocode/autocomplete";
const PLACES_URL = "https://api.geoapify.com/v2/places";
const KAUNAS_PROXIMITY = "23.9036,54.8985";
const MAX_RESULTS = 6;

type GeoapifyAutocompleteResult = {
  place_id?: string;
  name?: string;
  formatted?: string;
  address_line1?: string;
  address_line2?: string;
  result_type?: string;
  category?: string;
  distance?: number;
};

type GeoapifyAutocompleteResponse = {
  results?: GeoapifyAutocompleteResult[];
};

type GeoapifyPlacesFeature = {
  properties?: {
    place_id?: string;
    name?: string;
    formatted?: string;
    address_line1?: string;
    address_line2?: string;
    categories?: string[];
    distance?: number;
  };
};

type GeoapifyPlacesResponse = {
  features?: GeoapifyPlacesFeature[];
};

export type PlaceSuggestion = {
  provider: "geoapify";
  providerPlaceId: string;
  label: string;
  mainText: string;
  secondaryText: string;
  types: string[];
  featureType?: string;
  distanceMeters?: number;
};

const GENERIC_SEARCH_WORDS = new Set([
  "hotel", "hotelis", "viesbutis", "viesbuti", "viesbucio", "restaurant",
  "restoranas", "restorane", "cafe", "kavine", "museum", "muziejus",
]);

function normalizeSearchText(value: string) {
  return value.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("lt-LT")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function meaningfulQuery(query: string) {
  const words = normalizeSearchText(query).split(" ").filter(Boolean);
  const meaningful = words.filter((word) => !GENERIC_SEARCH_WORDS.has(word));
  return meaningful.join(" ") || words.join(" ");
}

function lodgingIntent(query: string) {
  return /\b(hotel|hotelis|viesbutis|viesbuti|viesbucio)\b/.test(normalizeSearchText(query));
}

function restaurantIntent(query: string) {
  return /\b(restaurant|restoranas|restorane|cafe|kavine)\b/.test(normalizeSearchText(query));
}

function poiCategories(query: string) {
  if (lodgingIntent(query)) return "accommodation.hotel,accommodation.guest_house";
  if (restaurantIntent(query)) return "catering.restaurant,catering.cafe";
  return "accommodation.hotel,catering.restaurant,tourism.attraction,entertainment.museum";
}

function labelWithName(name: string, formatted: string) {
  if (!name) return formatted;
  if (!formatted || normalizeSearchText(formatted).includes(normalizeSearchText(name))) {
    return formatted || name;
  }
  return `${name}, ${formatted}`;
}

function toAutocompleteSuggestion(result: GeoapifyAutocompleteResult): PlaceSuggestion | null {
  const providerPlaceId = result.place_id?.trim() ?? "";
  const name = result.name?.trim() ?? "";
  const formatted = result.formatted?.trim() ?? "";
  const mainText = name || result.address_line1?.trim() || formatted;
  const label = labelWithName(name, formatted || mainText);
  if (!isValidGeoapifyId(providerPlaceId) || !label || !mainText) return null;

  const secondaryText = result.address_line2?.trim() ||
    (formatted && formatted !== mainText ? formatted : "");
  const featureType = result.result_type === "amenity" ? "poi" : result.result_type;
  return {
    provider: "geoapify",
    providerPlaceId,
    label,
    mainText,
    secondaryText,
    types: [result.result_type, result.category].filter((value): value is string => !!value),
    featureType,
    distanceMeters: Number.isFinite(result.distance) ? result.distance : undefined,
  };
}

export function mapAutocompleteResponse(data: GeoapifyAutocompleteResponse): PlaceSuggestion[] {
  return (data.results ?? []).flatMap((result) => {
    const mapped = toAutocompleteSuggestion(result);
    return mapped ? [mapped] : [];
  });
}

export function mapPlacesResponse(data: GeoapifyPlacesResponse): PlaceSuggestion[] {
  return (data.features ?? []).flatMap((feature) => {
    const properties = feature.properties;
    if (!properties) return [];
    const providerPlaceId = properties.place_id?.trim() ?? "";
    const name = properties.name?.trim() || properties.address_line1?.trim() || "";
    const formatted = properties.formatted?.trim() ?? "";
    const label = labelWithName(name, formatted);
    if (!isValidGeoapifyId(providerPlaceId) || !name || !label) return [];
    return [{
      provider: "geoapify" as const,
      providerPlaceId,
      label,
      mainText: name,
      secondaryText: properties.address_line2?.trim() || formatted,
      types: properties.categories ?? [],
      featureType: "poi",
      distanceMeters: Number.isFinite(properties.distance) ? properties.distance : undefined,
    }];
  });
}

function featurePriority(featureType: string | undefined) {
  switch (featureType) {
    case "poi": return 0;
    case "building": return 1;
    case "street": return 2;
    case "city":
    case "suburb":
    case "district":
    case "locality": return 5;
    default: return 3;
  }
}

function relevanceScore(suggestion: PlaceSuggestion, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  const meaningful = meaningfulQuery(query);
  const normalizedMain = normalizeSearchText(suggestion.mainText);
  const normalizedLabel = normalizeSearchText(suggestion.label);
  let score = featurePriority(suggestion.featureType) * 12;

  if (meaningful && normalizedMain === meaningful) score -= 36;
  else if (meaningful && (normalizedMain.includes(meaningful) || normalizedLabel.includes(meaningful))) score -= 28;

  if (normalizedQuery && normalizedMain === normalizedQuery) score -= 16;
  else if (normalizedQuery && normalizedLabel.includes(normalizedQuery)) score -= 8;

  if ((lodgingIntent(query) || restaurantIntent(query)) && suggestion.featureType === "poi") score -= 18;
  if (typeof suggestion.distanceMeters === "number") {
    score += Math.min(5, Math.max(0, suggestion.distanceMeters) / 20_000);
  }
  return score;
}

export function mergeAndRankSuggestions(groups: PlaceSuggestion[][], query: string) {
  const unique = new Map<string, PlaceSuggestion>();
  for (const suggestion of groups.flat()) {
    if (!unique.has(suggestion.providerPlaceId)) unique.set(suggestion.providerPlaceId, suggestion);
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
      const { featureType: _featureType, distanceMeters: _distance, ...result } = suggestion;
      return result;
    });
}

async function fetchAutocomplete(query: string, language: "lt" | "en", apiKey: string) {
  const url = new URL(AUTOCOMPLETE_URL);
  url.searchParams.set("text", query);
  url.searchParams.set("lang", language);
  url.searchParams.set("limit", "10");
  url.searchParams.set("format", "json");
  url.searchParams.set("bias", `proximity:${KAUNAS_PROXIMITY}`);
  url.searchParams.set("apiKey", apiKey);
  return mapAutocompleteResponse(await fetchGeoapifyJson<GeoapifyAutocompleteResponse>(url.toString()));
}

async function fetchPlaces(query: string, language: "lt" | "en", apiKey: string) {
  const url = new URL(PLACES_URL);
  url.searchParams.set("categories", poiCategories(query));
  url.searchParams.set("bias", `proximity:${KAUNAS_PROXIMITY}`);
  url.searchParams.set("limit", "12");
  url.searchParams.set("lang", language);
  url.searchParams.set("name", meaningfulQuery(query));
  url.searchParams.set("apiKey", apiKey);
  return mapPlacesResponse(await fetchGeoapifyJson<GeoapifyPlacesResponse>(url.toString(), {}, 3_000));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Leidžiamos tik GET užklausos." });
  }

  const query = getQueryValue(req.query.q).trim();
  if (query.length < 2) return res.status(200).json([]);
  if (query.length > 160) return res.status(400).json({ error: "Adreso paieškos tekstas per ilgas." });

  if (!isValidSessionToken(getQueryValue(req.query.sessionToken).trim())) {
    return res.status(400).json({ error: "Nepavyko pradėti saugios adresų paieškos sesijos." });
  }

  const rateLimit = consumeRateLimit(req.headers, req.socket?.remoteAddress, "places-autocomplete", 90);
  res.setHeader("RateLimit-Limit", String(rateLimit.limit));
  res.setHeader("RateLimit-Remaining", String(rateLimit.remaining));
  res.setHeader("RateLimit-Reset", String(Math.ceil(rateLimit.resetAt / 1000)));
  if (!rateLimit.allowed) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000))));
    return res.status(429).json({ error: "Per daug adresų paieškų. Palaukite minutę ir bandykite dar kartą." });
  }

  const apiKey = getGeoapifyServerKey();
  if (!apiKey) {
    return res.status(503).json({ error: "Adresų paieška laikinai nesukonfigūruota. Susisiekite su mumis." });
  }

  const language = normalizeLanguage(getQueryValue(req.query.language));
  try {
    // Geoapify Autocomplete resolves addresses; Places supplements named hotels and POIs.
    // A failing optional POI query must not block an otherwise valid address search.
    const placesPromise = query.length >= 3 && !/\d/.test(query)
      ? fetchPlaces(query, language, apiKey).catch((error): PlaceSuggestion[] => {
          console.warn("Geoapify Places paieška nepasiekiama", error instanceof GeoapifyUpstreamError ? error.status : "unknown");
          return [];
        })
      : Promise.resolve([] as PlaceSuggestion[]);
    const [autocomplete, places] = await Promise.all([
      fetchAutocomplete(query, language, apiKey),
      placesPromise,
    ]);
    return res.status(200).json(mergeAndRankSuggestions([autocomplete, places], query));
  } catch (error) {
    const status = error instanceof GeoapifyUpstreamError && error.status === 504 ? 504 : 502;
    console.error("Geoapify adresų paieškos klaida", {
      status: error instanceof GeoapifyUpstreamError ? error.status : "unknown",
      detail: error instanceof GeoapifyUpstreamError ? error.detail.slice(0, 500) : "",
    });
    return res.status(status).json({
      error: status === 504
        ? "Adresų paieška užtruko per ilgai. Bandykite dar kartą."
        : "Adresų paieška šiuo metu nepasiekiama. Bandykite dar kartą.",
    });
  }
}
