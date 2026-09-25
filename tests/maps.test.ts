import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import {
  consumeRateLimit,
  isCoordinate,
  isValidPlaceId,
  isValidSessionToken,
} from "../api/_google-maps.ts";
import placeDetailsHandler, {
  mapPlaceDetails,
} from "../api/place-details.ts";
import placesHandler, {
  mapAutocompleteResponse,
} from "../api/places.ts";
import routeHandler, { parseRouteResponse } from "../api/route.ts";
import { verifyRouteToken } from "../api/_route-token.ts";
import { verifyVerifiedPlaceToken } from "../api/_place-token.ts";
import { decodeGooglePolyline } from "../src/maps/polyline.ts";

type MapsHandler = typeof placesHandler;
type MapsRequest = Parameters<MapsHandler>[0];
type MapsResponse = Parameters<MapsHandler>[1];

type CapturedResponse = {
  statusCode: number | null;
  body: unknown;
  headers: Record<string, unknown>;
};

type FetchCall = {
  url: string;
  init: RequestInit | undefined;
};

let requestSequence = 0;

function createRequest({
  method,
  query = {},
  body,
}: {
  method: string;
  query?: Record<string, string | string[]>;
  body?: unknown;
}): MapsRequest {
  requestSequence += 1;
  const clientAddress = `2001:db8::${requestSequence.toString(16)}`;

  return {
    method,
    query,
    body,
    headers: { "x-forwarded-for": clientAddress },
    socket: { remoteAddress: clientAddress },
  } as unknown as MapsRequest;
}

function createResponse() {
  const captured: CapturedResponse = {
    statusCode: null,
    body: undefined,
    headers: {},
  };
  const response = {
    setHeader(name: string, value: unknown) {
      captured.headers[name.toLowerCase()] = value;
      return response;
    },
    status(statusCode: number) {
      captured.statusCode = statusCode;
      return response;
    },
    json(body: unknown) {
      captured.body = body;
      return response;
    },
  };

  return {
    captured,
    response: response as unknown as MapsResponse,
  };
}

function setTestEnvironment(
  t: TestContext,
  name: string,
  value: string | undefined,
) {
  const previous = process.env[name];

  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }

  t.after(() => {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  });
}

function mockJsonFetch(
  t: TestContext,
  payload: unknown,
  status = 200,
) {
  const calls: FetchCall[] = [];

  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: input instanceof Request ? input.url : input.toString(),
        init,
      });

      return new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    },
  );

  return calls;
}

test("places handler sends the Google autocomplete contract and maps results", async (t) => {
  setTestEnvironment(t, "GOOGLE_MAPS_SERVER_API_KEY", "server-key");
  const fetchCalls = mockJsonFetch(t, {
    suggestions: [
      {
        placePrediction: {
          placeId: "ChIJKaunasAirport",
          text: { text: "Kaunas Airport" },
          structuredFormat: {
            mainText: { text: "Kaunas Airport" },
            secondaryText: { text: "Kaunas, Lithuania" },
          },
          types: ["airport"],
        },
      },
    ],
  });
  const { captured, response } = createResponse();

  await placesHandler(
    createRequest({
      method: "GET",
      query: {
        q: "  Kaunas Airport  ",
        sessionToken: "autocomplete-session",
        language: "en",
      },
    }),
    response,
  );

  assert.equal(captured.statusCode, 200);
  assert.deepEqual(captured.body, [
    {
      provider: "google",
      providerPlaceId: "ChIJKaunasAirport",
      label: "Kaunas Airport",
      mainText: "Kaunas Airport",
      secondaryText: "Kaunas, Lithuania",
      types: ["airport"],
    },
  ]);
  assert.equal(captured.headers["cache-control"], "no-store");
  assert.equal(fetchCalls.length, 1);

  const call = fetchCalls[0];
  assert.ok(call);
  assert.equal(
    call.url,
    "https://places.googleapis.com/v1/places:autocomplete",
  );
  assert.equal(call.init?.method, "POST");
  const headers = new Headers(call.init?.headers);
  assert.equal(headers.get("x-goog-api-key"), "server-key");
  assert.equal(
    headers.get("x-goog-fieldmask"),
    [
      "suggestions.placePrediction.placeId",
      "suggestions.placePrediction.text.text",
      "suggestions.placePrediction.structuredFormat.mainText.text",
      "suggestions.placePrediction.structuredFormat.secondaryText.text",
      "suggestions.placePrediction.types",
    ].join(","),
  );

  const upstreamBody = JSON.parse(String(call.init?.body));
  assert.deepEqual(upstreamBody, {
    input: "Kaunas Airport",
    sessionToken: "autocomplete-session",
    languageCode: "en",
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
  });
  assert.equal("includedRegionCodes" in upstreamBody, false);
});

