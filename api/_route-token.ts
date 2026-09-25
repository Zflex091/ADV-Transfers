import { createHmac, timingSafeEqual } from "node:crypto";

import { getGoogleMapsServerKey, isCoordinate } from "./_google-maps.js";

export const ROUTE_TOKEN_TTL_MS = 30 * 60_000;

export type RouteTokenPoint = Readonly<{
  latitude: number;
  longitude: number;
}>;

export type RouteTokenClaims = Readonly<{
  version: 1;
  issuedAtMs: number;
  origin: RouteTokenPoint;
  destination: RouteTokenPoint;
  distanceMeters: number;
  durationSeconds: number;
}>;

function signingKey(): Buffer | null {
  const secret =
    process.env.ROUTE_TOKEN_SECRET?.trim() || getGoogleMapsServerKey();
  if (!secret) return null;

  // Separate this purpose from the Maps API key even when it is the fallback.
  return createHmac("sha256", secret)
    .update("adv-transfers:route-quote-token:v1", "utf8")
    .digest();
}

function sign(payload: string, key: Buffer): Buffer {
  return createHmac("sha256", key).update(payload, "utf8").digest();
}

function isValidClaims(value: unknown): value is RouteTokenClaims {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const claims = value as Record<string, unknown>;
  const origin = claims.origin as Record<string, unknown> | null;
  const destination = claims.destination as Record<string, unknown> | null;

  return (
    claims.version === 1 &&
    Number.isSafeInteger(claims.issuedAtMs) &&
    typeof origin === "object" &&
    origin !== null &&
    isCoordinate(origin.latitude, -90, 90) &&
    isCoordinate(origin.longitude, -180, 180) &&
    typeof destination === "object" &&
    destination !== null &&
    isCoordinate(destination.latitude, -90, 90) &&
    isCoordinate(destination.longitude, -180, 180) &&
    Number.isInteger(claims.distanceMeters) &&
    Number(claims.distanceMeters) > 0 &&
    Number.isInteger(claims.durationSeconds) &&
    Number(claims.durationSeconds) > 0
  );
}

export function createRouteToken(
  route: Omit<RouteTokenClaims, "version" | "issuedAtMs">,
  nowMs = Date.now(),
): string | null {
  const key = signingKey();
  const claims = { version: 1 as const, issuedAtMs: nowMs, ...route };
  if (!key || !isValidClaims(claims)) return null;

  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signature = sign(payload, key).toString("base64url");
  return payload + "." + signature;
}

export function verifyRouteToken(
  token: unknown,
  nowMs = Date.now(),
): RouteTokenClaims | null {
  const key = signingKey();
  if (!key || typeof token !== "string" || token.length > 4_096) return null;

  const parts = token.split(".");
  if (
    parts.length !== 2 ||
    !/^[A-Za-z0-9_-]+$/.test(parts[0]) ||
    !/^[A-Za-z0-9_-]+$/.test(parts[1])
  ) {
    return null;
  }

  const expected = sign(parts[0], key);
  const actual = Buffer.from(parts[1], "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }

  try {
    const claims: unknown = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8"),
    );
    if (!isValidClaims(claims)) return null;
    if (
      claims.issuedAtMs > nowMs + 60_000 ||
      nowMs - claims.issuedAtMs > ROUTE_TOKEN_TTL_MS
    ) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

export function placeMatchesRoutePoint(
  place: unknown,
  point: RouteTokenPoint,
): boolean {
  if (typeof place !== "object" || place === null || Array.isArray(place)) {
    return false;
  }
  const value = place as Record<string, unknown>;
  return (
    typeof value.label === "string" &&
    value.label.trim().length > 0 &&
    value.label.length <= 500 &&
    typeof value.providerPlaceId === "string" &&
    value.providerPlaceId.length > 0 &&
    isCoordinate(value.latitude, -90, 90) &&
    isCoordinate(value.longitude, -180, 180) &&
    Math.abs(value.latitude - point.latitude) <= 0.000001 &&
    Math.abs(value.longitude - point.longitude) <= 0.000001
  );
}
