import assert from "node:assert/strict";
import test from "node:test";

import {
  BUSINESS_TIME_ZONE,
  RESERVATION_SCHEMA_VERSION,
  VEHICLES,
  calculatePaymentPlan,
  calculatePricing,
  createEmptyPreferences,
  getCompatibleVehicleIds,
  getVehicleCapacity,
  hasMinimumLeadTime,
  parseTripPreferences,
  validateReservationDraft,
  wrapLegacyBooking,
  type ReservationDraft,
} from "../src/domain/booking.ts";

test("10 km pricing matches the accepted examples", () => {
  assert.equal(calculatePricing("economy", 10_000).totalCents, 2500);
  assert.equal(
    calculatePricing("executive-minivan", 10_000).totalCents,
    2800,
  );
});

test("minimum fare includes the boarding fee", () => {
  const pricing = calculatePricing("economy", 2_000);

  assert.equal(pricing.boardingFeeCents, 300);
  assert.equal(pricing.subtotalCents, 740);
  assert.equal(pricing.minimumAdjustmentCents, 1760);
  assert.equal(pricing.totalCents, 2500);
});

test("vehicle capacity follows the confirmed combinations", () => {
  assert.equal(getVehicleCapacity("economy", 4, 4).available, true);
  assert.equal(getVehicleCapacity("economy", 5, 0).available, false);
  assert.equal(
    getVehicleCapacity("executive-minivan", 4, 8).available,
    true,
  );
  assert.equal(
    getVehicleCapacity("executive-minivan", 5, 5).available,
    false,
  );
  assert.equal(
    getVehicleCapacity("executive-minivan", 6, 7).available,
    false,
  );
  assert.deepEqual(getCompatibleVehicleIds(4, 7), ["executive-minivan"]);
  assert.deepEqual(getCompatibleVehicleIds(6, 7), []);
});

test("pay-in-vehicle advance is credited to the total", () => {
  assert.deepEqual(calculatePaymentPlan("pay-in-vehicle", 3500), {
    method: "pay-in-vehicle",
    currency: "EUR",
    totalCents: 3500,
    amountDueNowCents: 50,
    remainingAfterSuccessfulPaymentCents: 3450,
  });

  assert.equal(
    calculatePaymentPlan("online-full", 3500)
      .remainingAfterSuccessfulPaymentCents,
    0,
  );
});

function validDraft(): ReservationDraft {
  return {
    schemaVersion: RESERVATION_SCHEMA_VERSION,
    customer: {
      firstName: "Jonas",
      lastName: "Jonaitis",
      phone: "+37060000000",
      email: "jonas@example.com",
    },
    pickup: {
      provider: "nominatim",
      providerPlaceId: "1001",
      label: "Kauno oro uostas",
      latitude: 54.9639,
      longitude: 24.0848,
    },
    destination: {
      provider: "nominatim",
      providerPlaceId: "1002",
      label: "Rotušės a. 15, Kaunas",
      latitude: 54.8968,
      longitude: 23.8854,
    },
    schedule: {
      localDate: "2026-09-23",
      localTime: "12:00",
      timeZone: BUSINESS_TIME_ZONE,
      scheduledAtUtc: "2026-09-23T09:00:00.000Z",
    },
    route: {
      provider: "osrm",
      distanceMeters: 10_000,
      durationSeconds: 900,
      encodedPolyline: null,
    },
    party: { passengers: 4, standardLuggage: 4 },
    vehicleId: "economy",
    vehicleModel: VEHICLES.economy.model,
    preferences: createEmptyPreferences(),
    pricing: calculatePricing("economy", 10_000),
    paymentMethod: "pay-in-vehicle",
  };
}

test("complete reservation draft validates", () => {
  const result = validateReservationDraft(validDraft());
  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
});

test("older payloads without preferences default to four disabled options", () => {
  assert.deepEqual(parseTripPreferences(undefined), {
    preferences: createEmptyPreferences(),
    issues: [],
  });
  assert.equal(
    validateReservationDraft({ ...validDraft(), preferences: undefined }).valid,
    true,
  );
});

