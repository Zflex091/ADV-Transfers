export const RESERVATION_SCHEMA_VERSION = 2 as const;
export const BUSINESS_TIME_ZONE = "Europe/Vilnius" as const;
export const CURRENCY = "EUR" as const;
export const MINIMUM_LEAD_TIME_MINUTES = 30;
export const DRIVER_ADVANCE_CENTS = 50;

export type VehicleId = "economy" | "executive-minivan";

export type VehicleDefinition = Readonly<{
  id: VehicleId;
  className: "Economy" | "Executive Minivan";
  model: string;
  rateCentsPerKm: number;
  boardingFeeCents: number;
  minimumFareCents: number;
  maximumPassengers: number;
  maximumLuggage: number;
}>;

export const VEHICLES: Readonly<Record<VehicleId, VehicleDefinition>> = {
  economy: {
    id: "economy",
    className: "Economy",
    model: "Opel Astra ST Black Edition 2025",
    rateCentsPerKm: 220,
    boardingFeeCents: 300,
    minimumFareCents: 2500,
    maximumPassengers: 4,
    maximumLuggage: 4,
  },
  "executive-minivan": {
    id: "executive-minivan",
    className: "Executive Minivan",
    model: "Chrysler Pacifica 2024",
    rateCentsPerKm: 250,
    boardingFeeCents: 300,
    minimumFareCents: 2500,
    maximumPassengers: 6,
    maximumLuggage: 8,
  },
};

export function isVehicleId(value: unknown): value is VehicleId {
  return value === "economy" || value === "executive-minivan";
}

export type CapacityReason =
  | "available"
  | "invalid-passenger-count"
  | "invalid-luggage-count"
  | "passenger-limit"
  | "luggage-limit"
  | "unsupported-combination";

export type CapacityResult = Readonly<{
  available: boolean;
  reason: CapacityReason;
}>;

export function getVehicleCapacity(
  vehicleId: VehicleId,
  passengers: number,
  luggage: number,
): CapacityResult {
  if (!Number.isInteger(passengers) || passengers < 1) {
    return { available: false, reason: "invalid-passenger-count" };
  }

  if (!Number.isInteger(luggage) || luggage < 0) {
    return { available: false, reason: "invalid-luggage-count" };
  }

  const vehicle = VEHICLES[vehicleId];

  if (passengers > vehicle.maximumPassengers) {
    return { available: false, reason: "passenger-limit" };
  }

  if (luggage > vehicle.maximumLuggage) {
    return { available: false, reason: "luggage-limit" };
  }

  if (vehicleId === "economy") {
    return { available: true, reason: "available" };
  }

  // Chrysler talpa patvirtinta dviem aiškioms zonoms:
  // iki 4 keleivių su iki 8 lagaminų arba 5–6 keleiviams su iki 4.
  // Todėl 5 + 5 kol kas sąmoningai neleidžiama.
  if (passengers <= 4 || luggage <= 4) {
    return { available: true, reason: "available" };
  }

  return { available: false, reason: "unsupported-combination" };
}

export function getCompatibleVehicleIds(
  passengers: number,
  luggage: number,
): VehicleId[] {
  return (Object.keys(VEHICLES) as VehicleId[]).filter(
    (vehicleId) =>
      getVehicleCapacity(vehicleId, passengers, luggage).available,
  );
}

export type PricingSnapshot = Readonly<{
  ruleVersion: "adv-v2";
  currency: typeof CURRENCY;
  vehicleId: VehicleId;
  distanceMeters: number;
  rateCentsPerKm: number;
  boardingFeeCents: number;
  routeChargeCents: number;
  subtotalCents: number;
  minimumFareCents: number;
  minimumAdjustmentCents: number;
  baseFareCents: number;
  extrasCents: 0;
  totalCents: number;
}>;

