import assert from "node:assert/strict";
import test from "node:test";

import { getVehicleQuotes, getVerifiedFare, QuoteRequestError } from "../api/_quote.ts";
import { createEmptyPreferences } from "../src/domain/booking.ts";
import {
  PLACE_TOKEN_TTL_MS,
  createVerifiedPlaceToken,
  verifyVerifiedPlaceToken,
} from "../api/_place-token.ts";
import {
  ROUTE_TOKEN_TTL_MS,
  createRouteToken,
  verifyRouteToken,
} from "../api/_route-token.ts";

const previousSecret = process.env.ROUTE_TOKEN_SECRET;
process.env.ROUTE_TOKEN_SECRET = "stage-four-unit-test-signing-secret";

const origin = { latitude: 54.9639, longitude: 24.0848 };
const destination = { latitude: 54.8968, longitude: 23.8854 };
const fixedNow = Date.parse("2026-09-23T12:00:00Z");

function routeToken(distanceMeters = 10_000, nowMs = Date.now()) {
  const token = createRouteToken(
    {
      origin,
      destination,
      distanceMeters,
      durationSeconds: 900,
    },
    nowMs,
  );
  assert.ok(token);
  return token;
}

function requestInput(overrides: Record<string, unknown> = {}) {
  const token = routeToken(10_000, fixedNow);
  const pickup = {
    provider: "google" as const,
    providerPlaceId: "place-origin",
    label: "Kauno oro uostas",
    ...origin,
  };
  const arrival = {
    provider: "google" as const,
    providerPlaceId: "place-destination",
    label: "Rotušės aikštė",
    ...destination,
  };
  return {
    routeToken: token,
    vehicleId: "economy",
    passengers: 4,
    luggage: 4,
    pickup: { ...pickup, placeToken: createVerifiedPlaceToken(pickup, fixedNow) },
    destination: { ...arrival, placeToken: createVerifiedPlaceToken(arrival, fixedNow) },
    price: 25,
    date: "2026-09-23",
    time: "15:30",
    ...overrides,
  };
}

test("signed place token binds provider ID, label and coordinates and expires", () => {
  const place = {
    provider: "google" as const,
    providerPlaceId: "place-origin",
    label: "Kauno oro uostas",
    ...origin,
  };
  const token = createVerifiedPlaceToken(place, fixedNow);
  assert.ok(token);
  assert.deepEqual(verifyVerifiedPlaceToken(token, fixedNow + 1_000), place);
  assert.equal(verifyVerifiedPlaceToken(token, fixedNow + PLACE_TOKEN_TTL_MS + 1), null);
  const [payload, signature] = token.split(".");
  const modified = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  modified.label = "Vilniaus oro uostas";
  const forged = Buffer.from(JSON.stringify(modified), "utf8").toString("base64url");
  assert.equal(verifyVerifiedPlaceToken(forged + "." + signature, fixedNow), null);
});

test("signed token preserves route facts and expires", () => {
  const token = routeToken(10_000, fixedNow);
  const verified = verifyRouteToken(token, fixedNow + 1_000);
  assert.equal(verified?.distanceMeters, 10_000);
  assert.deepEqual(verified?.origin, origin);
  assert.equal(
    verifyRouteToken(token, fixedNow + ROUTE_TOKEN_TTL_MS + 1),
    null,
  );
});

test("modified token cannot lower the signed distance", () => {
  const token = routeToken();
  const [payload, signature] = token.split(".");
  const altered = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  altered.distanceMeters = 1;
  const forged = Buffer.from(JSON.stringify(altered), "utf8").toString("base64url");
  assert.equal(verifyRouteToken(forged + "." + signature), null);
});

test("server quotes both vehicles using the signed 10 km route", () => {
  const result = getVehicleQuotes({
    routeToken: routeToken(),
    passengers: 4,
    luggage: 4,
  });
  assert.equal(result.route.distanceMeters, 10_000);
  assert.equal(result.vehicles.length, 2);
  assert.equal(result.vehicles[0].pricing?.totalCents, 2_500);
  assert.equal(result.vehicles[1].pricing?.totalCents, 2_800);
});

