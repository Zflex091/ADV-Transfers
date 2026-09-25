import type { VercelRequest, VercelResponse } from "@vercel/node";

// Kept as an explicit response for older site versions. The only active
// reservation path is Stripe Checkout followed by a verified webhook.
export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Leidžiamos tik POST užklausos." });
  }
  return res.status(410).json({
    error: "Rezervacija patvirtinama tik po sėkmingo mokėjimo per „Stripe“. Atnaujinkite svetainę ir bandykite dar kartą.",
  });
}