test("place details handler passes the session and maps exact coordinates", async (t) => {
  setTestEnvironment(t, "GOOGLE_MAPS_SERVER_API_KEY", "server-key");
  const fetchCalls = mockJsonFetch(t, {
    id: "  ChIJKaunasCenter  ",
    formattedAddress: "  Kaunas City Center  ",
    location: {
      latitude: 54.8985,
      longitude: 23.9036,
    },
  });
  const { captured, response } = createResponse();

  await placeDetailsHandler(
    createRequest({
      method: "GET",
      query: {
        placeId: "ChIJKaunasCenter",
        sessionToken: "details-session",
        language: "en",
      },
    }),
    response,
  );

  assert.equal(captured.statusCode, 200);
  const place = captured.body as Record<string, unknown>;
  assert.deepEqual({ ...place, placeToken: undefined }, {
    provider: "google",
    providerPlaceId: "ChIJKaunasCenter",
    label: "Kaunas City Center",
    latitude: 54.8985,
    longitude: 23.9036,
    placeToken: undefined,
  });
  assert.equal(typeof place.placeToken, "string");
  assert.deepEqual(verifyVerifiedPlaceToken(place.placeToken), {
    provider: "google",
    providerPlaceId: "ChIJKaunasCenter",
    label: "Kaunas City Center",
    latitude: 54.8985,
    longitude: 23.9036,
  });
  assert.equal(fetchCalls.length, 1);

  const call = fetchCalls[0];
  assert.ok(call);
  assert.equal(
    call.url,
    "https://places.googleapis.com/v1/places/ChIJKaunasCenter?languageCode=en&regionCode=LT&sessionToken=details-session",
  );
  assert.equal(call.init?.method, "GET");
  assert.equal(call.init?.body, undefined);
  const headers = new Headers(call.init?.headers);
  assert.equal(headers.get("x-goog-api-key"), "server-key");
  assert.equal(
    headers.get("x-goog-fieldmask"),
    "id,formattedAddress,location",
  );
});

test("place details never signs a different Google place ID", async (t) => {
  setTestEnvironment(t, "GOOGLE_MAPS_SERVER_API_KEY", "server-key");
  mockJsonFetch(t, {
    id: "ChIJUnexpected",
    formattedAddress: "Unrelated place",
    location: { latitude: 54.8985, longitude: 23.9036 },
  });
  const { captured, response } = createResponse();
  await placeDetailsHandler(
    createRequest({
      method: "GET",
      query: { placeId: "ChIJRequested", sessionToken: "details-session" },
    }),
    response,
  );
  assert.equal(captured.statusCode, 502);
  assert.equal((captured.body as Record<string, unknown>).placeToken, undefined);
});

