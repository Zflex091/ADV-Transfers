import {
  VEHICLES,
  calculatePricing,
  getVehicleCapacity,
  isVehicleId,
  parseTripPreferences,
  type PricingSnapshot,
  type VehicleId,
} from "../src/domain/booking.js";
import { ScheduleError, validatePickupSchedule } from "../src/domain/schedule.js";
import { placeMatchesVerifiedToken } from "./_place-token.js";
import {
  placeMatchesRoutePoint,
  verifyRouteToken,
  type RouteTokenClaims,
} from "./_route-token.js";

export type VehicleQuote = Readonly<{
  vehicleId: VehicleId;
  className: string;
  model: string;
  capacity: ReturnType<typeof getVehicleCapacity>;
  pricing: PricingSnapshot | null;
}>;

export class QuoteRequestError extends Error {
  public readonly status: 400 | 422;

  constructor(
    status: 400 | 422,
    message: string,
  ) {
    super(message);
    this.status = status;
    this.name = "QuoteRequestError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseParty(input: Record<string, unknown>) {
  const passengers = input.passengers;
  const luggage = input.luggage;
  if (
    !Number.isInteger(passengers) ||
    Number(passengers) < 1 ||
    Number(passengers) > 20 ||
    !Number.isInteger(luggage) ||
    Number(luggage) < 0 ||
    Number(luggage) > 30
  ) {
    throw new QuoteRequestError(400, "Neteisingas keleivių arba lagaminų skaičius.");
  }
  return { passengers: passengers as number, luggage: luggage as number };
}

function parseToken(input: Record<string, unknown>, nowMs = Date.now()): RouteTokenClaims {
  const route = verifyRouteToken(input.routeToken, nowMs);
  if (!route) {
    throw new QuoteRequestError(
      400,
      "Maršrutas nebegalioja. Perskaičiuokite maršrutą ir bandykite dar kartą.",
    );
  }
  return route;
}

export function getVehicleQuotes(input: unknown) {
  if (!isRecord(input)) {
    throw new QuoteRequestError(400, "Trūksta kelionės duomenų.");
  }
  const route = parseToken(input);
  const { passengers, luggage } = parseParty(input);
  const vehicles = (Object.keys(VEHICLES) as VehicleId[]).map((vehicleId) => {
    const vehicle = VEHICLES[vehicleId];
    const capacity = getVehicleCapacity(vehicleId, passengers, luggage);
    return {
      vehicleId,
      className: vehicle.className,
      model: vehicle.model,
      capacity,
      pricing: capacity.available
        ? calculatePricing(vehicleId, route.distanceMeters)
        : null,
    } satisfies VehicleQuote;
  });

  return {
    route: {
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
    },
    vehicles,
  };
}

export function getVerifiedFare(input: unknown, nowMs = Date.now()) {
  if (!isRecord(input)) {
    throw new QuoteRequestError(400, "Trūksta kelionės duomenų.");
  }
  const route = parseToken(input, nowMs);
  const { passengers, luggage } = parseParty(input);
  const parsedPreferences = parseTripPreferences(input.preferences);
  if (parsedPreferences.issues.length > 0) {
    const first = parsedPreferences.issues[0];
    throw new QuoteRequestError(
      400,
      first.code === "required"
        ? "Užpildykite pasirinkto kelionės pageidavimo lauką."
        : "Patikrinkite papildomus kelionės pageidavimus.",
    );
  }

  if (!isVehicleId(input.vehicleId)) {
    throw new QuoteRequestError(400, "Pasirinkite automobilį.");
  }
  const vehicleId = input.vehicleId;
  const capacity = getVehicleCapacity(vehicleId, passengers, luggage);
  if (!capacity.available) {
    throw new QuoteRequestError(
      422,
      "Pasirinktas automobilis netinka keleivių ir lagaminų skaičiui.",
    );
  }
  if (
    !placeMatchesVerifiedToken(input.pickup, nowMs) ||
    !placeMatchesVerifiedToken(input.destination, nowMs)
  ) {
    throw new QuoteRequestError(
      400,
      "Adresų patvirtinimas nebegalioja. Pasirinkite abu adresus iš naujo.",
    );
  }
  if (
    !placeMatchesRoutePoint(input.pickup, route.origin) ||
    !placeMatchesRoutePoint(input.destination, route.destination)
  ) {
    throw new QuoteRequestError(
      400,
      "Adresai pasikeitė. Perskaičiuokite maršrutą ir kainą.",
    );
  }

  if (typeof input.date !== "string" || typeof input.time !== "string") {
    throw new QuoteRequestError(400, "Pasirinkite paėmimo datą ir laiką.");
  }
  let scheduledAtUtc: string;
  try {
    scheduledAtUtc = validatePickupSchedule(
      input.date,
      input.time,
      nowMs,
    ).scheduledAtUtc;
  } catch (error) {
    if (!(error instanceof ScheduleError)) throw error;
    throw new QuoteRequestError(
      error.code === "too-soon" ? 422 : 400,
      error.message,
    );
  }

  const pricing = calculatePricing(vehicleId, route.distanceMeters);
  if (
    input.price !== undefined &&
    (typeof input.price !== "number" ||
      !Number.isFinite(input.price) ||
      Math.round(input.price * 100) !== pricing.totalCents)
  ) {
    throw new QuoteRequestError(
      400,
      "Kaina pasikeitė. Atnaujinkite kelionės suvestinę.",
    );
  }

  return {
    route,
    vehicle: VEHICLES[vehicleId],
    capacity,
    pricing,
    passengers,
    luggage,
    scheduledAtUtc,
    preferences: parsedPreferences.preferences,
  };
}
