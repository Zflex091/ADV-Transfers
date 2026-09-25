import type Stripe from "stripe";

export interface ExpectedCheckout {
  id: string;
  stripeSessionId: string | null;
  dueNowCents: number;
  currency: string;
}

export type CheckoutEventDecision =
  | { kind: "paid"; paymentIntentId: string | null }
  | { kind: "failed"; paymentIntentId: string | null }
  | { kind: "pending" };

export class CheckoutEventMismatch extends Error {
  constructor() {
    super("Stripe įvykis neatitinka saugomo užsakymo.");
    this.name = "CheckoutEventMismatch";
  }
}

const RELEVANT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);

export function isRelevantCheckoutEvent(type: string) {
  return RELEVANT_TYPES.has(type);
}

export function checkoutOrderId(event: Stripe.Event): string | null {
  if (!isRelevantCheckoutEvent(event.type)) return null;
  const session = event.data.object as Stripe.Checkout.Session;
  return session.object === "checkout.session" &&
    typeof session.client_reference_id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      session.client_reference_id,
    )
    ? session.client_reference_id
    : null;
}

export function inspectCheckoutEvent(
  event: Stripe.Event,
  expected: ExpectedCheckout,
): CheckoutEventDecision {
  if (!isRelevantCheckoutEvent(event.type)) return { kind: "pending" };
  const session = event.data.object as Stripe.Checkout.Session;
  if (
    session.object !== "checkout.session" ||
    !expected.stripeSessionId ||
    session.id !== expected.stripeSessionId ||
    session.client_reference_id !== expected.id ||
    session.mode !== "payment" ||
    session.currency !== expected.currency ||
    session.amount_total !== expected.dueNowCents
  ) {
    throw new CheckoutEventMismatch();
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  if (
    (event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded") &&
    session.payment_status === "paid" &&
    session.status === "complete"
  ) {
    return { kind: "paid", paymentIntentId };
  }

  if (
    (event.type === "checkout.session.async_payment_failed" ||
      event.type === "checkout.session.expired") &&
    session.payment_status === "unpaid"
  ) {
    return { kind: "failed", paymentIntentId };
  }

  return { kind: "pending" };
}