test("route handler sends latLng points and returns the exact parsed route", async (t) => {
  setTestEnvironment(t, "GOOGLE_MAPS_SERVER_API_KEY", "server-key");
  setTestEnvironment(t, "GOOGLE_ROUTES_TRAFFIC_AWARE", undefined);
  const fetchCalls = mockJsonFetch(t, {
    routes: [
      {
        distanceMeters: 12_345.6,
        duration: "61.4s",
        polyline: { encodedPolyline: "  encoded-route  " },
      },
    ],
  });
  const { captured, response } = createResponse();

  await routeHandler(
    createRequest({
      method: "POST",
      body: {
        origin: {
          latitude: 54.8985,
          longitude: 23.9036,
        },
        destination: {
          latitude: 54.9639,
          longitude: 24.0848,
        },
        language: "en",
      },
    }),
    response,
  );

  assert.equal(captured.statusCode, 200);
  assert.ok(
    typeof captured.body === "object" &&
      captured.body !== null &&
      "routeToken" in captured.body &&
      typeof captured.body.routeToken === "string",
  );
  const { routeToken, ...routeBody } = captured.body;
  assert.deepEqual(routeBody, {
    provider: "google",
    distanceMeters: 12_346,
    durationSeconds: 61,
    encodedPolyline: "encoded-route",
    distanceKm: 12.3,
    durationMin: 2,
  });
  assert.equal(verifyRouteToken(routeToken)?.distanceMeters, 12_346);
  assert.equal(fetchCalls.length, 1);

  const call = fetchCalls[0];
  assert.ok(call);
  assert.equal(
    call.url,
    "https://routes.googleapis.com/directions/v2:computeRoutes",
  );
  assert.equal(call.init?.method, "POST");
  const headers = new Headers(call.init?.headers);
  assert.equal(headers.get("x-goog-api-key"), "server-key");
  assert.equal(
    headers.get("x-goog-fieldmask"),
    [
      "routes.distanceMeters",
      "routes.duration",
      "routes.polyline.encodedPolyline",
    ].join(","),
  );
  assert.deepEqual(JSON.parse(String(call.init?.body)), {
    origin: {
      location: {
        latLng: {
          latitude: 54.8985,
          longitude: 23.9036,
        },
      },
    },
    destination: {
      location: {
        latLng: {
          latitude: 54.9639,
          longitude: 24.0848,
        },
      },
    },
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_UNAWARE",
    computeAlternativeRoutes: false,
    languageCode: "en",
    units: "METRIC",
  });
});

test("handlers return 503 without a server key and never call Google", async (t) => {
  setTestEnvironment(t, "GOOGLE_MAPS_SERVER_API_KEY", undefined);
  const fetchCalls = mockJsonFetch(t, { unexpected: true });
  const cases: Array<{
    handler: MapsHandler;
    request: MapsRequest;
  }> = [
    {
      handler: placesHandler,
      request: createRequest({
        method: "GET",
        query: {
          q: "Kaunas",
          sessionToken: "missing-key-places",
        },
      }),
    },
    {
      handler: placeDetailsHandler,
      request: createRequest({
        method: "GET",
        query: {
          placeId: "ChIJMissingKey",
          sessionToken: "missing-key-details",
        },
      }),
    },
    {
      handler: routeHandler,
      request: createRequest({
        method: "POST",
        body: {
          origin: { latitude: 54.8985, longitude: 23.9036 },
          destination: { latitude: 54.9639, longitude: 24.0848 },
        },
      }),
    },
  ];

  for (const testCase of cases) {
    const { captured, response } = createResponse();
    await testCase.handler(testCase.request, response);

    assert.equal(captured.statusCode, 503);
    assert.deepEqual(
      Object.keys(captured.body as Record<string, unknown>),
      ["error"],
    );
  }

  assert.equal(fetchCalls.length, 0);
});

test("handlers surface upstream errors instead of returning fabricated data", async (t) => {
  setTestEnvironment(t, "GOOGLE_MAPS_SERVER_API_KEY", "server-key");
  t.mock.method(console, "error", () => {});
  const fetchCalls = mockJsonFetch(t, { upstream: "failed" }, 500);
  const cases: Array<{
    handler: MapsHandler;
    request: MapsRequest;
  }> = [
    {
      handler: placesHandler,
      request: createRequest({
        method: "GET",
        query: {
          q: "Kaunas",
          sessionToken: "failed-places",
        },
      }),
    },
    {
      handler: placeDetailsHandler,
      request: createRequest({
        method: "GET",
        query: {
          placeId: "ChIJFailedDetails",
          sessionToken: "failed-details",
        },
      }),
    },
    {
      handler: routeHandler,
      request: createRequest({
        method: "POST",
        body: {
          origin: { latitude: 54.8985, longitude: 23.9036 },
          destination: { latitude: 54.9639, longitude: 24.0848 },
        },
      }),
    },
  ];

  for (const testCase of cases) {
    const { captured, response } = createResponse();
    await testCase.handler(testCase.request, response);

    assert.equal(captured.statusCode, 502);
    assert.deepEqual(
      Object.keys(captured.body as Record<string, unknown>),
      ["error"],
    );
  }

  assert.equal(fetchCalls.length, 3);
});

