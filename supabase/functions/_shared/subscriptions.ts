import type { Deps } from "./context.ts";
import { randomToken } from "./encoding.ts";
import { ProviderHttpError } from "./http.ts";
import type { AccountWithSync, EmailAccountSync } from "./types.ts";

const HOUR = 60 * 60 * 1000;
/** Google recommends calling watch daily; the renewal cron runs every 6 hours. */
export const GMAIL_WATCH_RENEW_AFTER_MS = 20 * HOUR;
/** Graph subscriptions are created for 3 days and PATCHed once fewer than 2 remain (≈ daily). */
export const OUTLOOK_RENEW_BEFORE_EXPIRY_MS = 48 * HOUR;

export function gmailWatchDue(sync: EmailAccountSync | null, now: Date): boolean {
  if (!sync?.gmail_watch_renewed_at || !sync.gmail_watch_expires_at) return true;
  const renewedAgo = now.getTime() - Date.parse(sync.gmail_watch_renewed_at);
  const expiresIn = Date.parse(sync.gmail_watch_expires_at) - now.getTime();
  return renewedAgo >= GMAIL_WATCH_RENEW_AFTER_MS || expiresIn < 48 * HOUR;
}

export function outlookSubscriptionAction(
  sync: EmailAccountSync | null,
  now: Date,
): "create" | "renew" | "none" {
  if (!sync?.outlook_subscription_id) return "create";
  const expires = sync.outlook_subscription_expires_at
    ? Date.parse(sync.outlook_subscription_expires_at)
    : 0;
  return expires - now.getTime() < OUTLOOK_RENEW_BEFORE_EXPIRY_MS ? "renew" : "none";
}

export async function startGmailWatch(
  deps: Deps,
  account: AccountWithSync,
  accessToken: string,
): Promise<void> {
  const result = await deps.providers.google.watch(accessToken);
  const patch: Partial<EmailAccountSync> = {
    gmail_watch_expires_at: result.expiration.toISOString(),
    gmail_watch_renewed_at: deps.now().toISOString(),
  };
  // Adopting a newer history id here would silently skip history; only seed it.
  if (!account.sync?.gmail_history_id) patch.gmail_history_id = result.historyId;
  await deps.store.updateSync(account.id, patch);
  account.sync = { ...(account.sync ?? emptySync(account.id)), ...patch };
}

export async function createOutlookSubscription(
  deps: Deps,
  account: AccountWithSync,
  accessToken: string,
): Promise<void> {
  const clientState = randomToken(24);
  const subscription = await deps.providers.microsoft.createSubscription(accessToken, {
    notificationUrl: `${deps.config.functionsBaseUrl}/outlook-webhook`,
    lifecycleUrl: `${deps.config.functionsBaseUrl}/outlook-webhook?lifecycle=1`,
    clientState,
    now: deps.now(),
  });
  const patch: Partial<EmailAccountSync> = {
    outlook_subscription_id: subscription.id,
    outlook_subscription_expires_at: subscription.expirationDateTime,
    outlook_client_state: clientState,
  };
  await deps.store.updateSync(account.id, patch);
  account.sync = { ...(account.sync ?? emptySync(account.id)), ...patch };
}

/** PATCHes the subscription; recreates it if Graph has already dropped it. */
export async function renewOutlookSubscription(
  deps: Deps,
  account: AccountWithSync,
  accessToken: string,
): Promise<void> {
  const id = account.sync?.outlook_subscription_id;
  if (!id) return await createOutlookSubscription(deps, account, accessToken);
  try {
    const renewed = await deps.providers.microsoft.renewSubscription(accessToken, id, deps.now());
    await deps.store.updateSync(account.id, {
      outlook_subscription_expires_at: renewed.expirationDateTime,
    });
    account.sync = {
      ...account.sync!,
      outlook_subscription_expires_at: renewed.expirationDateTime,
    };
  } catch (error) {
    if (error instanceof ProviderHttpError && error.status === 404) {
      return await createOutlookSubscription(deps, account, accessToken);
    }
    throw error;
  }
}

/** Ensures push delivery is set up and fresh for one account. */
export async function ensurePush(
  deps: Deps,
  account: AccountWithSync,
  accessToken: string,
): Promise<void> {
  if (account.provider === "google") {
    if (gmailWatchDue(account.sync, deps.now())) await startGmailWatch(deps, account, accessToken);
    return;
  }
  const action = outlookSubscriptionAction(account.sync, deps.now());
  if (action === "create") await createOutlookSubscription(deps, account, accessToken);
  else if (action === "renew") await renewOutlookSubscription(deps, account, accessToken);
}

export async function stopPush(
  deps: Deps,
  account: AccountWithSync,
  accessToken: string,
): Promise<void> {
  if (account.provider === "google") {
    await deps.providers.google.stopWatch(accessToken);
  } else if (account.sync?.outlook_subscription_id) {
    await deps.providers.microsoft.deleteSubscription(
      accessToken,
      account.sync.outlook_subscription_id,
    );
  }
}

function emptySync(accountId: string): EmailAccountSync {
  return {
    account_id: accountId,
    access_token_expires_at: null,
    gmail_history_id: null,
    gmail_watch_expires_at: null,
    gmail_watch_renewed_at: null,
    outlook_subscription_id: null,
    outlook_subscription_expires_at: null,
    outlook_client_state: null,
  };
}
