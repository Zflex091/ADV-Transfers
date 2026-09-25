import assert from "node:assert/strict";
import test from "node:test";

import { renderOwnerBookingEmail } from "../api/_booking-email.ts";
import type { OrderRecord } from "../api/_orders.ts";
import {
  BUSINESS_TIME_ZONE,
  RESERVATION_SCHEMA_VERSION,
  calculatePricing,
  createEmptyPreferences,
  VEHICLES,
  type ReservationDraft,
} from "../src/domain/booking.ts";

function paidOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  const draft: ReservationDraft = {
    schemaVersion: RESERVATION_SCHEMA_VERSION,
    customer: {
      firstName: "Aistė",
      lastName: "Jonaitė",
      phone: "+37061234567",
      email: "aiste@example.com",
    },
    pickup: {
      provider: "google",
      providerPlaceId: "place-origin",
      label: "Kauno oro uostas, Oro uosto g. 4, Karmėlava",
      latitude: 54.9639,
      longitude: 24.0848,
    },
    destination: {
      provider: "google",
      providerPlaceId: "place-destination",
      label: "Rotušės a. 1, Kaunas",
      latitude: 54.8968,
      longitude: 23.8854,
    },
    schedule: {
      localDate: "2030-09-23",
      localTime: "14:00",
      timeZone: BUSINESS_TIME_ZONE,
      scheduledAtUtc: "2030-09-23T11:00:00.000Z",
    },
    route: {
      provider: "google",
      distanceMeters: 10_000,
      durationSeconds: 900,
      encodedPolyline: null,
    },
    party: { passengers: 2, standardLuggage: 2 },
    vehicleId: "economy",
    vehicleModel: VEHICLES.economy.model,
    preferences: createEmptyPreferences(),
    pricing: calculatePricing("economy", 10_000),
    paymentMethod: "pay-in-vehicle",
  };

  return {
    id: "7e3c2fe8-9788-4254-b54c-cf7dc376c5d5",
    bookingCode: "ADV-1234ABCD",
    status: "paid",
    paymentMethod: "pay-in-vehicle",
    totalCents: 2_500,
    dueNowCents: 50,
    balanceCents: 2_450,
    paidCents: 50,
    currency: "eur",
    stripeSessionId: "cs_test_123",
    stripeSessionUrl: "https://checkout.stripe.com/test",
    stripePaymentIntentId: "pi_test_123",
    bookingSnapshot: draft,
    createdAt: "2030-09-20T10:15:00.000Z",
    updatedAt: "2030-09-20T10:16:00.000Z",
    paidAt: "2030-09-20T10:16:00.000Z",
    confirmationEmailSentAt: null,
    ...overrides,
  };
}

test("paid advance email contains the stored journey, fare and 50-cent balance breakdown", () => {
  const order = paidOrder();
  const email = renderOwnerBookingEmail(order);
  for (const expected of [
    order.bookingCode,
    order.id,
    "Patvirtinta · mokėjimas gautas",
    "Aistė Jonaitė",
    "+37061234567",
    "aiste@example.com",
    "Kauno oro uostas, Oro uosto g. 4, Karmėlava",
    "Rotušės a. 1, Kaunas",
    "2030-09-23 14:00 (Europe/Vilnius)",
    "10,00 km · apie 15 min.",
    "Economy",
    "Opel Astra ST Black Edition 2025",
    "Keleiviai: 2",
    "Standartiniai lagaminai: 2",
    "Tarifas: 2,20 € / km",
    "Įsėdimo mokestis: 3,00 €",
    "Galutinė kelionės kaina: 25,00 €",
    "Iš anksto sumokėta per Stripe: 0,50 €",
    "Mokėti automobilyje: 24,50 €",
    "Stripe mokėjimo būsena: Apmokėta",
    "cs_test_123",
    "pi_test_123",
  ]) {
    assert.ok(email.text.includes(expected), `Missing: ${expected}`);
  }
  assert.match(email.text, /Pateikta: .*Europe\/Vilnius/);
  assert.ok(email.html.includes('name="viewport"'));
  assert.ok(email.html.includes("width=\"100%\""));
  assert.equal(email.text.includes("Papildomi pageidavimai"), false);
  assert.equal(email.html.includes("Papildomi pageidavimai"), false);
});

