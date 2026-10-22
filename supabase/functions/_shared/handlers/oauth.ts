import type { Deps } from "../context.ts";
import { appRedirectUrl, oauthRedirectUri } from "../env.ts";
import { errorResponse, HttpError, json, readJson } from "../http.ts";
import { classifyAuthError, type ConnectErrorReason } from "../oauth/errors.ts";
import { createOAuthState, createPkcePair } from "../oauth/pkce.ts";
import { GMAIL_READONLY_SCOPE } from "../providers/gmail.ts";
import { providerFor } from "../providers/index.ts";
import { OAuthTokenError } from "../providers/oauth-token.ts";
import { ensurePush } from "../subscriptions.ts";
import { type Provider, QUEUES } from "../types.ts";

export type Authenticate = (req: Request) => Promise<{ id: string }>;

export interface OAuthUrls {
  redirectUri: string;
  appRedirectUrl: string;
}

export function oauthUrlsFromEnv(): OAuthUrls {
  return { redirectUri: oauthRedirectUri(), appRedirectUrl: appRedirectUrl() };
}

/** POST {provider} with the user's Supabase JWT → {authorization_url}. */
export async function handleOAuthStart(
  req: Request,
  deps: Deps,
  authenticate: Authenticate,
  urls: OAuthUrls,
): Promise<Response> {
  try {
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const user = await authenticate(req);
    const { provider } = await readJson<{ provider?: string }>(req);
    if (provider !== "google" && provider !== "microsoft") {
      throw new HttpError(400, "invalid_provider");
    }

    const state = createOAuthState();
    const pkce = await createPkcePair();
    await deps.store.createOAuthState({
      state,
      userId: user.id,
      provider,
      codeVerifier: pkce.verifier,
    });
    const authorization_url = providerFor(deps.providers, provider).buildAuthorizationUrl({
      state,
      codeChallenge: pkce.challenge,
      redirectUri: urls.redirectUri,
    });
    return json({ authorization_url });
  } catch (error) {
    return errorResponse(error);
  }
}

function redirectToApp(base: string, params: Record<string, string>): Response {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}

function failure(urls: OAuthUrls, reason: ConnectErrorReason, provider?: Provider): Response {
  return redirectToApp(urls.appRedirectUrl, {
    status: "error",
    reason,
    ...(provider ? { provider } : {}),
  });
}

/** Provider redirect target. Always ends in a redirect back into the iOS app. */
export async function handleOAuthCallback(
  req: Request,
  deps: Deps,
  urls: OAuthUrls,
): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const stateParam = params.get("state");
  const state = stateParam ? await deps.store.consumeOAuthState(stateParam) : null;
  if (!state) return failure(urls, "invalid_state");
  const { provider } = state;

  const providerError = params.get("error");
  if (providerError) {
    return failure(
      urls,
      classifyAuthError(providerError, params.get("error_description")),
      provider,
    );
  }
  const code = params.get("code");
  if (!code) return failure(urls, "exchange_failed", provider);

  const client = providerFor(deps.providers, provider);
  try {
    const tokens = await client.exchangeCode({
      code,
      codeVerifier: state.codeVerifier,
      redirectUri: urls.redirectUri,
    });
    if (
      provider === "google" && tokens.scope &&
      !tokens.scope.split(" ").includes(GMAIL_READONLY_SCOPE)
    ) {
      return failure(urls, "missing_scope", provider);
    }
    const profile = await client.getProfile(tokens.access_token, tokens);
    const account = await deps.store.upsertAccount({
      userId: state.userId,
      provider,
      emailAddress: profile.emailAddress,
      providerUserId: profile.providerUserId,
    });
    await deps.store.saveTokens(account.id, tokens);

    const full = await deps.store.getAccount(account.id);
    if (full) {
      try {
        await ensurePush(deps, full, tokens.access_token);
      } catch (error) {
        // Connecting still succeeds; the renewal cron retries push setup.
        console.error("push setup failed", error);
        await deps.store.updateAccount(account.id, {
          last_error: `Push setup failed: ${String(error).slice(0, 300)}`,
        });
      }
    }

    await deps.store.enqueue(QUEUES.sync, { account_id: account.id, reason: "backfill" });
    return redirectToApp(urls.appRedirectUrl, {
      status: "success",
      provider,
      account_id: account.id,
    });
  } catch (error) {
    console.error("OAuth callback failed", error);
    if (error instanceof OAuthTokenError) {
      return failure(urls, classifyAuthError(error.code, error.message), provider);
    }
    return failure(urls, "server_error", provider);
  }
}
