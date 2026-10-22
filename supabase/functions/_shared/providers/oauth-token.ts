import { type FetchFn, ReauthRequiredError } from "../http.ts";
import type { OAuthTokenResponse } from "./types.ts";

export class OAuthTokenError extends Error {
  constructor(readonly status: number, readonly code: string, description: string) {
    super(`OAuth token request failed (${status} ${code}): ${description}`);
    this.name = "OAuthTokenError";
  }
}

/** POSTs a form to an OAuth token endpoint; `invalid_grant` on refresh means the user must reconnect. */
export async function postTokenRequest(
  fetchFn: FetchFn,
  url: string,
  params: Record<string, string>,
  { isRefresh }: { isRefresh: boolean },
): Promise<OAuthTokenResponse> {
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params),
  });
  const text = await res.text();
  let body: OAuthTokenResponse;
  try {
    body = JSON.parse(text);
  } catch {
    throw new OAuthTokenError(res.status, "invalid_response", text.slice(0, 200));
  }
  if (!res.ok || !body.access_token) {
    const code = body.error ?? "unknown_error";
    if (isRefresh && (code === "invalid_grant" || code === "unauthorized_client")) {
      throw new ReauthRequiredError(body.error_description ?? code);
    }
    throw new OAuthTokenError(res.status, code, body.error_description ?? "");
  }
  return body;
}