test("full online minivan payment has no vehicle balance and keeps historical snapshot model", () => {
  const economy = paidOrder();
  const draft: ReservationDraft = {
    ...economy.bookingSnapshot,
    vehicleId: "executive-minivan",
    vehicleModel: "Chrysler Pacifica 2024",
    pricing: calculatePricing("executive-minivan", 10_000),
    party: { passengers: 4, standardLuggage: 8 },
    paymentMethod: "online-full",
  };
  const email = renderOwnerBookingEmail(paidOrder({
    bookingSnapshot: draft,
    paymentMethod: "online-full",
    totalCents: 2_800,
    dueNowCents: 2_800,
    balanceCents: 0,
    paidCents: 2_800,
  }));
  assert.match(email.text, /Executive Minivan/);
  assert.match(email.text, /Chrysler Pacifica 2024/);
  assert.match(email.text, /Standartiniai lagaminai: 8/);
  assert.match(email.text, /Tarifas: 2,50 € \/ km/);
  assert.match(email.text, /Galutinė kelionės kaina: 28,00 €/);
  assert.match(email.text, /Iš anksto sumokėta per Stripe: 28,00 €/);
  assert.match(email.text, /Mokėti automobilyje: 0,00 €/);
  assert.match(email.text, /Visa suma internetu per Stripe/);
});

test("only active preferences appear, including multiline comment and other language", () => {
  const order = paidOrder();
  const draft: ReservationDraft = {
    ...order.bookingSnapshot,
    preferences: {
      spotify: { enabled: true, preference: "Jazz & soul" },
      preferredLanguage: { enabled: true, language: "other", otherLanguage: "Ukrainiečių" },
      meetAndGreet: { enabled: true, signText: "Aistė / Acme" },
      driverComment: { enabled: true, text: "Privažiuoti prie B vartų.\nLaukti prie įėjimo." },
    },
  };
  const email = renderOwnerBookingEmail(paidOrder({ bookingSnapshot: draft }));
  for (const expected of [
    "Play my Spotify music: Taip",
    "Muzikos pasirinkimas: Jazz & soul",
    "Preferred language: Ukrainiečių",
    "Meet me with a sign: Taip",
    "Užrašas lentoje: Aistė / Acme",
    "Comment for driver: Privažiuoti prie B vartų.\nLaukti prie įėjimo.",
  ]) assert.ok(email.text.includes(expected), `Missing: ${expected}`);
  assert.match(email.html, /Privažiuoti prie B vartų\.<br>Laukti prie įėjimo\./);

  const disabledDraft: ReservationDraft = {
    ...draft,
    preferences: {
      spotify: { enabled: false, preference: "STALE SPOTIFY" },
      preferredLanguage: { enabled: false, language: "other", otherLanguage: "STALE LANGUAGE" },
      meetAndGreet: { enabled: false, signText: "STALE SIGN" },
      driverComment: { enabled: false, text: "STALE COMMENT" },
    },
  };
  const disabled = renderOwnerBookingEmail(paidOrder({ bookingSnapshot: disabledDraft }));
  for (const stale of ["STALE SPOTIFY", "STALE LANGUAGE", "STALE SIGN", "STALE COMMENT"]) {
    assert.equal(disabled.text.includes(stale), false);
    assert.equal(disabled.html.includes(stale), false);
  }
  assert.equal(disabled.text.includes("Papildomi pageidavimai"), false);
});

test("HTML escapes customer content while preserving user line breaks", () => {
  const order = paidOrder();
  const draft: ReservationDraft = {
    ...order.bookingSnapshot,
    customer: { ...order.bookingSnapshot.customer, firstName: '<img src=x onerror="alert(1)">' },
    pickup: { ...order.bookingSnapshot.pickup, label: "A & B <script>evil()</script>" },
    preferences: {
      ...order.bookingSnapshot.preferences,
      driverComment: { enabled: true, text: "Pirma eilutė\r\n<b>antra</b> & 'trečia'" },
    },
  };
  const email = renderOwnerBookingEmail(paidOrder({ bookingSnapshot: draft }));
  assert.equal(email.html.includes("<script>"), false);
  assert.equal(email.html.includes("<img src=x"), false);
  assert.equal(email.html.includes("<b>antra</b>"), false);
  assert.match(email.html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(email.html, /A &amp; B &lt;script&gt;evil\(\)&lt;\/script&gt;/);
  assert.match(email.html, /Pirma eilutė<br>&lt;b&gt;antra&lt;\/b&gt; &amp; &#39;trečia&#39;/);
});

test("pending or failed bookings cannot be rendered as confirmations", () => {
  for (const status of ["pending", "failed", "cancelled"] as const) {
    assert.throws(() => renderOwnerBookingEmail(paidOrder({ status })), /tik apmokėtam/);
  }
});