export function calculatePricing(
  vehicleId: VehicleId,
  distanceMeters: number,
): PricingSnapshot {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    throw new RangeError("distanceMeters must be a non-negative number");
  }

  const normalizedDistanceMeters = Math.round(distanceMeters);
  const vehicle = VEHICLES[vehicleId];
  const routeChargeCents = Math.round(
    (normalizedDistanceMeters * vehicle.rateCentsPerKm) / 1000,
  );
  const subtotalCents = vehicle.boardingFeeCents + routeChargeCents;
  const baseFareCents = Math.max(
    vehicle.minimumFareCents,
    subtotalCents,
  );

  return {
    ruleVersion: "adv-v2",
    currency: CURRENCY,
    vehicleId,
    distanceMeters: normalizedDistanceMeters,
    rateCentsPerKm: vehicle.rateCentsPerKm,
    boardingFeeCents: vehicle.boardingFeeCents,
    routeChargeCents,
    subtotalCents,
    minimumFareCents: vehicle.minimumFareCents,
    minimumAdjustmentCents: baseFareCents - subtotalCents,
    baseFareCents,
    extrasCents: 0,
    totalCents: baseFareCents,
  };
}

export type PaymentMethod = "online-full" | "pay-in-vehicle";

export type PaymentPlan = Readonly<{
  method: PaymentMethod;
  currency: typeof CURRENCY;
  totalCents: number;
  amountDueNowCents: number;
  remainingAfterSuccessfulPaymentCents: number;
}>;

export function calculatePaymentPlan(
  method: PaymentMethod,
  totalCents: number,
): PaymentPlan {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new RangeError("totalCents must be a non-negative integer");
  }

  const amountDueNowCents =
    method === "online-full"
      ? totalCents
      : Math.min(DRIVER_ADVANCE_CENTS, totalCents);

  return {
    method,
    currency: CURRENCY,
    totalCents,
    amountDueNowCents,
    remainingAfterSuccessfulPaymentCents:
      totalCents - amountDueNowCents,
  };
}

export type PlaceProvider = "nominatim" | "google" | "legacy";

export type SelectedPlace = Readonly<{
  provider: PlaceProvider;
  providerPlaceId: string;
  label: string;
  latitude: number;
  longitude: number;
}>;

export type RouteSnapshot = Readonly<{
  provider: "osrm" | "google" | "legacy";
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline: string | null;
}>;

export type PickupSchedule = Readonly<{
  localDate: string;
  localTime: string;
  timeZone: typeof BUSINESS_TIME_ZONE;
  scheduledAtUtc: string;
}>;

export type CustomerDetails = Readonly<{
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
}>;

export type PartyDetails = Readonly<{
  passengers: number;
  standardLuggage: number;
}>;

export type SpotifyPreference = Readonly<{
  enabled: boolean;
  preference: string;
}>;

export type PreferredLanguageCode = "lt" | "en" | "ru" | "pl" | "other";

export type PreferredLanguage = Readonly<{
  enabled: boolean;
  language: PreferredLanguageCode | null;
  otherLanguage: string;
}>;

export type MeetAndGreet = Readonly<{
  enabled: boolean;
  signText: string;
}>;

export type DriverComment = Readonly<{
  enabled: boolean;
  text: string;
}>;

export type TripPreferences = Readonly<{
  spotify: SpotifyPreference;
  preferredLanguage: PreferredLanguage;
  meetAndGreet: MeetAndGreet;
  driverComment: DriverComment;
}>;

export type ReservationDraft = Readonly<{
  schemaVersion: typeof RESERVATION_SCHEMA_VERSION;
  customer: CustomerDetails;
  pickup: SelectedPlace;
  destination: SelectedPlace;
  schedule: PickupSchedule;
  route: RouteSnapshot;
  party: PartyDetails;
  vehicleId: VehicleId;
  vehicleModel: string;
  preferences: TripPreferences;
  pricing: PricingSnapshot;
  paymentMethod: PaymentMethod;
}>;

export type ReservationStatus =
  | "pending-payment"
  | "confirmed"
  | "payment-failed"
  | "cancelled";

export type ReservationPaymentStatus =
  | "pending"
  | "paid"
  | "failed"
  | "cancelled";

export type PaymentSnapshot = Readonly<{
  method: PaymentMethod;
  status: ReservationPaymentStatus;
  currency: typeof CURRENCY;
  amountDueNowCents: number;
  paidCents: number;
  remainingInVehicleCents: number;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
}>;

