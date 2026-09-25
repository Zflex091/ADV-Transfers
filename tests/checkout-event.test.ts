import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";

import {
  CheckoutEventMismatch,
  checkoutOrderId,
  inspectCheckoutEvent,
} from "../api/_checkout-event.ts";

const order = {
  id: "8aac986d-640a-4d6e-a31d-8342b974ee50",
  stripeSessionId: "cs_test_checkout_123",
  dueNowCents: 50,
  currency: "eur",
};

function event(
  type: string,
  overrides: Record<string, unknown> = {},
): Stripe.Event {
  return {
    type,
    data: {
      object: {
        object: "checkout.session",
        id: order.stripeSessionId,
        client_reference_id: order.id,
        amount_total: order.dueNowCents,
        currency: order.currency,
        mode: "payment",
        payment_status: "paid",
        status: "complete",
        payment_intent: "pi_test_123",
        ...overrides,
      },
    },
  } as Stripe.Event;
}

test("paid Checkout event matches the stored session and €0.50 advance", () => {
  const result = inspectCheckoutEvent(event("checkout.session.completed"), order);
  assert.deepEqual(result, {
    kind: "paid",
    paymentIntentId: "pi_test_123",
  });
  assert.equal(checkoutOrderId(event("checkout.session.completed")), order.id);
});

test("completed but unpaid Checkout stays pending until asynchronous success", () => {
  assert.deepEqual(
    inspectCheckoutEvent(
      event("checkout.session.completed", { payment_status: "unpaid" }),
      order,
    ),
    { kind: "pending" },
  );
  assert.equal(
    inspectCheckoutEvent(event("checkout.session.async_payment_succeeded"), order)
      .kind,
    "paid",
  );
});

test("failed and expired sessions can only fail an unpaid order", () => {
  const unpaid = { payment_status: "unpaid" };
  assert.equal(
    inspectCheckoutEvent(event("checkout.session.async_payment_failed", unpaid), order)
      .kind,
    "failed",
  );
  assert.equal(
    inspectCheckoutEvent(event("checkout.session.expired", unpaid), order).kind,
    "failed",
  );
  assert.equal(
    inspectCheckoutEvent(event("checkout.session.async_payment_failed"), order)
      .kind,
    "pending",
  );
});

test("a signed event for a different session, order, currency or amount is rejected", () => {
  for (const bad of [
    { id: "cs_test_another" },
    { client_reference_id: "8aac986d-640a-4d6e-a31d-8342b974ee51" },
    { amount_total: 5000 },
    { currency: "usd" },
    { mode: "subscription" },
  ]) {
    assert.throws(
      () => inspectCheckoutEvent(event("checkout.session.completed", bad), order),
      CheckoutEventMismatch,
    );
  }
  assert.throws(
    () => inspectCheckoutEvent(event("checkout.session.completed"), {
      ...order,
      stripeSessionId: null,
    }),
    CheckoutEventMismatch,
  );
});

test("unrelated Stripe events and malformed order references cannot confirm", () => {
  const unrelated = event("payment_intent.succeeded");
  assert.deepEqual(inspectCheckoutEvent(unrelated, order), { kind: "pending" });
  assert.equal(checkoutOrderId(unrelated), null);
  assert.equal(
    checkoutOrderId(
      event("checkout.session.completed", { client_reference_id: "RK-123" }),
    ),
    null,
  );
});