test("server quotes reject unconfirmed luggage combinations", () => {
  const token = routeToken();
  const fourWithSeven = getVehicleQuotes({
    routeToken: token,
    passengers: 4,
    luggage: 7,
  });
  assert.equal(fourWithSeven.vehicles[0].capacity.available, false);
  assert.equal(fourWithSeven.vehicles[1].capacity.available, true);

  const fiveWithFive = getVehicleQuotes({
    routeToken: token,
    passengers: 5,
    luggage: 5,
  });
  assert.ok(fiveWithFive.vehicles.every((option) => !option.capacity.available));
  assert.ok(fiveWithFive.vehicles.every((option) => option.pricing === null));
});

test("server capacity covers the confirmed minivan combinations", () => {
  const token = routeToken();
  const sixWithSeven = getVehicleQuotes({
    routeToken: token,
    passengers: 6,
    luggage: 7,
  });
  assert.ok(sixWithSeven.vehicles.every((option) => !option.capacity.available));
  assert.ok(sixWithSeven.vehicles.every((option) => option.pricing === null));

  const sixWithFour = getVehicleQuotes({
    routeToken: token,
    passengers: 6,
    luggage: 4,
  });
  assert.equal(sixWithFour.vehicles[0].capacity.available, false);
  assert.equal(sixWithFour.vehicles[1].capacity.available, true);
  assert.equal(sixWithFour.vehicles[1].pricing?.totalCents, 2_800);

  const fourWithEight = getVehicleQuotes({
    routeToken: token,
    passengers: 4,
    luggage: 8,
  });
  assert.equal(fourWithEight.vehicles[0].capacity.available, false);
  assert.equal(fourWithEight.vehicles[1].capacity.available, true);
  assert.equal(fourWithEight.vehicles[1].pricing?.totalCents, 2_800);
});

test("server applies the 25 euro minimum at fare boundaries", () => {
  const belowMinimum = getVehicleQuotes({
    routeToken: routeToken(8_000),
    passengers: 2,
    luggage: 2,
  });
  assert.equal(belowMinimum.vehicles[0].pricing?.subtotalCents, 2_060);
  assert.equal(belowMinimum.vehicles[0].pricing?.minimumAdjustmentCents, 440);
  assert.equal(belowMinimum.vehicles[0].pricing?.totalCents, 2_500);
  assert.equal(belowMinimum.vehicles[1].pricing?.subtotalCents, 2_300);
  assert.equal(belowMinimum.vehicles[1].pricing?.minimumAdjustmentCents, 200);
  assert.equal(belowMinimum.vehicles[1].pricing?.totalCents, 2_500);

  const atMinivanMinimum = getVehicleQuotes({
    routeToken: routeToken(8_800),
    passengers: 2,
    luggage: 2,
  });
  assert.equal(atMinivanMinimum.vehicles[1].pricing?.minimumAdjustmentCents, 0);
  assert.equal(atMinivanMinimum.vehicles[1].pricing?.totalCents, 2_500);

  const tenKilometres = getVehicleQuotes({
    routeToken: routeToken(10_000),
    passengers: 2,
    luggage: 2,
  });
  assert.equal(tenKilometres.vehicles[0].pricing?.minimumAdjustmentCents, 0);
  assert.equal(tenKilometres.vehicles[0].pricing?.totalCents, 2_500);
  assert.equal(tenKilometres.vehicles[1].pricing?.totalCents, 2_800);
});

test("checkout fare rejects browser price and vehicle capacity tampering", () => {
  assert.equal(getVerifiedFare(requestInput(), fixedNow).pricing.totalCents, 2_500);
  assert.throws(
    () => getVerifiedFare(requestInput({ price: 1 }), fixedNow),
    (error: unknown) =>
      error instanceof QuoteRequestError &&
      error.message.includes("Kaina pasikeitė"),
  );
  assert.throws(
    () =>
      getVerifiedFare(
        requestInput({
          vehicleId: "economy",
          passengers: 5,
          luggage: 0,
        }),
        fixedNow,
      ),
    (error: unknown) =>
      error instanceof QuoteRequestError && error.status === 422,
  );
});

