import { createHash } from "node:crypto";

import {
  BUSINESS_TIME_ZONE,
  RESERVATION_SCHEMA_VERSION,
  calculatePaymentPlan,
  validateReservationDraft,
  type ReservationDraft,
  type SelectedPlace,
} from "../src/domain/booking.js";
import { getVerifiedFare } from "./_quote.js";

export class CheckoutRequestError extends Error {
  readonly status: 400 | 409;

  constructor(status: 400 | 409, message: string) {
    super(message);
    this.status = status;
    this.name = "CheckoutRequestError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string" || value.length > maximum) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function selectedPlace(value: unknown): SelectedPlace | null {
  if (!isRecord(value) || (value.provider !== "mapbox" && value.provider !== "google")) return null;
  const label = requiredText(value.label, 500);
  const providerPlaceId = requiredText(value.providerPlaceId, 512);
  if (
    !label ||
    !providerPlaceId ||
    typeof value.latitude !== "number" ||
    typeof value.longitude !== "number" ||
    !Number.isFinite(value.latitude) ||
    !Number.isFinite(value.longitude) ||
    Math.abs(value.latitude) > 90 ||
    Math.abs(value.longitude) > 180
  ) return null;
  return {
    provider: value.provider as "mapbox" | "google",
    providerPlaceId,
    label,
    latitude: value.latitude,
    longitude: value.longitude,
  };
}

export function prepareCheckoutRequest(input: unknown) {
  const fare = getVerifiedFare(input);
  if (!isRecord(input)) {
    throw new CheckoutRequestError(400, "Trūksta rezervacijos duomenų.");
  }

  const firstName = requiredText(input.firstName, 100);
  const lastName = requiredText(input.lastName, 100);
  const phone = requiredText(input.phone, 40);
  const email = requiredText(input.email, 254);
  const pickup = selectedPlace(input.pickup);
  const destination = selectedPlace(input.destination);
  const clientRequestId = input.clientRequestId;
  if (
    !firstName ||
    !lastName ||
    !phone ||
    phone.replace(/\D/g, "").length < 8 ||
    phone.replace(/\D/g, "").length > 15 ||
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !pickup ||
    !destination
  ) {
    throw new CheckoutRequestError(400, "Patikrinkite kontaktus ir adresus.");
  }
  if (
    typeof clientRequestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientRequestId)
  ) {
    throw new CheckoutRequestError(400, "Atnaujinkite rezervacijos formą ir bandykite dar kartą.");
  }
  if (input.paymentMethod !== "driver" && input.paymentMethod !== "stripe") {
    throw new CheckoutRequestError(400, "Pasirinkite mokėjimo būdą.");
  }

  const paymentMethod = input.paymentMethod === "driver" ? "pay-in-vehicle" : "online-full";
  const draft: ReservationDraft = {
    schemaVersion: RESERVATION_SCHEMA_VERSION,
    customer: { firstName, lastName, phone, email },
    pickup,
    destination,
    schedule: {
      localDate: input.date as string,
      localTime: input.time as string,
      timeZone: BUSINESS_TIME_ZONE,
      scheduledAtUtc: fare.scheduledAtUtc,
    },
    route: {
      provider: "mapbox",
      distanceMeters: fare.route.distanceMeters,
      durationSeconds: fare.route.durationSeconds,
      encodedPolyline: null,
    },
    party: { passengers: fare.passengers, standardLuggage: fare.luggage },
    vehicleId: fare.vehicle.id,
    vehicleModel: fare.vehicle.model,
    preferences: fare.preferences,
    pricing: fare.pricing,
    paymentMethod,
  };

  if (!validateReservationDraft(draft).valid) {
    throw new CheckoutRequestError(400, "Patikrinkite rezervacijos duomenis.");
  }

  const plan = calculatePaymentPlan(paymentMethod, fare.pricing.totalCents);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(draft), "utf8")
    .digest("hex");
  return { draft, plan, clientRequestId, fingerprint };
}
