import { prefilterMessage } from "./classifier/prefilter.ts";
import type { Deps } from "./context.ts";
import { HistoryExpiredError } from "./providers/gmail.ts";
import { createOutlookSubscription, renewOutlookSubscription } from "./subscriptions.ts";
import { getAccessToken } from "./tokens.ts";
import { type AccountWithSync, QUEUES, type SyncJob } from "./types.ts";

const DAY = 24 * 60 * 60 * 1000;
/** Re-list a little before the last sync so messages that arrived mid-sync aren't missed. */
const OVERLAP_MS = 10 * 60 * 1000;

export interface SyncResult {
  enqueued: number;
  skipped?: "missing_account" | "reauth_required";
}

/** Finds new message ids for one account and fans them out to the messages queue. */
export async function syncAccount(deps: Deps, job: SyncJob): Promise<SyncResult> {
  const account = await deps.store.getAccount(job.account_id);
  if (!account) return { enqueued: 0, skipped: "missing_account" };
  if (account.status === "reauth_required") return { enqueued: 0, skipped: "reauth_required" };

  const startedAt = deps.now();
  const accessToken = await getAccessToken(deps, account);

  if (job.reason === "lifecycle" && account.provider === "microsoft") {
    await handleOutlookLifecycle(deps, account, accessToken, job.lifecycle_event);
  }

  const ids = account.provider === "google"
    ? await gmailMessageIds(deps, account, accessToken, job)
    : await outlookMessageIds(deps, account, accessToken, job);

  const fresh = await deps.store.filterUnprocessed(account.id, ids);
  for (const messageId of fresh) {
    await deps.store.enqueue(QUEUES.messages, { account_id: account.id, message_id: messageId });
  }

  await deps.store.updateAccount(account.id, {
    last_synced_at: startedAt.toISOString(),
    status: "active",
    last_error: null,
  });
  return { enqueued: fresh.length };
}

function windowStart(deps: Deps, account: AccountWithSync, job: SyncJob): Date {
  if (job.since) return new Date(job.since);
  if (job.reason === "backfill") {
    return new Date(deps.now().getTime() - deps.config.backfillDays * DAY);
  }
  if (account.last_synced_at) return new Date(Date.parse(account.last_synced_at) - OVERLAP_MS);
  return new Date(deps.now().getTime() - DAY);
}

async function gmailMessageIds(
  deps: Deps,
  account: AccountWithSync,
  accessToken: string,
  job: SyncJob,
): Promise<string[]> {
  const gmail = deps.providers.google;
  const historyId = account.sync?.gmail_history_id;

  // history.list costs 2 quota units and only reports INBOX additions.
  if (job.reason !== "backfill" && historyId) {
    try {
      const history = await gmail.listHistory(accessToken, historyId);
      await deps.store.advanceHistoryId(account.id, history.historyId);
      return history.messageIds;
    } catch (error) {
      if (!(error instanceof HistoryExpiredError)) throw error;
      const reset = job.history_id ?? (await gmail.watch(accessToken)).historyId;
      await deps.store.updateSync(account.id, { gmail_history_id: reset });
    }
  }

  // Backfill and fallback: provider-side search narrows the listing before any fetch.
  return await gmail.listCandidateMessageIdsSince(
    accessToken,
    windowStart(deps, account, job),
    deps.config.backfillMaxMessages,
  );
}

async function outlookMessageIds(
  deps: Deps,
  account: AccountWithSync,
  accessToken: string,
  job: SyncJob,
): Promise<string[]> {
  // One list call returns subject, sender and preview, so triage happens before any per-message GET.
  const summaries = await deps.providers.microsoft.listInboxSummariesSince(
    accessToken,
    windowStart(deps, account, job),
    deps.config.backfillMaxMessages,
  );
  const candidates = deps.config.prefilterEnabled
    ? summaries.filter((summary) => prefilterMessage(summary).candidate)
    : summaries;
  return candidates.map((summary) => summary.id);
}

async function handleOutlookLifecycle(
  deps: Deps,
  account: AccountWithSync,
  accessToken: string,
  event: string | undefined,
): Promise<void> {
  const microsoft = deps.providers.microsoft;
  const subscriptionId = account.sync?.outlook_subscription_id;
  if (event === "reauthorizationRequired" && subscriptionId) {
    await microsoft.reauthorizeSubscription(accessToken, subscriptionId);
    await renewOutlookSubscription(deps, account, accessToken);
  } else if (event === "subscriptionRemoved") {
    await createOutlookSubscription(deps, account, accessToken);
  }
  // "missed": nothing to repair; the catch-up listing below recovers the messages.
}
