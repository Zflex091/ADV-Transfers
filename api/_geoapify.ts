export const GEOAPIFY_REQUEST_TIMEOUT_MS = 10_000;

type RateLimitEntry = { count: number; resetAt: number };
const rateLimitBuckets = new Map<string, RateLimitEntry>();

export class GeoapifyUpstreamError extends Error {
  public readonly status: number;
  public readonly detail: string;

  constructor(status: number, message = "Geoapify užklausa nepavyko.", detail = "") {
    super(message);
    this.status = status;
    this.detail = detail;
    this.name = "GeoapifyUpstreamError";
  }
}

export function getGeoapifyServerKey() {
  return process.env.GEOAPIFY_API_KEY?.trim() ?? "";
}

export function getQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export function normalizeLanguage(value: unknown): "lt" | "en" {
  return value === "en" ? "en" : "lt";
}

export function isValidSessionToken(value: string) {
  return /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

export function isValidGeoapifyId(value: string) {
  return value.length > 0 && value.length <= 512 && !/[\u0000-\u001F\u007F\s]/.test(value);
}

export function isCoordinate(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

export function consumeRateLimit(
  headers: Record<string, string | string[] | undefined>,
  remoteAddress: string | undefined,
  namespace: string,
  limit: number,
  now = Date.now(),
) {
  const forwarded = headers["x-forwarded-for"];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const clientAddress = forwardedValue?.split(",")[0]?.trim() || remoteAddress || "unknown";
  const key = `${namespace}:${clientAddress}`;
  const current = rateLimitBuckets.get(key);
  const windowMs = 60_000;
  const entry = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : current;

  entry.count += 1;
  rateLimitBuckets.set(key, entry);

  if (rateLimitBuckets.size > 5_000) {
    for (const [bucketKey, bucket] of rateLimitBuckets) {
      if (bucket.resetAt <= now) rateLimitBuckets.delete(bucketKey);
    }
  }

  return {
    allowed: entry.count <= limit,
    limit,
    remaining: Math.max(0, limit - entry.count),
    resetAt: entry.resetAt,
  };
}

export async function fetchGeoapifyJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = GEOAPIFY_REQUEST_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { Accept: "application/json", ...init.headers },
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 1_000);
      throw new GeoapifyUpstreamError(response.status, undefined, detail);
    }

    if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("json")) {
      throw new GeoapifyUpstreamError(502, "Geoapify grąžino netinkamą atsakymą.");
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof GeoapifyUpstreamError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new GeoapifyUpstreamError(504, "Geoapify neatsakė laiku.");
    }
    throw new GeoapifyUpstreamError(502);
  } finally {
    clearTimeout(timeout);
  }
}
