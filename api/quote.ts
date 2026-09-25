import type { VercelRequest, VercelResponse } from "@vercel/node";

import { consumeRateLimit } from "./_google-maps.ts";
import { getVehicleQuotes, QuoteRequestError } from "./_quote.ts";

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Leidžiamos tik POST užklausos." });
  }

  const rateLimit = consumeRateLimit(
    req.headers,
    req.socket.remoteAddress,
    "quotes",
    60,
  );
  if (!rateLimit.allowed) {
    res.setHeader(
      "Retry-After",
      String(Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000))),
    );
    return res.status(429).json({
      error: "Per daug kainos skaičiavimo užklausų. Palaukite minutę.",
    });
  }

  try {
    return res.status(200).json(getVehicleQuotes(req.body));
  } catch (error) {
    if (error instanceof QuoteRequestError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error("Kainos skaičiavimo klaida", error);
    return res.status(500).json({ error: "Kainos apskaičiuoti nepavyko." });
  }
}
