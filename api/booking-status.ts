import type { VercelRequest, VercelResponse } from "@vercel/node";

import { getOrderForStatus } from "./_orders.js";

const ORDER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "X-Booking-Token");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Leidžiamos tik GET užklausos." });
  }

  const orderId = req.query.order_id;
  const token = req.headers["x-booking-token"];
  if (
    typeof orderId !== "string" ||
    !ORDER_ID_PATTERN.test(orderId) ||
    typeof token !== "string" ||
    !STATUS_TOKEN_PATTERN.test(token)
  ) {
    return res.status(404).json({ error: "Užsakymas nerastas." });
  }

  try {
    const order = await getOrderForStatus(orderId, token);
    if (!order) return res.status(404).json({ error: "Užsakymas nerastas." });

    return res.status(200).json({
      status: order.status,
      bookingCode: order.bookingCode,
      paymentMethod: order.paymentMethod,
      totalCents: order.totalCents,
      paidCents: order.paidCents,
      balanceCents: order.balanceCents,
      currency: order.currency,
    });
  } catch (error) {
    console.error("Užsakymo būsenos gavimo klaida", error);
    return res.status(503).json({ error: "Užsakymo būsena laikinai nepasiekiama." });
  }
}
