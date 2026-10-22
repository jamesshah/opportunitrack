import type { Deps } from "./context.ts";
import { ReauthRequiredError } from "./http.ts";
import { providerFor } from "./providers/index.ts";
import type { EmailAccount, TokenSet } from "./types.ts";

const REFRESH_SKEW_MS = 2 * 60 * 1000;

/**
 * Returns a usable access token, refreshing (and persisting rotated refresh
 * tokens) when it is about to expire. A dead refresh token — e.g. Google's
 * 7-day expiry for apps in Testing mode — flips the account to reauth_required.
 */
export async function getAccessToken(deps: Deps, account: EmailAccount): Promise<string> {
  if (account.status === "reauth_required") {
    throw new ReauthRequiredError("account needs to be reconnected");
  }
  const tokens = await deps.store.getTokens(account.id);
  if (!tokens) {
    await markReauthRequired(deps, account, "No stored OAuth tokens");
    throw new ReauthRequiredError("no stored tokens");
  }
  if (tokens.expires_at - REFRESH_SKEW_MS > deps.now().getTime()) return tokens.access_token;

  let refreshed: TokenSet;
  try {
    refreshed = await providerFor(deps.providers, account.provider).refreshTokens(tokens);
  } catch (error) {
    if (error instanceof ReauthRequiredError) {
      await markReauthRequired(deps, account, `Refresh token rejected: ${error.message}`);
    }
    throw error;
  }
  await deps.store.saveTokens(account.id, refreshed);
  return refreshed.access_token;
}

/** Records the transition once and tells the user to reconnect. */
export async function markReauthRequired(
  deps: Deps,
  account: EmailAccount,
  reason: string,
): Promise<void> {
  if (account.status === "reauth_required") return;
  await deps.store.updateAccount(account.id, {
    status: "reauth_required",
    last_error: reason.slice(0, 500),
  });
  account.status = "reauth_required";
  try {
    await deps.notifier.reconnectRequired(account);
  } catch (error) {
    console.error("reconnect notification failed", error);
  }
}