export type ReservationRecord = Readonly<{
  schemaVersion: typeof RESERVATION_SCHEMA_VERSION;
  id: string;
  createdAt: string;
  updatedAt: string;
  status: ReservationStatus;
  customer: CustomerDetails;
  pickup: SelectedPlace;
  destination: SelectedPlace;
  schedule: PickupSchedule;
  route: RouteSnapshot;
  party: PartyDetails;
  vehicleId: VehicleId;
  vehicleModel: string;
  preferences: TripPreferences;
  pricing: PricingSnapshot;
  payment: PaymentSnapshot;
  confirmationEmailSentAt: string | null;
}>;

export type LegacyPlace = Readonly<{
  label: string;
  lat: number;
  lon: number;
}>;

export type LegacyBooking = Readonly<{
  pickup: LegacyPlace | null;
  destination: LegacyPlace | null;
  date: string;
  time: string;
  passengers: number;
  luggage: number;
  firstName: string;
  lastName: string;
  phone: string;
  paymentMethod: "driver" | "stripe";
  distanceKm: number;
  durationMin: number;
  price: number;
}>;

export type StoredReservation =
  | ReservationRecord
  | Readonly<{
      schemaVersion: 1;
      legacyPayload: LegacyBooking;
    }>;

export function wrapLegacyBooking(
  legacyPayload: LegacyBooking,
): StoredReservation {
  return {
    schemaVersion: 1,
    legacyPayload,
  };
}

export function createEmptyPreferences(): TripPreferences {
  return {
    spotify: { enabled: false, preference: "" },
    preferredLanguage: {
      enabled: false,
      language: null,
      otherLanguage: "",
    },
    meetAndGreet: { enabled: false, signText: "" },
    driverComment: { enabled: false, text: "" },
  };
}

export type ValidationIssue = Readonly<{
  path: string;
  code: string;
}>;

export const PREFERENCE_TEXT_LIMITS = {
  spotify: 500,
  otherLanguage: 100,
  meetSign: 150,
  driverComment: 1000,
} as const;

export type ParsedTripPreferences = Readonly<{
  preferences: TripPreferences;
  issues: ValidationIssue[];
}>;

function isPreferredLanguageCode(value: unknown): value is PreferredLanguageCode {
  return value === "lt" || value === "en" || value === "ru" || value === "pl" || value === "other";
}

/** Missing preferences are accepted for bookings started before this step existed. */
export function parseTripPreferences(input: unknown): ParsedTripPreferences {
  const empty = createEmptyPreferences();
  if (input === undefined) return { preferences: empty, issues: [] };
  if (!isRecord(input)) {
    return { preferences: empty, issues: [{ path: "preferences", code: "invalid" }] };
  }

  const issues: ValidationIssue[] = [];
  function textField(value: unknown, path: string, maximum: number, multiline = false): string {
    if (typeof value !== "string" || value.length > maximum) {
      issues.push({ path, code: "invalid" });
      return "";
    }
    // Only a driver's note may contain line breaks. Never forward control characters.
    const forbidden = multiline
      ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
      : /[\u0000-\u001F\u007F]/;
    if (forbidden.test(value)) {
      issues.push({ path, code: "invalid" });
      return "";
    }
    return multiline ? value.replace(/\r\n?/g, "\n").trim() : value.trim();
  }
  function section(value: unknown, path: string): Record<string, unknown> | null {
    if (!isRecord(value) || typeof value.enabled !== "boolean") {
      issues.push({ path, code: "invalid" });
      return null;
    }
    return value;
  }

  let spotify = empty.spotify;
  const rawSpotify = section(input.spotify, "preferences.spotify");
  if (rawSpotify) {
    const preference = textField(rawSpotify.preference, "preferences.spotify.preference", PREFERENCE_TEXT_LIMITS.spotify);
    spotify = rawSpotify.enabled === true ? { enabled: true, preference } : empty.spotify;
  }

  let preferredLanguage = empty.preferredLanguage;
  const rawLanguage = section(input.preferredLanguage, "preferences.preferredLanguage");
  if (rawLanguage) {
    const language = rawLanguage.language;
    if (language !== null && !isPreferredLanguageCode(language)) {
      issues.push({ path: "preferences.preferredLanguage.language", code: "invalid" });
    }
    const otherLanguage = textField(rawLanguage.otherLanguage, "preferences.preferredLanguage.otherLanguage", PREFERENCE_TEXT_LIMITS.otherLanguage);
    if (rawLanguage.enabled === true) {
      if (language === null) {
        issues.push({ path: "preferences.preferredLanguage.language", code: "required" });
      } else if (language === "other" && !otherLanguage) {
        issues.push({ path: "preferences.preferredLanguage.otherLanguage", code: "required" });
      }
      if (isPreferredLanguageCode(language)) {
        preferredLanguage = { enabled: true, language, otherLanguage: language === "other" ? otherLanguage : "" };
      }
    }
  }

  let meetAndGreet = empty.meetAndGreet;
  const rawMeet = section(input.meetAndGreet, "preferences.meetAndGreet");
  if (rawMeet) {
    const signText = textField(rawMeet.signText, "preferences.meetAndGreet.signText", PREFERENCE_TEXT_LIMITS.meetSign);
    if (rawMeet.enabled === true && !signText) {
      issues.push({ path: "preferences.meetAndGreet.signText", code: "required" });
    }
    meetAndGreet = rawMeet.enabled === true ? { enabled: true, signText } : empty.meetAndGreet;
  }

  let driverComment = empty.driverComment;
  const rawComment = section(input.driverComment, "preferences.driverComment");
  if (rawComment) {
    const commentText = textField(rawComment.text, "preferences.driverComment.text", PREFERENCE_TEXT_LIMITS.driverComment, true);
    driverComment = rawComment.enabled === true ? { enabled: true, text: commentText } : empty.driverComment;
  }

  // Disabled sections are validated, then erased so hidden stale text is never active.
  return { preferences: { spotify, preferredLanguage, meetAndGreet, driverComment }, issues };
}

