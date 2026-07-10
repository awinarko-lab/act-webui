import { NextResponse, type NextRequest } from "next/server";

/**
 * Compute the allowed origin for same-origin checks (KTD9).
 *
 * Defaults to the dashboard's own URL derived from `HOST`/`PORT` so the guard
 * works in local dev without configuration. Override with `ALLOWED_ORIGIN` for
 * a shared deployment behind a known URL.
 */
export function allowedOrigin(): string {
  if (process.env.ALLOWED_ORIGIN) return process.env.ALLOWED_ORIGIN;
  const host = process.env.HOST ?? "127.0.0.1";
  const port = process.env.PORT ?? "3000";
  return `http://${host}:${port}`;
}

/**
 * Normalize an origin/URL string to its canonical origin (protocol + host),
 * or `null` when it cannot be parsed.
 *
 * `new URL(...).origin` yields e.g. `http://example.com` (default port 80
 * omitted) or `http://example.com:3000` (explicit port kept). `localhost` and
 * `127.0.0.1` are distinct hostnames and therefore compare as cross-origin — by
 * design, so a page served from one cannot read data bound to the other.
 */
function normalizedOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Whether the given `Origin` header value matches the allowed origin, compared
 * by normalized origin (protocol + hostname + port) so the browser's
 * default-port omission does not cause a false rejection (S3). Fails closed
 * (returns `false`) on an unparseable origin or allowed-origin.
 */
export function isOriginAllowed(origin: string): boolean {
  const allowed = normalizedOrigin(allowedOrigin());
  const normalized = normalizedOrigin(origin);
  if (allowed === null || normalized === null) return false;
  return normalized === allowed;
}

/** Extract the `host:port` authority from an origin/URL string. */
function authorityOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    // Bare host without scheme — use as-is.
    return origin;
  }
}

/**
 * KTD9 same-origin guard for mutating (state-changing) routes.
 *
 * The server is unauthenticated, so a cross-origin web page must NOT be able to
 * POST to the run API (it would spawn `act` = arbitrary code execution). This
 * accepts a request only when:
 *  - its `Origin` header equals the allowed origin, OR
 *  - it carries no `Origin` header AND its `Host` header equals the allowed
 *    origin's authority (same-origin form POSTs / same-origin fetch, which omit
 *    or may omit `Origin`).
 *
 * Returns a 403 {@link NextResponse} when the request is rejected, else `null`.
 */
export function assertSameOrigin(request: NextRequest): NextResponse | null {
  const origin = request.headers.get("origin");

  if (origin != null) {
    return isOriginAllowed(origin)
      ? null
      : NextResponse.json(
          { error: "cross-origin request rejected" },
          { status: 403 },
        );
  }

  // No Origin header: same-origin browser requests (and non-browser clients)
  // carry a Host header we can compare against the allowed authority.
  const allowed = allowedOrigin();
  const host = request.headers.get("host");
  return host === authorityOf(allowed)
    ? null
    : NextResponse.json(
        { error: "cross-origin request rejected" },
        { status: 403 },
      );
}
