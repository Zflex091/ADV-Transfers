import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import {
  consumeRateLimit,
  isCoordinate,
  isValidGeoapifyId,
  isValidSessionToken,
} from "../api/_geoapify.ts";
import placeDetailsHandler, { mapPlaceDetails } from "../api/place-details.ts";
import placesHandler, {
  mapAutocompleteResponse,
  mapPlacesResponse,
  mergeAndRankSuggestions,
} from "../api/places.ts";
import routeHandler, { parseRouteResponse } from "../api/route.ts";
import { createRouteToken, verifyRouteToken } from "../api/_route-token.ts";
import { createVerifiedPlaceToken, verifyVerifiedPlaceToken } from "../api/_place-token.ts";
import { prepareCheckoutRequest } from "../api/_checkout-data.ts";
import { createEmptyPreferences } from "../src/domain/booking.ts";

type Handler = typeof placesHandler;
type MapsRequest = Parameters<Handler>[0];
type MapsResponse = Parameters<Handler>[1];

let requestSequence = 0;

function request(method: string, query: Record<string, string> = {}, body?: unknown): MapsRequest {
  const ip = `2001:db8::${(++requestSequence).toString(16)}`;
  return {
    method,
    query,
    body,
    headers: { "x-forwarded-for": ip },
    socket: { remoteAddress: ip },
  } as unknown as MapsRequest;
}

function response() {
  const captured: { status: number | null; body: any; headers: Record<string, unknown> } = {
    status: null,
    body: null,
    headers: {},
  };
  const res = {
    setHeader(name: string, value: unknown) { captured.headers[name.toLowerCase()] = value; return res; },
    status(value: number) { captured.status = value; return res; },
    json(value: unknown) { captured.body = value; return res; },
  } as unknown as MapsResponse;
  return { res, captured };
}

function env(t: TestContext, name: string, value: string | undefined) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

