export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

/** A provider rejected our credentials for good; the user has to reconnect the mailbox. */
export class ReauthRequiredError extends Error {
  override name = "ReauthRequiredError";
}

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  console.error(error);
  return json({ error: "internal_error" }, 500);
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/** Constant-time string comparison for shared secrets. */
export function safeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

export type FetchFn = typeof fetch;

export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    context: string,
    /** Seconds from a `Retry-After` header on 429/503 responses. */
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(`${context} failed with HTTP ${status}: ${body.slice(0, 500)}`);
    this.name = "ProviderHttpError";
  }

  get isRateLimited(): boolean {
    return this.status === 429 || (this.status === 503 && this.retryAfterSeconds !== null);
  }
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - now) / 1000));
}

export async function fetchJson<T>(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  context: string,
): Promise<T> {
  const res = await fetchFn(url, init);
  if (!res.ok) {
    throw new ProviderHttpError(
      res.status,
      await res.text(),
      context,
      parseRetryAfter(res.headers.get("Retry-After")),
    );
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
