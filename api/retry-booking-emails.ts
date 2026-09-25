import { createHash, timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";

import { processPendingBookingEmails } from "./_booking-notifications.ts";

const BATCH_SIZE = 2;

function authorized(header: string | string[] | undefined, secret: string): boolean {
  if (typeof header !== "string") return false;
  const actual = createHash("sha256").update(header, "utf8").digest();
  const expected = createHash("sha256").update(`Bearer ${secret}`, "utf8").digest();
  return timingSafeEqual(actual, expected);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret || !secret.trim()) {
    console.error("Booking email retry disabled: CRON_SECRET is missing");
    return res.status(503).json({ error: "Retry unavailable" });
  }
  if (!authorized(req.headers.authorization, secret)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await processPendingBookingEmails(BATCH_SIZE);
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error("Booking email retry failed", error);
    return res.status(503).json({ error: "Retry unavailable" });
  }
}