function mockFetch(t: TestContext, responder: (url: URL) => unknown) {
  const urls: URL[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    urls.push(url);
    return new Response(JSON.stringify(responder(url)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  return urls;
}

test("Geoapify autocomplete maps addresses and rejects incomplete suggestions", () => {
  const result = mapAutocompleteResponse({ results: [
    {
      place_id: "address-1",
      lat: 54.896,
      lon: 23.887,
      formatted: "Rotušės a. 15, Kaunas, Lithuania",
      address_line1: "Rotušės a. 15",
      address_line2: "Kaunas, Lithuania",
      result_type: "building",
    },
    { formatted: "Missing ID" },
    { place_id: "missing-coordinates", formatted: "Missing coordinates" },
  ] });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    provider: "geoapify",
    providerPlaceId: "address-1",
    label: "Rotušės a. 15, Kaunas, Lithuania",
    latitude: 54.896,
    longitude: 23.887,
    mainText: "Rotušės a. 15",
    secondaryText: "Kaunas, Lithuania",
    types: ["building"],
    featureType: "building",
    distanceMeters: undefined,
  });
});

test("Geoapify Places maps named hotels ahead of a same-name locality", () => {
  const hotel = mapPlacesResponse({ features: [{ geometry: {
    type: "Point",
    coordinates: [23.88, 54.89],
  }, properties: {
    place_id: "hotel-1",
    name: "Daugirdas",
    formatted: "T. Daugirdo g. 4, Kaunas",
    categories: ["accommodation.hotel"],
    distance: 900,
  } }] });
  const locality = mapAutocompleteResponse({ results: [{
    place_id: "city-1",
    lat: 55.1,
    lon: 23.9,
    formatted: "Daugirdai, Lithuania",
    address_line1: "Daugirdai",
    result_type: "city",
  }] });
  const ranked = mergeAndRankSuggestions([locality, hotel], "Daugirdas hotel");
  assert.equal(ranked[0]?.providerPlaceId, "hotel-1");
  assert.equal(ranked[0]?.label, "Daugirdas, T. Daugirdo g. 4, Kaunas");
});

test("places handler calls Autocomplete and hotel Places and signs the suggestions", async (t) => {
  env(t, "GEOAPIFY_API_KEY", "server-key");
  env(t, "ROUTE_TOKEN_SECRET", "test-signing-key");
  const urls = mockFetch(t, (url) => url.pathname.includes("/geocode/autocomplete")
    ? { results: [{
        place_id: "address-1",
        lat: 54.895,
        lon: 23.883,
        formatted: "T. Daugirdo g. 4, Kaunas",
        address_line1: "T. Daugirdo g. 4",
        result_type: "building",
      }] }
    : { features: [{ properties: {
        place_id: "hotel-1",
        lat: 54.8951,
        lon: 23.8831,
        name: "Daugirdas",
        formatted: "T. Daugirdo g. 4, Kaunas",
        categories: ["accommodation.hotel"],
      } }] });
  const { res, captured } = response();
  await placesHandler(request("GET", { q: "Daugirdas hotel", sessionToken: "safe-session", language: "lt" }), res);
  assert.equal(captured.status, 200);
  assert.equal(captured.body[0].providerPlaceId, "hotel-1");
  assert.equal(captured.body[0].provider, "geoapify");
  assert.equal(verifyVerifiedPlaceToken(captured.body[0].selectionToken)?.providerPlaceId, "hotel-1");
  assert.equal(verifyVerifiedPlaceToken(captured.body[1].selectionToken)?.providerPlaceId, "address-1");
  assert.equal(urls.length, 2);
  const autocompleteUrl = urls.find((url) => url.pathname.includes("/geocode/autocomplete"));
  const placesUrl = urls.find((url) => url.pathname.includes("/v2/places"));
  assert.equal(autocompleteUrl?.searchParams.get("text"), "Daugirdas hotel");
  assert.equal(autocompleteUrl?.searchParams.get("format"), "json");
  assert.equal(placesUrl?.searchParams.get("categories"), "accommodation.hotel,accommodation.guest_house");
  assert.equal(placesUrl?.searchParams.get("name"), "daugirdas");
  assert.equal(placesUrl?.searchParams.get("apiKey"), "server-key");
});

test("place details maps Geoapify details coordinates and rejects a different ID", () => {
  const data = { features: [{
    properties: {
      feature_type: "details",
      place_id: "selected-1",
      name: "Daugirdas",
      formatted: "T. Daugirdo g. 4, Kaunas",
      lat: 54.895,
      lon: 23.883,
    },
  }] };
  assert.deepEqual(mapPlaceDetails(data, "selected-1"), {
    provider: "geoapify",
    providerPlaceId: "selected-1",
    label: "Daugirdas, T. Daugirdo g. 4, Kaunas",
    latitude: 54.895,
    longitude: 23.883,
  });
  assert.equal(mapPlaceDetails(data, "forged-2"), null);
});

test("place details handler resolves the ID at Geoapify and signs the result", async (t) => {
  env(t, "GEOAPIFY_API_KEY", "server-key");
  env(t, "ROUTE_TOKEN_SECRET", "test-signing-key");
  const urls = mockFetch(t, () => ({ features: [{ properties: {
    feature_type: "details",
    place_id: "selected-1",
    formatted: "Rotušės a. 15, Kaunas",
    lat: 54.896,
    lon: 23.887,
  } }] }));
  const { res, captured } = response();
  await placeDetailsHandler(request("GET", { placeId: "selected-1", sessionToken: "safe-session" }), res);
  assert.equal(captured.status, 200);
  assert.equal(urls[0].pathname, "/v2/place-details");
  assert.equal(urls[0].searchParams.get("id"), "selected-1");
  assert.equal(urls[0].searchParams.get("features"), "details");
  assert.equal(captured.body.provider, "geoapify");
  assert.equal(verifyVerifiedPlaceToken(captured.body.placeToken)?.providerPlaceId, "selected-1");
});

test("airport selection uses signed Autocomplete coordinates without fetching Place Details", async (t) => {
  env(t, "GEOAPIFY_API_KEY", "server-key");
  env(t, "ROUTE_TOKEN_SECRET", "test-signing-key");
  const urls = mockFetch(t, (url) => url.pathname.includes("/geocode/autocomplete")
    ? { results: [{
        place_id: "airport-1",
        name: "Kauno oro uostas",
        formatted: "Kauno oro uostas, Lithuania",
        result_type: "amenity",
        lat: 54.9639,
        lon: 24.0848,
      }] }
    : { features: [] });

  const searched = response();
  await placesHandler(request("GET", {
    q: "Kauno oro uostas",
    sessionToken: "safe-session",
  }), searched.res);
  assert.equal(searched.captured.status, 200);
  assert.equal(searched.captured.body.length, 1);
  const suggestion = searched.captured.body[0];
  assert.equal(verifyVerifiedPlaceToken(suggestion.selectionToken)?.latitude, 54.9639);

  const selected = response();
  await placeDetailsHandler(request("POST", {}, {
    placeId: suggestion.providerPlaceId,
    sessionToken: "safe-session",
    selectionToken: suggestion.selectionToken,
  }), selected.res);
  assert.equal(selected.captured.status, 200);
  assert.deepEqual(selected.captured.body, {
    provider: "geoapify",
    providerPlaceId: "airport-1",
    label: "Kauno oro uostas, Lithuania",
    latitude: 54.9639,
    longitude: 24.0848,
    placeToken: selected.captured.body.placeToken,
  });
  assert.equal(verifyVerifiedPlaceToken(selected.captured.body.placeToken)?.providerPlaceId, "airport-1");
  assert.equal(urls.some((url) => url.pathname.includes("/place-details")), false);

  const forged = response();
  await placeDetailsHandler(request("POST", {}, {
    placeId: suggestion.providerPlaceId,
    sessionToken: "safe-session",
    selectionToken: `${suggestion.selectionToken}x`,
  }), forged.res);
  assert.equal(forged.captured.status, 400);
});

test("routing parses Geoapify polyline6, meters and seconds", () => {
  const route = parseRouteResponse({ features: [{ properties: {
    distance: 12345.6,
    time: 61.2,
    polyline6: "encoded-route",
  } }] });
  assert.deepEqual(route, {
    provider: "geoapify",
    distanceMeters: 12346,
    durationSeconds: 61,
    encodedPolyline: "encoded-route",
    distanceKm: 12.3,
    durationMin: 2,
  });
  assert.equal(parseRouteResponse({ features: [{ properties: { distance: 1000, time: 60 } }] }), null);
});

test("route handler sends lat,lon waypoints and signs the measured distance", async (t) => {
  env(t, "GEOAPIFY_API_KEY", "server-key");
  env(t, "ROUTE_TOKEN_SECRET", "test-signing-key");
  const urls = mockFetch(t, () => ({ features: [{ properties: {
    distance: 15340,
    time: 1420,
    polyline6: "encoded-route",
  } }] }));
  const { res, captured } = response();
  await routeHandler(request("POST", {}, {
    origin: { latitude: 54.9639, longitude: 24.0848 },
    destination: { latitude: 54.8985, longitude: 23.9036 },
  }), res);
  assert.equal(captured.status, 200);
  assert.equal(urls[0].pathname, "/v1/routing");
  assert.equal(urls[0].searchParams.get("waypoints"), "54.9639,24.0848|54.8985,23.9036");
  assert.equal(urls[0].searchParams.get("details"), "polyline6");
  assert.equal(urls[0].searchParams.get("mode"), "drive");
  assert.equal(captured.body.provider, "geoapify");
  assert.equal(captured.body.distanceMeters, 15340);
  assert.equal(verifyRouteToken(captured.body.routeToken)?.distanceMeters, 15340);
});

test("missing Geoapify key fails without contacting an upstream service", async (t) => {
  env(t, "GEOAPIFY_API_KEY", undefined);
  const urls = mockFetch(t, () => { throw new Error("Must not fetch"); });
  const { res, captured } = response();
  await placesHandler(request("GET", { q: "Kaunas", sessionToken: "safe-session" }), res);
  assert.equal(captured.status, 503);
  assert.equal(urls.length, 0);
});

test("Geoapify selections pass the existing signed checkout path", (t) => {
  env(t, "ROUTE_TOKEN_SECRET", "test-signing-key");
  const origin = { latitude: 54.9639, longitude: 24.0848 };
  const destination = { latitude: 54.8985, longitude: 23.9036 };
  const pickup = { provider: "geoapify" as const, providerPlaceId: "airport-1", label: "Kauno oro uostas", ...origin };
  const arrival = { provider: "geoapify" as const, providerPlaceId: "centre-1", label: "Kauno centras", ...destination };
  const routeToken = createRouteToken({ origin, destination, distanceMeters: 10_000, durationSeconds: 900 });
  assert.ok(routeToken);
  const checkout = prepareCheckoutRequest({
    routeToken,
    routeProvider: "geoapify",
    pickup: { ...pickup, placeToken: createVerifiedPlaceToken(pickup) },
    destination: { ...arrival, placeToken: createVerifiedPlaceToken(arrival) },
    date: "2030-09-23",
    time: "14:00",
    passengers: 2,
    luggage: 2,
    vehicleId: "economy",
    firstName: "Aistė",
    lastName: "Jonaitė",
    phone: "+37061234567",
    email: "aiste@example.com",
    preferences: createEmptyPreferences(),
    paymentMethod: "driver",
    clientRequestId: "75150b6e-f8f6-4425-8d5e-f950f0005ae1",
  });
  assert.equal(checkout.draft.pickup.provider, "geoapify");
  assert.equal(checkout.draft.destination.provider, "geoapify");
  assert.equal(checkout.draft.route.provider, "geoapify");
});

test("shared validation and rate limiting preserve their existing boundaries", () => {
  assert.equal(isCoordinate(-90, -90, 90), true);
  assert.equal(isCoordinate(Number.NaN, -90, 90), false);
  assert.equal(isValidGeoapifyId("geoapify-1"), true);
  assert.equal(isValidGeoapifyId("bad id"), false);
  assert.equal(isValidSessionToken("session_1"), true);
  assert.equal(isValidSessionToken("session with spaces"), false);
  const headers = { "x-forwarded-for": "test-rate-limit" };
  assert.equal(consumeRateLimit(headers, undefined, "test", 1, 1).allowed, true);
  assert.equal(consumeRateLimit(headers, undefined, "test", 1, 2).allowed, false);
  assert.equal(consumeRateLimit(headers, undefined, "test", 1, 60_002).allowed, true);
});
