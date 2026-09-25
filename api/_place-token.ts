import { createHmac, timingSafeEqual } from "node:crypto";

import { isCoordinate, isValidMapboxId } from "./_mapbox.js";

/** A place selection may outlive a refreshed route, but not an abandoned tab. */
export const PLACE_TOKEN_TTL_MS = 2 * 60 * 60_000;

export type VerifiedPlace = Readonly<{
  provider: "mapbox" | "google";
  providerPlaceId: string;
  label: string;
  latitude: number;
  longitude: number;
}>;

type PlaceClaims = VerifiedPlace & Readonly<{
  version: 1;
  issuedAtMs: number;
}>;

function signingKey(): Buffer | null {
  const secret =
    process.env.ROUTE_TOKEN_SECRET?.trim() ||
    process.env.ORDER_STATUS_SECRET?.trim() ||
    process.env.DATABASE_URL?.trim();
  if (!secret) return null;

  return createHmac("sha256", secret)
    .update("adv-transfers:verified-place-token:v1", "utf8")
    .digest();
}

function isValidProviderPlaceId(provider: unknown, providerPlaceId: unknown) {
  if (typeof providerPlaceId !== "string") return false;
  if (provider === "mapbox") return isValidMapboxId(providerPlaceId);
  return provider === "google" && /^[A-Za-z0-9_-]{5,255}$/.test(providerPlaceId);
}

function isVerifiedPlace(value: unknown): value is VerifiedPlace {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const place = value as Record<string, unknown>;
  return (
    (place.provider === "mapbox" || place.provider === "google") &&
    isValidProviderPlaceId(place.provider, place.providerPlaceId) &&
    typeof place.label === "string" &&
    place.label.trim() === place.label &&
    place.label.length > 0 &&
    place.label.length <= 500 &&
    isCoordinate(place.latitude, -90, 90) &&
    isCoordinate(place.longitude, -180, 180)
  );
}

function sign(payload: string, key: Buffer): Buffer {
  return createHmac("sha256", key).update(payload, "utf8").digest();
}

export function createVerifiedPlaceToken(
  place: VerifiedPlace,
  nowMs = Date.now(),
): string | null {
  const key = signingKey();
  if (!key || !isVerifiedPlace(place) || !Number.isSafeInteger(nowMs)) return null;
  const claims: PlaceClaims = {
    version: 1,
    issuedAtMs: nowMs,
    provider: place.provider,
    providerPlaceId: place.providerPlaceId,
    label: place.label,
    latitude: place.latitude,
    longitude: place.longitude,
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return payload + "." + sign(payload, key).toString("base64url");
}

export function verifyVerifiedPlaceToken(
  token: unknown,
  nowMs = Date.now(),
): VerifiedPlace | null {
  const key = signingKey();
  if (!key || typeof token !== "string" || token.length > 4096) return null;
  const parts = token.split(".");
  if (
    parts.length !== 2 ||
    !/^[A-Za-z0-9_-]+$/.test(parts[0]) ||
    !/^[A-Za-z0-9_-]+$/.test(parts[1])
  ) return null;
  const expected = sign(parts[0], key);
  const actual = Buffer.from(parts[1], "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (typeof claims !== "object" || claims === null || Array.isArray(claims)) return null;
    const value = claims as Record<string, unknown>;
    const issuedAtMs = value.issuedAtMs;
    if (
      value.version !== 1 ||
      typeof issuedAtMs !== "number" ||
      !Number.isSafeInteger(issuedAtMs) ||
      !isVerifiedPlace(value) ||
      issuedAtMs > nowMs + 60_000 ||
      nowMs - issuedAtMs > PLACE_TOKEN_TTL_MS
    ) return null;
    return {
      provider: value.provider,
      providerPlaceId: value.providerPlaceId,
      label: value.label,
      latitude: value.latitude,
      longitude: value.longitude,
    } as VerifiedPlace;
  } catch {
    return null;
  }
}

export function placeMatchesVerifiedToken(
  place: unknown,
  nowMs = Date.now(),
): boolean {
  const token =
    typeof place === "object" && place !== null && !Array.isArray(place)
      ? (place as Record<string, unknown>).placeToken
      : null;
  const verified = verifyVerifiedPlaceToken(token, nowMs);
  if (!verified || !isVerifiedPlace(place)) return false;
  return (
    place.provider === verified.provider &&
    place.providerPlaceId === verified.providerPlaceId &&
    place.label === verified.label &&
    place.latitude === verified.latitude &&
    place.longitude === verified.longitude
  );
}
