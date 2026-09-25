import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { mock, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import Stripe from "stripe";
import {
  BUSINESS_TIME_ZONE, RESERVATION_SCHEMA_VERSION, calculatePaymentPlan,
  calculatePricing, createEmptyPreferences, VEHICLES, type ReservationDraft,
} from "../src/domain/booking.ts";

const database = new PGlite();
await database.exec(readFileSync(new URL("../db/001_booking_payments.sql", import.meta.url), "utf8"));
await database.exec(readFileSync(new URL("../db/002_booking_email_outbox.sql", import.meta.url), "utf8"));

class EmbeddedPool {
  query(query: string, params?: unknown[]) {
    return database.query(query, params);
  }
}
let delivered = 0;
let smtpFails = false;
let lastMessage: { to: string; text: string; html: string } | null = null;
const background: Promise<unknown>[] = [];
mock.module("pg", { exports: { Pool: EmbeddedPool } });
mock.module("@vercel/functions", {
  exports: { waitUntil: (task: Promise<unknown>) => { background.push(task); } },
});
mock.module("nodemailer", {
  exports: {
    default: {
      createTransport: () => ({
        sendMail: async (mail: { to: string; text: string; html: string }) => {
          if (smtpFails) throw new Error("simulated SMTP outage");
          delivered += 1;
          lastMessage = mail;
          return { messageId: "mock-webhook-" + delivered, accepted: [mail.to], rejected: [] };
        },
      }),
    },
  },
});
process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
process.env.ORDER_STATUS_SECRET = "unit-test-status-secret-with-at-least-32-characters";
process.env.STRIPE_SECRET_KEY = "sk_test_webhook_email";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_webhook_email_test_secret";
process.env.SMTP_HOST = "smtp.example.invalid";
process.env.SMTP_PORT = "587";
process.env.SMTP_USER = "sender@example.invalid";
process.env.SMTP_PASS = "fake-test-password";
process.env.SMTP_FROM = "sender@example.invalid";
process.env.BOOKING_OWNER_EMAIL = "owner@example.invalid";

const orders = await import("../api/_orders.ts");
const webhook = await import("../api/stripe-webhook.ts");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const pricing = calculatePricing("economy", 10_000);
const draft: ReservationDraft = {
  schemaVersion: RESERVATION_SCHEMA_VERSION,
  customer: {
    firstName: "Aistė", lastName: "Jonaitė",
    phone: "+37061234567", email: "aiste@example.com",
  },
  pickup: {
    provider: "google", providerPlaceId: "airport", label: "Kauno oro uostas",
    latitude: 54.9639, longitude: 24.0848,
  },
  destination: {
    provider: "google", providerPlaceId: "centre", label: "Kauno centras",
    latitude: 54.8968, longitude: 23.8854,
  },
  schedule: {
    localDate: "2030-09-23", localTime: "14:00", timeZone: BUSINESS_TIME_ZONE,
    scheduledAtUtc: "2030-09-23T11:00:00.000Z",
  },
  route: {
    provider: "google", distanceMeters: 10_000,
    durationSeconds: 900, encodedPolyline: null,
  },
  party: { passengers: 2, standardLuggage: 2 },
  vehicleId: "economy",
  vehicleModel: VEHICLES.economy.model,
  preferences: createEmptyPreferences(),
  pricing,
  paymentMethod: "pay-in-vehicle",
};

let orderNumber = 0;
async function newCheckout() {
  orderNumber += 1;
  const created = await orders.createOrGetPendingOrder({
    clientRequestId: randomUUID(),
    requestHash: orderNumber.toString(16).padStart(64, "0"),
    draft,
    paymentPlan: calculatePaymentPlan("pay-in-vehicle", pricing.totalCents),
  });
  const sessionId = "cs_test_webhook_email_" + orderNumber;
  assert.equal(await orders.claimCheckoutCreation(created.order.id), true);
  await orders.attachCheckoutSession(
    created.order.id, sessionId, "https://checkout.stripe.com/test",
  );
  return { orderId: created.order.id, sessionId };
}
function eventPayload(
  checkout: { orderId: string; sessionId: string },
  type: string,
  paymentStatus: "paid" | "unpaid",
) {
  return JSON.stringify({
    id: "evt_webhook_email_" + randomUUID(),
    object: "event",
    type,
    data: {
      object: {
        object: "checkout.session",
        id: checkout.sessionId,
        client_reference_id: checkout.orderId,
        mode: "payment",
        currency: "eur",
        amount_total: 50,
        payment_status: paymentStatus,
        status: "complete",
        payment_intent: "pi_test_webhook_email_" + orderNumber,
      },
    },
  });
}
async function deliverWebhook(payload: string, validSignature = true) {
  const signature = validSignature
    ? stripe.webhooks.generateTestHeaderString({
        payload, secret: process.env.STRIPE_WEBHOOK_SECRET!,
      })
    : "t=0,v1=invalid";
  const request = Object.assign(Readable.from([payload]), {
    method: "POST",
    headers: { "stripe-signature": signature },
  });
  const response = {
    statusCode: 200,
    body: null as unknown,
    setHeader() { return this; },
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  await webhook.default(request as never, response as never);
  return response;
}
async function drainBackground() {
  const tasks = background.splice(0);
  const results = await Promise.allSettled(tasks);
  assert.ok(results.every((result) => result.status === "fulfilled"));
}
async function outboxRows(orderId: string) {
  return database.query<{
    state: string; attempts: number;
    last_error_code: string | null; sent_at: Date | null;
  }>(
    "SELECT state, attempts, last_error_code, sent_at FROM adv_booking_email_outbox WHERE order_id = $1",
    [orderId],
  );
}

test("verified paid webhook queues one owner email, delivers it, and duplicate does not resend", async () => {
  const checkout = await newCheckout();
  const payload = eventPayload(checkout, "checkout.session.completed", "paid");
  const before = delivered;

  assert.equal((await deliverWebhook(payload, false)).statusCode, 400);
  assert.equal((await orders.getOrderById(checkout.orderId))?.status, "pending");
  assert.equal((await outboxRows(checkout.orderId)).rows.length, 0);
  assert.equal(delivered, before);

  assert.equal((await deliverWebhook(payload)).statusCode, 200);
  assert.equal((await orders.getOrderById(checkout.orderId))?.status, "paid");
  assert.equal((await outboxRows(checkout.orderId)).rows.length, 1);
  await drainBackground();
  const paid = await orders.getOrderById(checkout.orderId);
  assert.equal(paid?.paidCents, 50);
  assert.ok(paid?.confirmationEmailSentAt);
  assert.equal(delivered, before + 1);
  assert.equal(lastMessage?.to, "owner@example.invalid");
  assert.match(lastMessage?.text ?? "", /Aistė/);
  assert.match(lastMessage?.html ?? "", /Kauno oro uostas/);
  assert.equal((await outboxRows(checkout.orderId)).rows[0]?.state, "sent");

  assert.equal((await deliverWebhook(payload)).statusCode, 200);
  await drainBackground();
  assert.equal(delivered, before + 1);
  const outbox = await outboxRows(checkout.orderId);
  assert.equal(outbox.rows.length, 1);
  assert.equal(outbox.rows[0]?.state, "sent");
  assert.equal(outbox.rows[0]?.attempts, 1);
});

test("unpaid and failed Stripe events never queue or send an owner email", async () => {
  const before = delivered;
  const unpaid = await newCheckout();
  assert.equal(
    (await deliverWebhook(eventPayload(unpaid, "checkout.session.completed", "unpaid"))).statusCode,
    200,
  );
  await drainBackground();
  assert.equal((await orders.getOrderById(unpaid.orderId))?.status, "pending");
  assert.equal((await outboxRows(unpaid.orderId)).rows.length, 0);

  const failed = await newCheckout();
  assert.equal(
    (await deliverWebhook(eventPayload(failed, "checkout.session.async_payment_failed", "unpaid"))).statusCode,
    200,
  );
  await drainBackground();
  assert.equal((await orders.getOrderById(failed.orderId))?.status, "failed");
  assert.equal((await outboxRows(failed.orderId)).rows.length, 0);
  assert.equal(delivered, before);
});

test("SMTP outage keeps a verified paid booking queued without changing payment state", async () => {
  const checkout = await newCheckout();
  const payload = eventPayload(checkout, "checkout.session.completed", "paid");
  const before = delivered;
  smtpFails = true;
  try {
    assert.equal((await deliverWebhook(payload)).statusCode, 200);
    await drainBackground();
    const paid = await orders.getOrderById(checkout.orderId);
    assert.equal(paid?.status, "paid");
    assert.equal(paid?.paidCents, 50);
    assert.equal(paid?.confirmationEmailSentAt, null);
    const outbox = await outboxRows(checkout.orderId);
    assert.equal(outbox.rows.length, 1);
    assert.equal(outbox.rows[0]?.state, "pending");
    assert.equal(outbox.rows[0]?.attempts, 1);
    assert.equal(outbox.rows[0]?.last_error_code, "smtp-unavailable");
    assert.equal(outbox.rows[0]?.sent_at, null);
    assert.equal(delivered, before);

    assert.equal((await deliverWebhook(payload)).statusCode, 200);
    await drainBackground();
    assert.equal((await outboxRows(checkout.orderId)).rows[0]?.attempts, 1);
    assert.equal(delivered, before);
  } finally {
    smtpFails = false;
  }
});