export type ReservationValidation = Readonly<{
  valid: boolean;
  issues: ValidationIssue[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, maximum = 300): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= maximum
  );
}

function isSelectedPlace(value: unknown): value is SelectedPlace {
  if (!isRecord(value)) return false;

  return (
    ["nominatim", "google", "legacy"].includes(String(value.provider)) &&
    isNonEmptyString(value.providerPlaceId, 300) &&
    isNonEmptyString(value.label, 500) &&
    typeof value.latitude === "number" &&
    value.latitude >= -90 &&
    value.latitude <= 90 &&
    typeof value.longitude === "number" &&
    value.longitude >= -180 &&
    value.longitude <= 180
  );
}

function samePricing(
  actual: unknown,
  expected: PricingSnapshot,
): boolean {
  if (!isRecord(actual)) return false;

  return (
    actual.ruleVersion === expected.ruleVersion &&
    actual.currency === expected.currency &&
    actual.vehicleId === expected.vehicleId &&
    actual.distanceMeters === expected.distanceMeters &&
    actual.rateCentsPerKm === expected.rateCentsPerKm &&
    actual.boardingFeeCents === expected.boardingFeeCents &&
    actual.routeChargeCents === expected.routeChargeCents &&
    actual.subtotalCents === expected.subtotalCents &&
    actual.minimumFareCents === expected.minimumFareCents &&
    actual.minimumAdjustmentCents === expected.minimumAdjustmentCents &&
    actual.baseFareCents === expected.baseFareCents &&
    actual.extrasCents === 0 &&
    actual.totalCents === expected.totalCents
  );
}

