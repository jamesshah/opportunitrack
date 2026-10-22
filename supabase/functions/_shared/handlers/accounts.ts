import type { Deps } from "../context.ts";
import { errorResponse, HttpError, json, readJson } from "../http.ts";
import { providerFor } from "../providers/index.ts";
import { stopPush } from "../subscriptions.ts";
import { getAccessToken } from "../tokens.ts";
import type { AccountWithSync } from "../types.ts";
import type { Authenticate } from "./oauth.ts";

/** Best-effort provider cleanup; local deletion always proceeds. */
async function disconnect(deps: Deps, account: AccountWithSync): Promise<void> {
  try {
    const tokens = await deps.store.getTokens(account.id);
    if (tokens && account.status !== "reauth_required") {
      const accessToken = await getAccessToken(deps, account);
      await stopPush(deps, account, accessToken);
      await providerFor(deps.providers, account.provider).revoke?.(tokens);
    }
  } catch (error) {
    console.warn(`provider cleanup failed for account ${account.id}`, error);
  }
  await deps.store.deleteAccount(account.id);
}

/** POST {account_id}: stops push, revokes tokens, deletes the mailbox (applications are kept). */
export async function handleDisconnectAccount(
  req: Request,
  deps: Deps,
  authenticate: Authenticate,
): Promise<Response> {
  try {
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const user = await authenticate(req);
    const { account_id } = await readJson<{ account_id?: string }>(req);
    if (!account_id) throw new HttpError(400, "account_id_required");
    const account = await deps.store.getAccount(account_id);
    if (!account || account.user_id !== user.id) throw new HttpError(404, "account_not_found");
    await disconnect(deps, account);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export type DeleteAuthUser = (userId: string) => Promise<void>;

/** POST: disconnects every mailbox, then deletes the auth user (all rows cascade). */
export async function handleDeleteAccount(
  req: Request,
  deps: Deps,
  authenticate: Authenticate,
  deleteAuthUser: DeleteAuthUser,
): Promise<Response> {
  try {
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const user = await authenticate(req);
    for (const account of await deps.store.listAccounts({ userId: user.id })) {
      await disconnect(deps, account);
    }
    await deleteAuthUser(user.id);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