test("route handler reports no route without inventing a fallback", async (t) => {
  setTestEnvironment(t, "GOOGLE_MAPS_SERVER_API_KEY", "server-key");
  const fetchCalls = mockJsonFetch(t, { routes: [] });
  const { captured, response } = createResponse();

  await routeHandler(
    createRequest({
      method: "POST",
      body: {
        origin: { latitude: 54.8985, longitude: 23.9036 },
        destination: { latitude: 54.9639, longitude: 24.0848 },
      },
    }),
    response,
  );

  assert.equal(captured.statusCode, 422);
  assert.deepEqual(
    Object.keys(captured.body as Record<string, unknown>),
    ["error"],
  );
  assert.equal(fetchCalls.length, 1);
});

test("autocomplete mapping normalizes valid Google predictions", () => {
  const suggestions = mapAutocompleteResponse({
    suggestions: [
      {
        placePrediction: {
          placeId: "  ChIJKaunas123  ",
          text: { text: "  Laisvės al. 1, Kaunas  " },
          structuredFormat: {
            mainText: { text: "  Laisvės al. 1  " },
            secondaryText: { text: "  Kaunas, Lithuania  " },
          },
          types: ["street_address", "premise"],
        },
      },
      {
        placePrediction: {
          placeId: "fallback-id",
          text: { text: "Kauno oro uostas" },
          structuredFormat: {
            mainText: { text: "   " },
            secondaryText: { text: "   " },
          },
        },
      },
    ],
  });

  assert.deepEqual(suggestions, [
    {
      provider: "google",
      providerPlaceId: "ChIJKaunas123",
      label: "Laisvės al. 1, Kaunas",
      mainText: "Laisvės al. 1",
      secondaryText: "Kaunas, Lithuania",
      types: ["street_address", "premise"],
    },
    {
      provider: "google",
      providerPlaceId: "fallback-id",
      label: "Kauno oro uostas",
      mainText: "Kauno oro uostas",
      secondaryText: "",
      types: [],
    },
  ]);
});

test("autocomplete mapping drops incomplete predictions and malformed types", () => {
  const suggestions = mapAutocompleteResponse({
    suggestions: [
      { placePrediction: { placeId: "valid-id", text: { text: "Valid" } } },
      { placePrediction: { placeId: "", text: { text: "Missing id" } } },
      { placePrediction: { placeId: "missing-label" } },
      {},
      {
        placePrediction: {
          placeId: "typed-id",
          text: { text: "Typed" },
          types: ["locality", 42, null] as unknown as string[],
        },
      },
    ],
  });

  assert.deepEqual(
    suggestions.map(({ providerPlaceId, types }) => ({ providerPlaceId, types })),
    [
      { providerPlaceId: "valid-id", types: [] },
      { providerPlaceId: "typed-id", types: ["locality"] },
    ],
  );
  assert.deepEqual(mapAutocompleteResponse({}), []);
});

test("place details mapping trims fields and preserves valid boundary coordinates", () => {
  assert.deepEqual(
    mapPlaceDetails({
      id: "  ChIJDetails123  ",
      formattedAddress: "  Rotušės a. 15, Kaunas  ",
      location: { latitude: -90, longitude: 180 },
    }),
    {
      provider: "google",
      providerPlaceId: "ChIJDetails123",
      label: "Rotušės a. 15, Kaunas",
      latitude: -90,
      longitude: 180,
    },
  );
});

test("place details mapping rejects incomplete or invalid locations", () => {
  const invalidDetails = [
    {},
    {
      id: "valid-id",
      formattedAddress: "   ",
      location: { latitude: 54.9, longitude: 23.9 },
    },
    {
      id: "valid-id",
      formattedAddress: "Kaunas",
      location: { latitude: 90.00001, longitude: 23.9 },
    },
    {
      id: "valid-id",
      formattedAddress: "Kaunas",
      location: { latitude: 54.9, longitude: Number.NaN },
    },
  ];

  for (const details of invalidDetails) {
    assert.equal(mapPlaceDetails(details), null);
  }
});

