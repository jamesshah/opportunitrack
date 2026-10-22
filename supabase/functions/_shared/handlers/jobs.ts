import type { Deps } from "../context.ts";
import { errorResponse, json, ReauthRequiredError } from "../http.ts";
import { ensurePush } from "../subscriptions.ts";
import { getAccessToken } from "../tokens.ts";
import { QUEUES } from "../types.ts";
import { drainQueues } from "../worker.ts";

export type CronCheck = (req: Request) => Promise<void>;

export async function handleProcessQueue(
  req: Request,
  deps: Deps,
  checkCron: CronCheck,
): Promise<Response> {
  try {
    await checkCron(req);
    return json(await drainQueues(deps));
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Renews Gmail watches (≈ daily) and Graph subscriptions (≈ daily, 3-day lifetime),
 * then queues a catch-up sync per account to cover dropped notifications.
 */
export async function handleRenewSubscriptions(
  req: Request,
  deps: Deps,
  checkCron: CronCheck,
): Promise<Response> {
  try {
    await checkCron(req);
    const accounts = await deps.store.listAccounts({});
    const stats = { renewed: 0, skipped: 0, failed: 0 };
    for (const account of accounts) {
      if (account.status === "reauth_required") {
        stats.skipped++;
        continue;
      }
      try {
        const accessToken = await getAccessToken(deps, account);
        await ensurePush(deps, account, accessToken);
        await deps.store.enqueue(QUEUES.sync, { account_id: account.id, reason: "catchup" });
        if (account.status === "error") {
          await deps.store.updateAccount(account.id, { status: "active", last_error: null });
        }
        stats.renewed++;
      } catch (error) {
        stats.failed++;
        if (!(error instanceof ReauthRequiredError)) {
          console.error(`renewal failed for account ${account.id}`, error);
          await deps.store.updateAccount(account.id, {
            status: "error",
            last_error: `Renewal failed: ${String(error).slice(0, 300)}`,
          });
        }
      }
    }
    return json(stats);
  } catch (error) {
    return errorResponse(error);
  }
}