test("checkout fare rejects stale addresses even with a valid route token", () => {
  const input = requestInput();
  const changedPickup = {
    ...input.pickup,
    latitude: origin.latitude + 0.01,
  };
  assert.throws(
    () =>
      getVerifiedFare(
        {
          ...input,
          pickup: {
            ...changedPickup,
            placeToken: createVerifiedPlaceToken(changedPickup, fixedNow),
          },
        },
        fixedNow,
      ),
    (error: unknown) =>
      error instanceof QuoteRequestError &&
      error.message.includes("Adresai pasikeitė"),
  );
});

test("checkout rejects forged place labels and IDs with the original coordinates", () => {
  const input = requestInput();
  for (const pickup of [
    { ...input.pickup, label: "Vilniaus oro uostas" },
    { ...input.pickup, providerPlaceId: "other-place" },
    { ...input.pickup, placeToken: undefined },
  ]) {
    assert.throws(
      () => getVerifiedFare({ ...input, pickup }, fixedNow),
      (error: unknown) => error instanceof QuoteRequestError && error.status === 400 &&
        error.message.includes("Adresų patvirtinimas"),
    );
  }
});

test("checkout fare validates pickup date and stores a Vilnius UTC instant", () => {
  assert.equal(
    getVerifiedFare(requestInput(), fixedNow).scheduledAtUtc,
    "2026-09-23T12:30:00.000Z",
  );
  assert.throws(
    () => getVerifiedFare(requestInput({ time: "15:29" }), fixedNow),
    (error: unknown) =>
      error instanceof QuoteRequestError &&
      error.status === 422 &&
      error.message.includes("30 min"),
  );
  assert.throws(
    () => getVerifiedFare(requestInput({ date: "2026-02-30" }), fixedNow),
    (error: unknown) =>
      error instanceof QuoteRequestError && error.status === 400,
  );
  assert.throws(
    () => getVerifiedFare(requestInput({ date: "2026-03-29", time: "03:30" }), fixedNow),
    (error: unknown) =>
      error instanceof QuoteRequestError &&
      error.status === 400 &&
      error.message.includes("vasaros laiko"),
  );
  assert.throws(
    () => getVerifiedFare(requestInput({ date: "2026-10-25", time: "03:30" }), fixedNow),
    (error: unknown) =>
      error instanceof QuoteRequestError &&
      error.status === 400 &&
      error.message.includes("žiemos laiko"),
  );
});

test("checkout keeps validated free preferences without changing the signed fare", () => {
  const preferences = {
    ...createEmptyPreferences(),
    spotify: { enabled: true, preference: "  Quiet jazz  " },
    preferredLanguage: { enabled: true, language: "lt", otherLanguage: "stale" },
    meetAndGreet: { enabled: true, signText: "  ADV svečias  " },
    driverComment: { enabled: false, text: "stale driver note" },
  };
  const fare = getVerifiedFare(requestInput({ preferences }), fixedNow);
  assert.equal(fare.pricing.totalCents, 2_500);
  assert.equal(fare.preferences.spotify.preference, "Quiet jazz");
  assert.equal(fare.preferences.preferredLanguage.otherLanguage, "");
  assert.equal(fare.preferences.meetAndGreet.signText, "ADV svečias");
  assert.deepEqual(fare.preferences.driverComment, { enabled: false, text: "" });
  assert.deepEqual(
    getVerifiedFare(requestInput(), fixedNow).preferences,
    createEmptyPreferences(),
  );
});

test("checkout rejects malformed or required preferences before payment", () => {
  assert.throws(
    () => getVerifiedFare(requestInput({ preferences: null }), fixedNow),
    (error: unknown) => error instanceof QuoteRequestError && error.status === 400,
  );
  assert.throws(
    () => getVerifiedFare(requestInput({
      preferences: {
        ...createEmptyPreferences(),
        meetAndGreet: { enabled: true, signText: "  " },
      },
    }), fixedNow),
    (error: unknown) => error instanceof QuoteRequestError && error.status === 400,
  );
});

test.after(() => {
  if (previousSecret === undefined) delete process.env.ROUTE_TOKEN_SECRET;
  else process.env.ROUTE_TOKEN_SECRET = previousSecret;
});