test("route response parsing derives rounded distance and duration summaries", () => {
  assert.deepEqual(
    parseRouteResponse({
      routes: [
        {
          distanceMeters: 12_345.6,
          duration: "61.4s",
          polyline: { encodedPolyline: "  encoded-route  " },
        },
      ],
    }),
    {
      provider: "google",
      distanceMeters: 12_346,
      durationSeconds: 61,
      encodedPolyline: "encoded-route",
      distanceKm: 12.3,
      durationMin: 2,
    },
  );

  assert.equal(
    parseRouteResponse({
      routes: [
        {
          distanceMeters: 1,
          duration: "0.2s",
          polyline: { encodedPolyline: "route" },
        },
      ],
    })?.durationSeconds,
    1,
  );
});

test("route response parsing rejects missing and malformed route data", () => {
  const invalidResponses = [
    {},
    { routes: [] },
    {
      routes: [
        {
          distanceMeters: 0,
          duration: "60s",
          polyline: { encodedPolyline: "route" },
        },
      ],
    },
    {
      routes: [
        {
          distanceMeters: 1_000,
          duration: "1m",
          polyline: { encodedPolyline: "route" },
        },
      ],
    },
    {
      routes: [
        {
          distanceMeters: 1_000,
          duration: "60s",
          polyline: { encodedPolyline: "   " },
        },
      ],
    },
  ];

  for (const response of invalidResponses) {
    assert.equal(parseRouteResponse(response), null);
  }
});

test("coordinate validation accepts inclusive numeric bounds only", () => {
  assert.equal(isCoordinate(-90, -90, 90), true);
  assert.equal(isCoordinate(90, -90, 90), true);
  assert.equal(isCoordinate(0, -180, 180), true);

  for (const value of [-90.00001, 90.00001, Number.NaN, Infinity, "54.9", null]) {
    assert.equal(isCoordinate(value, -90, 90), false);
  }
});

test("Google proxy rate limit blocks excess requests and resets", () => {
  const namespace = `test-${Date.now()}-${Math.random()}`;
  const headers = { "x-forwarded-for": "203.0.113.44" };

  assert.deepEqual(
    consumeRateLimit(headers, undefined, namespace, 2, 1_000),
    { allowed: true, limit: 2, remaining: 1, resetAt: 61_000 },
  );
  assert.equal(
    consumeRateLimit(headers, undefined, namespace, 2, 1_001).allowed,
    true,
  );
  assert.equal(
    consumeRateLimit(headers, undefined, namespace, 2, 1_002).allowed,
    false,
  );
  assert.deepEqual(
    consumeRateLimit(headers, undefined, namespace, 2, 61_000),
    { allowed: true, limit: 2, remaining: 1, resetAt: 121_000 },
  );
});

test("session token validation enforces its alphabet and length boundaries", () => {
  assert.equal(isValidSessionToken("a"), true);
  assert.equal(isValidSessionToken(`A0_-${"z".repeat(32)}`), true);

  assert.equal(isValidSessionToken(""), false);
  assert.equal(isValidSessionToken("a".repeat(37)), false);
  assert.equal(isValidSessionToken("valid-token-with-space "), false);
  assert.equal(isValidSessionToken("valid.token.12345"), false);
});

test("place ID validation enforces its alphabet and length boundaries", () => {
  assert.equal(isValidPlaceId("abc_5"), true);
  assert.equal(isValidPlaceId(`ChIJ-${"x".repeat(250)}`), true);

  assert.equal(isValidPlaceId("abcd"), false);
  assert.equal(isValidPlaceId("x".repeat(256)), false);
  assert.equal(isValidPlaceId("place id"), false);
  assert.equal(isValidPlaceId("place:id"), false);
});

test("Google polyline decoder reconstructs canonical route coordinates", () => {
  const points = decodeGooglePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");

  assert.deepEqual(points, [
    { lat: 38.5, lng: -120.2 },
    { lat: 40.7, lng: -120.95 },
    { lat: 43.252, lng: -126.453 },
  ]);
});

test("Google polyline decoder rejects truncated and underspecified geometry", () => {
  assert.throws(
    () => decodeGooglePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`"),
    /Nebaigta maršruto geometrija/,
  );
  assert.throws(
    () => decodeGooglePolyline("_p~iF~ps|U"),
    /Maršrute nepakanka taškų/,
  );
  assert.throws(
    () => decodeGooglePolyline(" "),
    /Netinkama maršruto geometrija/,
  );
});
