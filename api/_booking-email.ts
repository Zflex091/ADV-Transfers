import type { OrderRecord } from "./_orders.js";
import { BUSINESS_TIME_ZONE, VEHICLES } from "../src/domain/booking.js";

export type BookingEmail = Readonly<{
  subject: string;
  text: string;
  html: string;
}>;

type EmailRow = Readonly<{ label: string; value: string }>;
type EmailSection = Readonly<{ heading: string; rows: readonly EmailRow[] }>;

const LANGUAGE_NAMES = {
  lt: "Lietuvių",
  en: "Anglų",
  ru: "Rusų",
  pl: "Lenkų",
} as const;

function money(cents: number): string {
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

function decimal(value: number, fractionDigits: number): string {
  return new Intl.NumberFormat("lt-LT", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

function createdAtInVilnius(instant: string): string {
  return `${new Intl.DateTimeFormat("lt-LT", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant))} (${BUSINESS_TIME_ZONE})`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

function htmlValue(value: string): string {
  return escapeHtml(value).replace(/\r\n|\r|\n/g, "<br>");
}

function preferenceRows(order: OrderRecord): EmailRow[] {
  const preferences = order.bookingSnapshot.preferences;
  const rows: EmailRow[] = [];

  if (preferences.spotify.enabled) {
    rows.push({ label: "Play my Spotify music", value: "Taip" });
    if (preferences.spotify.preference.trim()) {
      rows.push({ label: "Muzikos pasirinkimas", value: preferences.spotify.preference });
    }
  }

  if (preferences.preferredLanguage.enabled && preferences.preferredLanguage.language) {
    const language = preferences.preferredLanguage.language;
    const value = language === "other"
      ? preferences.preferredLanguage.otherLanguage
      : LANGUAGE_NAMES[language];
    if (value.trim()) rows.push({ label: "Preferred language", value });
  }

  if (preferences.meetAndGreet.enabled) {
    rows.push({ label: "Meet me with a sign", value: "Taip" });
    if (preferences.meetAndGreet.signText.trim()) {
      rows.push({ label: "Užrašas lentoje", value: preferences.meetAndGreet.signText });
    }
  }

  if (preferences.driverComment.enabled && preferences.driverComment.text.trim()) {
    rows.push({ label: "Comment for driver", value: preferences.driverComment.text });
  }

  return rows;
}

/** Render only a Stripe-confirmed order; sending and deduplication happen elsewhere. */
export function renderOwnerBookingEmail(order: OrderRecord): BookingEmail {
  if (order.status !== "paid") {
    throw new Error("Patvirtinimo laišką galima rengti tik apmokėtam užsakymui.");
  }

  const draft = order.bookingSnapshot;
  const vehicle = VEHICLES[draft.vehicleId];
  const preferences = preferenceRows(order);
  const sections: EmailSection[] = [
    {
      heading: "Užsakymas",
      rows: [
        { label: "Užsakymo numeris", value: order.bookingCode },
        { label: "Unikalus ID", value: order.id },
        { label: "Būsena", value: "Patvirtinta · mokėjimas gautas" },
        { label: "Pateikta", value: createdAtInVilnius(order.createdAt) },
      ],
    },
    {
      heading: "Klientas",
      rows: [
        { label: "Vardas, pavardė", value: `${draft.customer.firstName} ${draft.customer.lastName}` },
        { label: "Telefonas", value: draft.customer.phone },
        { label: "El. paštas", value: draft.customer.email },
      ],
    },
    {
      heading: "Kelionė",
      rows: [
        { label: "Iš kur", value: draft.pickup.label },
        { label: "Kur", value: draft.destination.label },
        { label: "Paėmimas", value: `${draft.schedule.localDate} ${draft.schedule.localTime} (${draft.schedule.timeZone})` },
        { label: "Maršrutas", value: `${decimal(draft.route.distanceMeters / 1000, 2)} km · apie ${Math.ceil(draft.route.durationSeconds / 60)} min.` },
        { label: "Automobilio klasė", value: vehicle.className },
        { label: "Automobilio modelis", value: draft.vehicleModel },
        { label: "Keleiviai", value: String(draft.party.passengers) },
        { label: "Standartiniai lagaminai", value: String(draft.party.standardLuggage) },
      ],
    },
    {
      heading: "Kaina ir mokėjimas",
      rows: [
        { label: "Tarifas", value: `${money(draft.pricing.rateCentsPerKm)} / km` },
        { label: "Įsėdimo mokestis", value: money(draft.pricing.boardingFeeCents) },
        ...(draft.pricing.minimumAdjustmentCents > 0
          ? [{ label: "Minimalios kainos pritaikymas", value: money(draft.pricing.minimumAdjustmentCents) }]
          : []),
        { label: "Galutinė kelionės kaina", value: money(order.totalCents) },
        { label: "Mokėjimo būdas", value: order.paymentMethod === "pay-in-vehicle"
          ? "Avansas per Stripe, likutis automobilyje"
          : "Visa suma internetu per Stripe" },
        { label: "Iš anksto sumokėta per Stripe", value: money(order.paidCents) },
        { label: "Mokėti automobilyje", value: money(order.balanceCents) },
        { label: "Stripe mokėjimo būsena", value: "Apmokėta" },
        ...(order.stripeSessionId
          ? [{ label: "Stripe Checkout Session ID", value: order.stripeSessionId }]
          : []),
        ...(order.stripePaymentIntentId
          ? [{ label: "Stripe PaymentIntent ID", value: order.stripePaymentIntentId }]
          : []),
      ],
    },
    ...(preferences.length ? [{ heading: "Papildomi pageidavimai", rows: preferences }] : []),
  ];

  const subject = `ADV užsakymas ${order.bookingCode.replace(/[^A-Za-z0-9-]/g, "")} – patvirtintas`;
  const text = [
    `Nauja patvirtinta ADV Transfers rezervacija: ${order.bookingCode}`,
    ...sections.flatMap(({ heading, rows }) => [
      "",
      heading.toUpperCase(),
      ...rows.map(({ label, value }) => `${label}: ${value}`),
    ]),
  ].join("\n");

  const htmlSections = sections.map(({ heading, rows }) => `
    <tr><td style="padding:24px 28px 9px;font:700 16px Arial,sans-serif;color:#183a32;">${escapeHtml(heading)}</td></tr>
    ${rows.map(({ label, value }) => `
      <tr><td style="padding:7px 28px;vertical-align:top;">
        <div style="font:600 11px Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#5a6c66;">${escapeHtml(label)}</div>
        <div style="margin-top:3px;font:15px/1.5 Arial,sans-serif;color:#12231e;overflow-wrap:anywhere;word-break:break-word;">${htmlValue(value)}</div>
      </td></tr>`).join("")}`).join("");

  const html = `<!doctype html>
<html lang="lt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:16px;background:#f3f5f1;color:#12231e;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #d9e0d9;border-collapse:separate;">
    <tr><td style="padding:27px 28px 22px;background:#183a32;color:#fff;">
      <div style="font:700 12px Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#d3e6db;">ADV Transfers</div>
      <div style="margin-top:9px;font:700 24px/1.25 Arial,sans-serif;">Nauja patvirtinta rezervacija</div>
      <div style="margin-top:8px;font:14px Arial,sans-serif;color:#e3f0e8;overflow-wrap:anywhere;">${escapeHtml(order.bookingCode)}</div>
    </td></tr>
    ${htmlSections}
    <tr><td style="padding:22px 28px 28px;font:12px/1.5 Arial,sans-serif;color:#66766f;">Šis laiškas parengtas po patvirtinto Stripe mokėjimo.</td></tr>
  </table>
</body></html>`;

  return { subject, text, html };
}
