import assert from "node:assert/strict";
import test from "node:test";

import { prepareCheckoutRequest, CheckoutRequestError } from "../api/_checkout-data.ts";
import { createRouteToken } from "../api/_route-token.ts";
import { createVerifiedPlaceToken } from "../api/_place-token.ts";
import { createEmptyPreferences } from "../src/domain/booking.ts";

process.env.ROUTE_TOKEN_SECRET = "stage-eight-checkout-test-secret";

const origin = { latitude: 54.9639, longitude: 24.0848 };
const destination = { latitude: 54.8968, longitude: 23.8854 };

function booking(overrides: Record<string, unknown> = {}) {
  const routeToken = createRouteToken({
    origin,
    destination,
    distanceMeters: 10_000,
    durationSeconds: 900,
  });
  assert.ok(routeToken);
  const pickup = { provider: "google" as const, providerPlaceId: "airport", label: "Kauno oro uostas", ...origin };
  const destinationPlace = { provider: "google" as const, providerPlaceId: "centre", label: "Kauno centras", ...destination };
  return {
    routeToken,
    pickup: { ...pickup, placeToken: createVerifiedPlaceToken(pickup) },
    destination: { ...destinationPlace, placeToken: createVerifiedPlaceToken(destinationPlace) },
    date: "2030-09-23",
    time: "14:00",
    passengers: 2,
    luggage: 2,
    vehicleId: "economy",
    price: 25,
    firstName: "Aistė",
    lastName: "Jonaitė",
    phone: "+37061234567",
    email: "aiste@example.com",
    preferences: createEmptyPreferences(),
    paymentMethod: "driver",
    clientRequestId: "75150b6e-f8f6-4425-8d5e-f950f0005ae1",
    ...overrides,
  };
}

test("vehicle payment charges only a 50-cent advance and keeps the total unchanged", () => {
  const result = prepareCheckoutRequest(booking());
  assert.equal(result.plan.totalCents, 2_500);
  assert.equal(result.plan.amountDueNowCents, 50);
  assert.equal(result.plan.remainingAfterSuccessfulPaymentCents, 2_450);
  assert.equal(result.draft.paymentMethod, "pay-in-vehicle");
  assert.equal(result.draft.customer.email, "aiste@example.com");
  assert.equal("placeToken" in result.draft.pickup, false);
});

test("full online payment charges the fare once with no vehicle balance", () => {
  const result = prepareCheckoutRequest(booking({ paymentMethod: "stripe" }));
  assert.equal(result.plan.amountDueNowCents, 2_500);
  assert.equal(result.plan.remainingAfterSuccessfulPaymentCents, 0);
  assert.equal(result.draft.paymentMethod, "online-full");
});

test("an invalid contact, payment mode or request id is rejected before Stripe", () => {
  for (const overrides of [
    { email: "not-an-email" },
    { paymentMethod: "cash-only" },
    { clientRequestId: "same-order" },
  ]) {
    assert.throws(() => prepareCheckoutRequest(booking(overrides)), CheckoutRequestError);
  }
});

test("the idempotency fingerprint follows the normalized order", () => {
  const first = prepareCheckoutRequest(booking());
  const second = prepareCheckoutRequest(booking());
  const changed = prepareCheckoutRequest(booking({ paymentMethod: "stripe" }));
  assert.equal(first.fingerprint, second.fingerprint);
  assert.notEqual(first.fingerprint, changed.fingerprint);
});