test("active preferences are trimmed and disabled stale text is erased", () => {
  const parsed = parseTripPreferences({
    spotify: { enabled: true, preference: "  Jazz  " },
    preferredLanguage: { enabled: false, language: "ru", otherLanguage: "Old value" },
    meetAndGreet: { enabled: true, signText: "  Jonas Jonaitis  " },
    driverComment: { enabled: false, text: "Old pickup note" },
  });
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.preferences, {
    spotify: { enabled: true, preference: "Jazz" },
    preferredLanguage: { enabled: false, language: null, otherLanguage: "" },
    meetAndGreet: { enabled: true, signText: "Jonas Jonaitis" },
    driverComment: { enabled: false, text: "" },
  });
});

test("enabled sign and other language must have usable text", () => {
  const parsed = parseTripPreferences({
    ...createEmptyPreferences(),
    preferredLanguage: { enabled: true, language: "other", otherLanguage: "   " },
    meetAndGreet: { enabled: true, signText: "   " },
  });
  assert.ok(parsed.issues.some((issue) => issue.path === "preferences.preferredLanguage.otherLanguage" && issue.code === "required"));
  assert.ok(parsed.issues.some((issue) => issue.path === "preferences.meetAndGreet.signText" && issue.code === "required"));
});

test("oversize or malformed fields are rejected even if their option is off", () => {
  const parsed = parseTripPreferences({
    ...createEmptyPreferences(),
    spotify: { enabled: false, preference: "a".repeat(501) },
    preferredLanguage: { enabled: false, language: "bogus", otherLanguage: "" },
    meetAndGreet: { enabled: false, signText: "ok" },
    driverComment: { enabled: false, text: "no\u0000" },
  });
  assert.deepEqual(
    parsed.issues.map((issue) => issue.path),
    [
      "preferences.spotify.preference",
      "preferences.preferredLanguage.language",
      "preferences.driverComment.text",
    ],
  );
});

test("driver note retains safe line breaks and does not alter the fare", () => {
  const draft = validDraft();
  const parsed = parseTripPreferences({
    ...createEmptyPreferences(),
    driverComment: { enabled: true, text: "  Gate B\r\nCall on arrival  " },
  });
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.preferences.driverComment.text, "Gate B\nCall on arrival");
  assert.equal(
    validateReservationDraft({ ...draft, preferences: parsed.preferences }).valid,
    true,
  );
  assert.equal(draft.pricing.extrasCents, 0);
});

test("server-side validation rejects a tampered price", () => {
  const draft = validDraft();
  const tampered = {
    ...draft,
    pricing: { ...draft.pricing, totalCents: 100 },
  };
  const result = validateReservationDraft(tampered);

  assert.equal(result.valid, false);
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.path === "pricing" &&
        issue.code === "server-recalculation-mismatch",
    ),
  );
});

test("30 minute lead-time rule uses the resolved UTC instant", () => {
  const now = Date.parse("2026-09-23T09:00:00.000Z");
  assert.equal(
    hasMinimumLeadTime("2026-09-23T09:30:00.000Z", now),
    true,
  );
  assert.equal(
    hasMinimumLeadTime("2026-09-23T09:29:59.000Z", now),
    false,
  );
});

test("legacy booking is retained as a versioned payload", () => {
  const legacy = wrapLegacyBooking({
    pickup: null,
    destination: null,
    date: "2026-09-23",
    time: "12:00",
    passengers: 1,
    luggage: 0,
    firstName: "Jonas",
    lastName: "Jonaitis",
    phone: "+37060000000",
    paymentMethod: "driver",
    distanceKm: 0,
    durationMin: 0,
    price: 0,
  });

  assert.equal(legacy.schemaVersion, 1);
  assert.equal(legacy.legacyPayload.firstName, "Jonas");
});
