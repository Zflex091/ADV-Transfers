import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { mock, test } from "node:test";

import { PGlite } from "@electric-sql/pglite";
import Stripe from "stripe";

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
mock.module("pg", { exports: { Pool: EmbeddedPool } });
const backgroundTasks: Promise<unknown>[] = [];
let deliveredEmailCount = 0;
mock.module("@vercel/functions", {
  exports: { waitUntil: (task: Promise<unknown>) => { backgroundTasks.push(task); } },
});
mock.module("nodemailer", {
  exports: {
    default: {
      createTransport: () => ({
        sendMail: async (mail: { to: string }) => {
          deliveredEmailCount += 1;
          return {
            messageId: "mock-stage-eight-" + deliveredEmailCount,
            accepted: [mail.to],
            rejected: [],
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
process.env.SMTP_USER = "sender@example.invalid";
process.env.SMTP_PASS = "fake-test-password";
process.env.SMTP_FROM = "sender@example.invalid";
process.env.BOOKING_OWNER_EMAIL = "owner@example.invalid";
const orders = await import("../api/_orders.ts");
const webhook = await import("../api/stripe-webhook.ts");

const pricing = calculatePricing("economy", 10_000);
const draft: ReservationDraft = {
  schemaVersion: RESERVATION_SCHEMA_VERSION,
  customer: { firstName: "Aistė", lastName: "Jonaitė", phone: "+37061234567", email: "aiste@example.com" },
  pickup: { provider: "google", providerPlaceId: "airport", label: "Kauno oro uostas", latitude: 54.9639, longitude: 24.0848 },
  destination: { provider: "google", providerPlaceId: "centre", label: "Kauno centras", latitude: 54.8968, longitude: 23.8854 },
  schedule: { localDate: "2030-09-23", localTime: "14:00", timeZone: BUSINESS_TIME_ZONE, scheduledAtUtc: "2030-09-23T11:00:00.000Z" },
  route: { provider: "google", distanceMeters: 10_000, durationSeconds: 900, encodedPolyline: null },
  party: { passengers: 2, standardLuggage: 2 },
  vehicleId: "economy",
  vehicleModel: VEHICLES.economy.model,
  preferences: createEmptyPreferences(),
  pricing,
  paymentMethod: "pay-in-vehicle",
};

test("order storage keeps one pending booking per request and confirms only the verified amount once", async () => {
  const clientRequestId = randomUUID();
  const input = {
    clientRequestId,
    requestHash: "a".repeat(64),
    draft,
    paymentPlan: calculatePaymentPlan("pay-in-vehicle", pricing.totalCents),
  };
  const first = await orders.createOrGetPendingOrder(input);
  assert.equal(first.created, true);
  assert.equal(first.order.status, "pending");
  assert.equal(first.order.totalCents, 2500);
  assert.equal(first.order.dueNowCents, 50);
  assert.equal(first.order.balanceCents, 2450);
  assert.equal(first.order.paidCents, 0);

  const repeated = await orders.createOrGetPendingOrder(input);
  assert.equal(repeated.created, false);
  assert.equal(repeated.order.id, first.order.id);
  assert.equal(repeated.statusToken, first.statusToken);
  await assert.rejects(
    orders.createOrGetPendingOrder({ ...input, requestHash: "b".repeat(64) }),
    orders.OrderConflictError,
  );
  assert.equal(await orders.getOrderForStatus(first.order.id, "x".repeat(43)), null);
  assert.equal((await orders.getOrderForStatus(first.order.id, first.statusToken))?.id, first.order.id);

  assert.equal(await orders.claimCheckoutCreation(first.order.id), true);
  assert.equal(await orders.claimCheckoutCreation(first.order.id), false);
  const session = await orders.attachCheckoutSession(first.order.id, "cs_test_single", "https://checkout.stripe.com/test");
  assert.equal(session?.stripeSessionId, "cs_test_single");
  assert.equal((await orders.findOrderBySessionId("cs_test_single"))?.id, first.order.id);

  const paid = await orders.markPaid({ orderId: first.order.id, sessionId: "cs_test_single", paymentIntentId: "pi_test_single", amountCents: 50, currency: "eur" });
  assert.equal(paid?.status, "paid");
  assert.equal(paid?.paidCents, 50);
  assert.equal(paid?.balanceCents, 2450);
  const repeatedWebhook = await orders.markPaid({ orderId: first.order.id, sessionId: "cs_test_single", paymentIntentId: "pi_test_single", amountCents: 50, currency: "eur" });
  assert.equal(repeatedWebhook?.paidAt, paid?.paidAt);
  const lateFailure = await orders.markFailed({ orderId: first.order.id, sessionId: "cs_test_single", status: "failed" });
  assert.equal(lateFailure?.status, "paid");
});

test("full online fare and failed payment never create a paid booking accidentally", async () => {
  const fullDraft: ReservationDraft = { ...draft, paymentMethod: "online-full" };
  const full = await orders.createOrGetPendingOrder({
    clientRequestId: randomUUID(),
    requestHash: "c".repeat(64),
    draft: fullDraft,
    paymentPlan: calculatePaymentPlan("online-full", pricing.totalCents),
  });
  assert.equal(full.order.dueNowCents, 2500);
  assert.equal(full.order.balanceCents, 0);
  assert.equal(await orders.claimCheckoutCreation(full.order.id), true);
  await orders.releaseCheckoutCreation(full.order.id);
  assert.equal(await orders.claimCheckoutCreation(full.order.id), true);
  await orders.attachCheckoutSession(full.order.id, "cs_test_full", "https://checkout.stripe.com/full");
  assert.equal(await orders.markPaid({ orderId: full.order.id, sessionId: "cs_test_full", paymentIntentId: "pi_test_full", amountCents: 50, currency: "eur" }), null);
  assert.equal((await orders.getOrderById(full.order.id))?.status, "pending");
  const paid = await orders.markPaid({ orderId: full.order.id, sessionId: "cs_test_full", paymentIntentId: "pi_test_full", amountCents: 2500, currency: "eur" });
  assert.equal(paid?.status, "paid");
  assert.equal(paid?.paidCents, 2500);
  assert.equal(paid?.balanceCents, 0);

  const failed = await orders.createOrGetPendingOrder({
    clientRequestId: randomUUID(),
    requestHash: "d".repeat(64),
    draft,
    paymentPlan: calculatePaymentPlan("pay-in-vehicle", pricing.totalCents),
  });
  await orders.claimCheckoutCreation(failed.order.id);
  await orders.attachCheckoutSession(failed.order.id, "cs_test_failed", "https://checkout.stripe.com/failed");
  const failedRecord = await orders.markFailed({ orderId: failed.order.id, sessionId: "cs_test_failed", status: "failed" });
  assert.equal(failedRecord?.status, "failed");
  assert.equal(failedRecord?.paidCents, 0);
  assert.equal((await orders.getOrderForStatus(failed.order.id, failed.statusToken))?.status, "failed");
});

test("only a valid signed Stripe webhook confirms the saved 50-cent order, once", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_stage_eight";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_stage_eight_test_secret";
  const order = await orders.createOrGetPendingOrder({
    clientRequestId: randomUUID(),
    requestHash: "e".repeat(64),
    draft,
    paymentPlan: calculatePaymentPlan("pay-in-vehicle", pricing.totalCents),
  });
  await orders.claimCheckoutCreation(order.order.id);
  await orders.attachCheckoutSession(order.order.id, "cs_test_webhook", "https://checkout.stripe.com/webhook");

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  function eventPayload(amount: number, type = "checkout.session.completed") {
    return JSON.stringify({
      id: `evt_${type.replaceAll(".", "_")}_${amount}`,
      object: "event",
      type,
      data: { object: {
        object: "checkout.session",
        id: "cs_test_webhook",
        client_reference_id: order.order.id,
        mode: "payment",
        currency: "eur",
        amount_total: amount,
        payment_status: type === "checkout.session.expired" ? "unpaid" : "paid",
        status: type === "checkout.session.expired" ? "expired" : "complete",
        payment_intent: "pi_test_webhook",
      } },
    });
  }
  async function deliver(payload: string, validSignature = true) {
    const signature = validSignature
      ? stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! })
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

  assert.equal((await deliver(eventPayload(50), false)).statusCode, 400);
  assert.equal((await orders.getOrderById(order.order.id))?.status, "pending");
  assert.equal((await deliver(eventPayload(500))).statusCode, 409);
  assert.equal((await orders.getOrderById(order.order.id))?.status, "pending");
  assert.equal((await deliver(eventPayload(50))).statusCode, 200);
  const paid = await orders.getOrderById(order.order.id);
  assert.equal(paid?.status, "paid");
  assert.equal(paid?.paidCents, 50);
  assert.equal((await deliver(eventPayload(50))).statusCode, 200);
  assert.equal((await orders.getOrderById(order.order.id))?.paidAt, paid?.paidAt);
  assert.equal((await deliver(eventPayload(50, "checkout.session.expired"))).statusCode, 200);
  assert.equal((await orders.getOrderById(order.order.id))?.status, "paid");
  await Promise.all(backgroundTasks.splice(0));
  assert.equal(deliveredEmailCount, 1);
});
