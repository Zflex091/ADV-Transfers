export const GOOGLE_REQUEST_TIMEOUT_MS = 10_000;

type RateLimitEntry = { count: number; resetAt: number };
const rateLimitBuckets = new Map<string, RateLimitEntry>();

export class GoogleMapsUpstreamError extends Error {
  public readonly status: number;

  constructor(status: number, message = "Google Maps užklausa nepavyko.") {
    super(message);
    this.status = status;
    this.name = "GoogleMapsUpstreamError";
  }
}
export function getGoogleMapsServerKey() {
  return process.env.GOOGLE_MAPS_SERVER_API_KEY?.trim() ?? "";
}

export function getQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export function normalizeLanguage(value: unknown): "lt" | "en" {
  return value === "en" ? "en" : "lt";
}

export function isValidSessionToken(value: string) {
  return /^[A-Za-z0-9_-]{1,36}$/.test(value);
}

export function isValidPlaceId(value: string) {
  return /^[A-Za-z0-9_-]{5,255}$/.test(value);
}

export function isCoordinate(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

export function consumeRateLimit(
  headers: Record<string, string | string[] | undefined>,
  remoteAddress: string | undefined,
  namespace: string,
  limit: number,
  now = Date.now(),
) {
  const forwarded = headers["x-forwarded-for"];
  const forwardedValue = Array.isArray(forwarded)
    ? forwarded[0]
    : forwarded;
  const clientAddress =
    forwardedValue?.split(",")[0]?.trim() || remoteAddress || "unknown";
  const key = `${namespace}:${clientAddress}`;
  const current = rateLimitBuckets.get(key);
  const windowMs = 60_000;
  const entry =
    !current || current.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : current;

  entry.count += 1;
  rateLimitBuckets.set(key, entry);

  if (rateLimitBuckets.size > 5_000) {
    for (const [bucketKey, bucket] of rateLimitBuckets) {
      if (bucket.resetAt <= now) {
        rateLimitBuckets.delete(bucketKey);
      }
    }
  }

  return {
    allowed: entry.count <= limit,
    limit,
    remaining: Math.max(0, limit - entry.count),
    resetAt: entry.resetAt,
  };
}

export async function fetchGoogleJson<T>(
  url: string,
  apiKey: string,
  fieldMask: string,
  init: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    GOOGLE_REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": fieldMask,
        ...init.headers,
      },
    });

    if (!response.ok) {
      throw new GoogleMapsUpstreamError(response.status);
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (!contentType.includes("application/json")) {
      throw new GoogleMapsUpstreamError(
        502,
        "Google Maps grąžino netinkamą atsakymą.",
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof GoogleMapsUpstreamError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new GoogleMapsUpstreamError(
        504,
        "Google Maps neatsakė laiku.",
      );
    }

    throw new GoogleMapsUpstreamError(502);
  } finally {
    clearTimeout(timeout);
  }
}
