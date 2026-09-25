import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mock, test } from "node:test";

import { PGlite } from "@electric-sql/pglite";

import {
  BUSINESS_TIME_ZONE,
  RESERVATION_SCHEMA_VERSION,
  calculatePaymentPlan,
  calculatePricing,
  createEmptyPreferences,
  VEHICLES,
  type ReservationDraft,
} from "../src/domain/booking.ts";

const database = new PGlite();
await database.exec(readFileSync(new URL("../db/001_booking_payments.sql", import.meta.url), "utf8"));
await database.exec(readFileSync(new URL("../db/002_booking_email_outbox.sql", import.meta.url), "utf8"));

class EmbeddedPool {
  query(query: string, params?: unknown[]) {
    return database.query(query, params);
  }
}
let deliveryCount = 0;
let failDelivery = false;
let rejectRecipient = false;
let lastRecipient = "";
mock.module("pg", { exports: { Pool: EmbeddedPool } });
mock.module("nodemailer", {
  exports: {
    default: {
      createTransport: () => ({
        sendMail: async (mail: { to: string }) => {
          if (failDelivery) throw new Error("simulated SMTP failure");
          deliveryCount += 1;
          lastRecipient = mail.to;
          return {
            messageId: "mock-message-" + deliveryCount,
            accepted: rejectRecipient ? [] : [mail.to],
            rejected: rejectRecipient ? [mail.to] : [],
          };
        },
      }),
    },
  },
});

process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
process.env.ORDER_STATUS_SECRET = "unit-test-status-secret-with-at-least-32-characters";
process.env.SMTP_HOST = "smtp.example.invalid";
process.env.SMTP_PORT = "587";
process.env.SMTP_USER = "smtp-user@example.invalid";
process.env.SMTP_PASS = "fake-test-password";
process.env.SMTP_FROM = "sender@example.invalid";
process.env.BOOKING_OWNER_EMAIL = "owner@example.invalid";

const orders = await import("../api/_orders.ts");
const notices = await import("../api/_booking-notifications.ts");

const pricing = calculatePricing("economy", 10_000);
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
    providerPlaceId: "airport",
    label: "Kauno oro uostas",
    latitude: 54.9639,
    longitude: 24.0848,
  },
  destination: {
    provider: "google",
    providerPlaceId: "centre",
    label: "Kauno centras",
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
  pricing,
  paymentMethod: "pay-in-vehicle",
};

let nextHash = 0;
async function newOrder(paid: boolean) {
  const requestHash = (++nextHash).toString(16).padStart(64, "0");
  const created = await orders.createOrGetPendingOrder({
    clientRequestId: randomUUID(),
    requestHash,
    draft,
    paymentPlan: calculatePaymentPlan("pay-in-vehicle", pricing.totalCents),
  });
  if (!paid) return created.order;
  const sessionId = "cs_test_email_" + nextHash;
  await orders.claimCheckoutCreation(created.order.id);
  await orders.attachCheckoutSession(
    created.order.id,
    sessionId,
    "https://checkout.stripe.com/test",
  );
  const confirmed = await orders.markPaid({
    orderId: created.order.id,
    sessionId,
    paymentIntentId: "pi_test_email_" + nextHash,
    amountCents: 50,
    currency: "eur",
  });
  assert.equal(confirmed?.status, "paid");
  return confirmed!;
}

test("unpaid bookings never enter the email queue", async () => {
  const pending = await newOrder(false);
  assert.equal(await notices.queueOwnerBookingEmail(pending.id), false);
  assert.equal(await notices.sendOwnerBookingEmail(pending.id), "not-eligible");
  const rows = await database.query(
    "SELECT order_id FROM adv_booking_email_outbox WHERE order_id = $1",
    [pending.id],
  );
  assert.equal(rows.rows.length, 0);
  assert.equal(deliveryCount, 0);
});

test("paid booking is queued once, delivered once, and marked sent", async () => {
  const paid = await newOrder(true);
  assert.equal(await notices.queueOwnerBookingEmail(paid.id), true);
  assert.equal(await notices.queueOwnerBookingEmail(paid.id), true);
  assert.equal(await notices.sendOwnerBookingEmail(paid.id), "sent");
  assert.equal(await notices.sendOwnerBookingEmail(paid.id), "already-sent");
  assert.equal(deliveryCount, 1);
  assert.equal(lastRecipient, "owner@example.invalid");
  const outbox = await database.query<{ state: string; attempts: number; sent_at: Date }>(
    "SELECT state, attempts, sent_at FROM adv_booking_email_outbox WHERE order_id = $1",
    [paid.id],
  );
  assert.equal(outbox.rows[0]?.state, "sent");
  assert.equal(outbox.rows[0]?.attempts, 1);
  assert.ok(outbox.rows[0]?.sent_at);
  assert.ok((await orders.getOrderById(paid.id))?.confirmationEmailSentAt);
});