export function validateReservationDraft(
  input: unknown,
): ReservationValidation {
  const issues: ValidationIssue[] = [];

  if (!isRecord(input)) {
    return {
      valid: false,
      issues: [{ path: "$", code: "invalid-object" }],
    };
  }

  if (input.schemaVersion !== RESERVATION_SCHEMA_VERSION) {
    issues.push({ path: "schemaVersion", code: "unsupported-version" });
  }

  const customer = input.customer;
  if (!isRecord(customer)) {
    issues.push({ path: "customer", code: "required" });
  } else {
    if (!isNonEmptyString(customer.firstName, 100))
      issues.push({ path: "customer.firstName", code: "invalid" });
    if (!isNonEmptyString(customer.lastName, 100))
      issues.push({ path: "customer.lastName", code: "invalid" });
    if (
      typeof customer.phone !== "string" ||
      customer.phone.replace(/\D/g, "").length < 8 ||
      customer.phone.replace(/\D/g, "").length > 15
    )
      issues.push({ path: "customer.phone", code: "invalid" });
    if (
      typeof customer.email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email) ||
      customer.email.length > 254
    )
      issues.push({ path: "customer.email", code: "invalid" });
  }

  if (!isSelectedPlace(input.pickup))
    issues.push({ path: "pickup", code: "invalid-place" });
  if (!isSelectedPlace(input.destination))
    issues.push({ path: "destination", code: "invalid-place" });

  const schedule = input.schedule;
  if (!isRecord(schedule)) {
    issues.push({ path: "schedule", code: "required" });
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(schedule.localDate)))
      issues.push({ path: "schedule.localDate", code: "invalid" });
    if (!/^\d{2}:\d{2}$/.test(String(schedule.localTime)))
      issues.push({ path: "schedule.localTime", code: "invalid" });
    if (schedule.timeZone !== BUSINESS_TIME_ZONE)
      issues.push({ path: "schedule.timeZone", code: "invalid" });
    if (
      typeof schedule.scheduledAtUtc !== "string" ||
      !Number.isFinite(Date.parse(schedule.scheduledAtUtc))
    )
      issues.push({ path: "schedule.scheduledAtUtc", code: "invalid" });
  }

  const route = input.route;
  let distanceMeters: number | null = null;
  if (!isRecord(route)) {
    issues.push({ path: "route", code: "required" });
  } else {
    if (!['osrm', 'google', 'legacy'].includes(String(route.provider)))
      issues.push({ path: "route.provider", code: "invalid" });
    if (!Number.isInteger(route.distanceMeters) || Number(route.distanceMeters) <= 0)
      issues.push({ path: "route.distanceMeters", code: "invalid" });
    else distanceMeters = Number(route.distanceMeters);
    if (!Number.isInteger(route.durationSeconds) || Number(route.durationSeconds) <= 0)
      issues.push({ path: "route.durationSeconds", code: "invalid" });
    if (!(route.encodedPolyline === null || typeof route.encodedPolyline === "string"))
      issues.push({ path: "route.encodedPolyline", code: "invalid" });
  }

  const party = input.party;
  let passengers: number | null = null;
  let luggage: number | null = null;
  if (!isRecord(party)) {
    issues.push({ path: "party", code: "required" });
  } else {
    if (!Number.isInteger(party.passengers))
      issues.push({ path: "party.passengers", code: "invalid" });
    else passengers = Number(party.passengers);
    if (!Number.isInteger(party.standardLuggage))
      issues.push({ path: "party.standardLuggage", code: "invalid" });
    else luggage = Number(party.standardLuggage);
  }

  const vehicleId = input.vehicleId;
  if (!isVehicleId(vehicleId)) {
    issues.push({ path: "vehicleId", code: "invalid" });
  } else {
    const typedVehicleId = vehicleId;
    if (input.vehicleModel !== VEHICLES[typedVehicleId].model)
      issues.push({ path: "vehicleModel", code: "mismatch" });

    if (passengers !== null && luggage !== null) {
      const capacity = getVehicleCapacity(
        typedVehicleId,
        passengers,
        luggage,
      );
      if (!capacity.available)
        issues.push({ path: "party", code: capacity.reason });
    }

    if (distanceMeters !== null) {
      const expectedPricing = calculatePricing(
        typedVehicleId,
        distanceMeters,
      );
      if (!samePricing(input.pricing, expectedPricing))
        issues.push({ path: "pricing", code: "server-recalculation-mismatch" });
    }
  }

  if (!['online-full', 'pay-in-vehicle'].includes(String(input.paymentMethod)))
    issues.push({ path: "paymentMethod", code: "invalid" });

  issues.push(...parseTripPreferences(input.preferences).issues);

  return { valid: issues.length === 0, issues };
}

export function hasMinimumLeadTime(
  scheduledAtUtc: string,
  nowMs = Date.now(),
): boolean {
  const pickupMs = Date.parse(scheduledAtUtc);
  return (
    Number.isFinite(pickupMs) &&
    pickupMs - nowMs >= MINIMUM_LEAD_TIME_MINUTES * 60_000
  );
}
