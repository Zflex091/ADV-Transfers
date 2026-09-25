import type { VercelRequest, VercelResponse } from "@vercel/node";
import { waitUntil } from "@vercel/functions";
import Stripe from "stripe";

import {
  CheckoutEventMismatch,
  checkoutOrderId,
  inspectCheckoutEvent,
  isRelevantCheckoutEvent,
} from "./_checkout-event.ts";
import { queueOwnerBookingEmail, sendOwnerBookingEmail } from "./_booking-notifications.ts";
import { findOrderBySessionId, markFailed, markPaid } from "./_orders.ts";

export const config = { api: { bodyParser: false } };

const MAX_WEBHOOK_BYTES = 1024 * 1024;

class WebhookBodyTooLarge extends Error {}

export async function readWebhookBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_WEBHOOK_BYTES) throw new WebhookBodyTooLarge();
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Leidžiamos tik POST užklausos." });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!stripeKey || !webhookSecret) {
    return res.status(503).json({ error: "Mokėjimų patvirtinimas nesukonfigūruotas." });
  }

  const signature = req.headers["stripe-signature"];
  if (typeof signature !== "string" || !signature) {
    return res.status(400).json({ error: "Neteisingas mokėjimo patvirtinimas." });
  }

  let body: Buffer;
  try {
    body = await readWebhookBody(req);
  } catch (error) {
    const status = error instanceof WebhookBodyTooLarge ? 413 : 400;
    return res.status(status).json({ error: "Neteisingas mokėjimo patvirtinimas." });
  }

  let event: Stripe.Event;
  try {
    const stripe = new Stripe(stripeKey);
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch {
    return res.status(400).json({ error: "Neteisingas mokėjimo patvirtinimas." });
  }

  if (!isRelevantCheckoutEvent(event.type)) {
    return res.status(200).json({ received: true });
  }

  const orderId = checkoutOrderId(event);
  const session = event.data.object as Stripe.Checkout.Session;
  if (!orderId || typeof session.id !== "string") {
    console.error("Stripe Checkout įvykiui trūksta užsakymo nuorodos", event.id);
    return res.status(400).json({ error: "Neteisingas mokėjimo patvirtinimas." });
  }

  try {
    const order = await findOrderBySessionId(session.id);
    if (!order) {
      // A saved order is mandatory. Ask Stripe to retry if its event arrived
      // before the Checkout Session was attached to our order.
      console.error("Stripe Checkout užsakymas nerastas", event.id);
      return res.status(503).json({ error: "Užsakymas dar neparuoštas." });
    }

    const decision = inspectCheckoutEvent(event, order);
    if (decision.kind === "paid") {
      const paid = await markPaid({
        orderId,
        sessionId: session.id,
        paymentIntentId: decision.paymentIntentId,
        amountCents: order.dueNowCents,
        currency: "eur",
      });
      if (!paid || paid.status !== "paid") {
        throw new Error("Stripe mokėjimo būsena neišsaugota");
      }
      if (!(await queueOwnerBookingEmail(paid.id))) {
        throw new Error("Apmokėto užsakymo laiško eilė neišsaugota");
      }
      waitUntil(
        sendOwnerBookingEmail(paid.id)
          .then((delivery) => {
            if (delivery === "failed") {
              console.error("Užsakymo laiškas laukia pakartotinio siuntimo", paid.id);
            }
          })
          .catch((emailError) => {
            // The paid order and queue entry are durable. The retry worker can
            // resume delivery without changing the Stripe confirmation.
            console.error("Užsakymo laiško siuntimo klaida", paid.id, emailError);
          }),
      );
    } else if (decision.kind === "failed") {
      const failed = await markFailed({
        orderId,
        sessionId: session.id,
        status: event.type === "checkout.session.expired" ? "cancelled" : "failed",
      });
      if (!failed) throw new Error("Stripe nesėkmės būsena neišsaugota");
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    if (error instanceof CheckoutEventMismatch) {
      console.error("Stripe Checkout įvykio ir užsakymo neatitikimas", event.id);
      return res.status(409).json({ error: "Mokėjimo duomenys neatitinka užsakymo." });
    }
    console.error("Stripe Checkout įvykio įrašymo klaida", event.id, error);
    return res.status(503).json({ error: "Mokėjimo patvirtinimas laikinai nepasiekiamas." });
  }
}
