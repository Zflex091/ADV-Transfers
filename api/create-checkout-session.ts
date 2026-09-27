import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";

import { consumeRateLimit } from "./_mapbox.js";
import { CheckoutRequestError, prepareCheckoutRequest } from "./_checkout-data.js";
import {
  OrderConflictError,
  attachCheckoutSession,
  claimCheckoutCreation,
  createOrGetPendingOrder,
  getOrderById,
  releaseCheckoutCreation,
  type OrderRecord,
} from "./_orders.js";
import { QuoteRequestError } from "./_quote.js";
import { sendOwnerBookingEmail } from "./_booking-notifications.js";

function siteBaseUrl(): string | null {
  const configured = process.env.PUBLIC_SITE_URL?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "localhost")) {
      return url.origin;
    }
  } catch {
    return null;
  }
  return null;
}

function checkoutResponse(order: OrderRecord, statusToken: string) {
  return {
    url: order.stripeSessionUrl,
    orderId: order.id,
    statusToken,
    bookingCode: order.bookingCode,
    totalCents: order.totalCents,
    dueNowCents: order.dueNowCents,
    balanceCents: order.balanceCents,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Leidžiamos tik POST užklausos." });
  }
  if (!process.env.DATABASE_URL || !process.env.ORDER_STATUS_SECRET) {
    return res.status(503).json({ error: "Rezervacijų sistema dar nesukonfigūruota." });
  }

  const rateLimit = consumeRateLimit(req.headers, req.socket?.remoteAddress, "checkout", 10);
  if (!rateLimit.allowed) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000))));
    return res.status(429).json({ error: "Per daug mokėjimo bandymų. Palaukite minutę." });
  }

  let claimedOrderId: string | null = null;
  let payInVehicleRequest = false;
  try {
    // The route token, capacity, schedule and price are all rechecked on the server.
    const request = prepareCheckoutRequest(req.body);
    payInVehicleRequest = request.plan.method === "pay-in-vehicle";
    const { order: initialOrder, statusToken } = await createOrGetPendingOrder({
      clientRequestId: request.clientRequestId,
      requestHash: request.fingerprint,
      draft: request.draft,
      paymentPlan: request.plan,
    });

    if (initialOrder.paymentMethod === "pay-in-vehicle") {
      if (initialOrder.status !== "pending") {
        return res.status(409).json({
          error: "Ši rezervacijos užklausa jau apdorota. Jei reikia pagalbos, susisiekite su mumis.",
          orderId: initialOrder.id,
          statusToken,
        });
      }

      try {
        const delivery = await sendOwnerBookingEmail(initialOrder.id);
        if (delivery === "failed") {
          console.warn("Pay-in-vehicle booking email queued for retry", initialOrder.id);
        }
      } catch (notificationError) {
        console.error("Pay-in-vehicle booking notification error", notificationError);
      }

      return res.status(200).json({
        bookingReceived: true,
        url: null,
        orderId: initialOrder.id,
        statusToken,
        bookingCode: initialOrder.bookingCode,
        totalCents: initialOrder.totalCents,
        dueNowCents: initialOrder.dueNowCents,
        balanceCents: initialOrder.balanceCents,
      });
    }

    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
      return res.status(503).json({ error: "Mokėjimai per Stripe dar nesukonfigūruoti." });
    }
    const base = siteBaseUrl();
    if (!base) {
      return res.status(503).json({ error: "Svetainės mokėjimo adresas nesukonfigūruotas." });
    }

    if (initialOrder.status !== "pending") {
      return res.status(409).json({
        error: initialOrder.status === "paid"
          ? "Ši rezervacija jau apmokėta. Patikrinkite jos būseną."
          : "Ankstesnis mokėjimo bandymas baigtas. Pradėkite naują bandymą.",
        orderId: initialOrder.id,
        statusToken,
      });
    }
    if (initialOrder.stripeSessionId && initialOrder.stripeSessionUrl) {
      return res.status(200).json(checkoutResponse(initialOrder, statusToken));
    }

    const claimed = await claimCheckoutCreation(initialOrder.id);
    if (!claimed) {
      const current = await getOrderById(initialOrder.id);
      if (current?.stripeSessionId && current.stripeSessionUrl) {
        return res.status(200).json(checkoutResponse(current, statusToken));
      }
      res.setHeader("Retry-After", "2");
      return res.status(409).json({ error: "Mokėjimo nuoroda ruošiama. Bandykite dar kartą po kelių sekundžių." });
    }
    claimedOrderId = initialOrder.id;

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: initialOrder.id,
        line_items: [{
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: initialOrder.dueNowCents,
            product_data: {
              name: "ADV Services privatus pervežimas",
              description: "Visa kelionės kaina sumokama internetu.",
            },
          },
        }],
        success_url: `${base}/?checkout=success&order_id=${encodeURIComponent(initialOrder.id)}`,
        cancel_url: `${base}/?checkout=cancelled&order_id=${encodeURIComponent(initialOrder.id)}`,
        metadata: { order_id: initialOrder.id },
      },
      { idempotencyKey: `adv-order-${initialOrder.id}` },
    );
    if (!session.url) throw new Error("Stripe negeneravo mokėjimo nuorodos.");
    const saved = await attachCheckoutSession(initialOrder.id, session.id, session.url);
    if (!saved) throw new Error("Nepavyko susieti mokėjimo su užsakymu.");
    return res.status(200).json(checkoutResponse(saved, statusToken));
  } catch (error) {
    if (claimedOrderId) {
      await releaseCheckoutCreation(claimedOrderId).catch(() => undefined);
    }
    if (error instanceof QuoteRequestError || error instanceof CheckoutRequestError) {
      return res.status(error.status).json({ error: error.message });
    }
    if (error instanceof OrderConflictError) {
      return res.status(409).json({ error: "Rezervacijos duomenys pasikeitė. Bandykite dar kartą." });
    }
    console.error(payInVehicleRequest ? "Rezervacijos kūrimo klaida" : "Stripe Checkout klaida", error);
    return res.status(502).json({
      error: payInVehicleRequest
        ? "Rezervacijos sukurti nepavyko. Bandykite dar kartą."
        : "Mokėjimo pradėti nepavyko. Bandykite dar kartą.",
    });
  }
}