test("temporary SMTP failure is recorded and retried after backoff", async () => {
  const paid = await newOrder(true);
  failDelivery = true;
  assert.equal(await notices.sendOwnerBookingEmail(paid.id), "failed");
  assert.equal(await notices.sendOwnerBookingEmail(paid.id), "busy");
  const failed = await database.query<{ state: string; last_error_code: string }>(
    "SELECT state, last_error_code FROM adv_booking_email_outbox WHERE order_id = $1",
    [paid.id],
  );
  assert.equal(failed.rows[0]?.state, "pending");
  assert.equal(failed.rows[0]?.last_error_code, "smtp-unavailable");
  assert.equal((await orders.getOrderById(paid.id))?.confirmationEmailSentAt, null);

  await database.query(
    "UPDATE adv_booking_email_outbox SET next_attempt_at = NOW() - INTERVAL '1 second' WHERE order_id = $1",
    [paid.id],
  );
  failDelivery = false;
  assert.deepEqual(await notices.processPendingBookingEmails(), {
    sent: 1,
    failed: 0,
    skipped: 0,
  });
  assert.equal((await orders.getOrderById(paid.id))?.confirmationEmailSentAt !== null, true);
});

test("SMTP rejection never marks the booking email as sent", async () => {
  const paid = await newOrder(true);
  rejectRecipient = true;
  try {
    assert.equal(await notices.sendOwnerBookingEmail(paid.id), "failed");
    const row = await database.query<{ state: string; sent_at: Date | null }>(
      "SELECT state, sent_at FROM adv_booking_email_outbox WHERE order_id = $1",
      [paid.id],
    );
    assert.equal(row.rows[0]?.state, "pending");
    assert.equal(row.rows[0]?.sent_at, null);
    assert.equal((await orders.getOrderById(paid.id))?.confirmationEmailSentAt, null);
  } finally {
    rejectRecipient = false;
  }
});

test("missing SMTP configuration leaves paid booking queued without sending", async () => {
  const paid = await newOrder(true);
  const original = process.env.BOOKING_OWNER_EMAIL;
  delete process.env.BOOKING_OWNER_EMAIL;
  try {
    assert.equal(await notices.sendOwnerBookingEmail(paid.id), "failed");
    const row = await database.query<{ last_error_code: string }>(
      "SELECT last_error_code FROM adv_booking_email_outbox WHERE order_id = $1",
      [paid.id],
    );
    assert.equal(row.rows[0]?.last_error_code, "smtp-config-missing");
  } finally {
    process.env.BOOKING_OWNER_EMAIL = original;
  }
});

test("retry worker recovers a paid booking when webhook ended before queueing", async () => {
  const paid = await newOrder(true);
  const before = deliveryCount;
  const result = await notices.processPendingBookingEmails();
  assert.deepEqual(result, { sent: 1, failed: 0, skipped: 0 });
  assert.equal(deliveryCount, before + 1);
  assert.ok((await orders.getOrderById(paid.id))?.confirmationEmailSentAt);
});

test("retry worker processes two separate paid bookings in one bounded run", async () => {
  const first = await newOrder(true);
  const second = await newOrder(true);
  const before = deliveryCount;
  assert.deepEqual(await notices.processPendingBookingEmails(2), {
    sent: 2,
    failed: 0,
    skipped: 0,
  });
  assert.equal(deliveryCount, before + 2);
  assert.ok((await orders.getOrderById(first.id))?.confirmationEmailSentAt);
  assert.ok((await orders.getOrderById(second.id))?.confirmationEmailSentAt);
});

test("concurrent attempts cannot deliver the same booking twice", async () => {
  const paid = await newOrder(true);
  const before = deliveryCount;
  const results = await Promise.all([
    notices.sendOwnerBookingEmail(paid.id),
    notices.sendOwnerBookingEmail(paid.id),
  ]);
  assert.ok(results.includes("sent"));
  assert.ok(results.every((result) => result === "sent" || result === "busy" || result === "already-sent"));
  assert.equal(deliveryCount, before + 1);
});
