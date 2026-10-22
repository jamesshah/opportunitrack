import { createClient, type SupabaseClient } from "./deps.ts";
import { requireEnv } from "./env.ts";
import type {
  AccountStatus,
  AccountWithSync,
  DeviceToken,
  EmailAccount,
  EmailAccountSync,
  Provider,
  QueueName,
  RecordMessageInput,
  RecordMessageResult,
  TokenSet,
} from "./types.ts";

export interface QueueMessage<T> {
  msg_id: number;
  read_ct: number;
  enqueued_at: string;
  message: T;
}

export interface AccountUpsert {
  userId: string;
  provider: Provider;
  emailAddress: string;
  providerUserId: string | null;
}

/** Everything the Edge Functions need from Postgres, behind one seam for tests. */
export interface Store {
  getAccount(accountId: string): Promise<AccountWithSync | null>;
  findAccountsByAddress(provider: Provider, emailAddress: string): Promise<AccountWithSync[]>;
  findAccountBySubscriptionId(subscriptionId: string): Promise<AccountWithSync | null>;
  listAccounts(filter: { userId?: string; status?: AccountStatus }): Promise<AccountWithSync[]>;
  upsertAccount(input: AccountUpsert): Promise<EmailAccount>;
  deleteAccount(accountId: string): Promise<void>;
  updateAccount(
    accountId: string,
    patch: Partial<Pick<EmailAccount, "status" | "last_synced_at">> & {
      last_error?: string | null;
    },
  ): Promise<void>;
  updateSync(
    accountId: string,
    patch: Partial<Omit<EmailAccountSync, "account_id">>,
  ): Promise<void>;
  /** Advances `gmail_history_id` only if the new value is larger. */
  advanceHistoryId(accountId: string, historyId: string): Promise<void>;

  getTokens(accountId: string): Promise<TokenSet | null>;
  saveTokens(accountId: string, tokens: TokenSet): Promise<void>;
  deleteTokens(accountId: string): Promise<void>;

  filterUnprocessed(accountId: string, messageIds: string[]): Promise<string[]>;
  recordMessage(input: RecordMessageInput): Promise<RecordMessageResult>;

  notificationsEnabled(userId: string): Promise<boolean>;
  listDeviceTokens(userId: string): Promise<DeviceToken[]>;
  deleteDeviceToken(token: string): Promise<void>;

  createOAuthState(
    input: { state: string; userId: string; provider: Provider; codeVerifier: string },
  ): Promise<void>;
  /** Returns and deletes an unexpired state (one-time use). */
  consumeOAuthState(
    state: string,
  ): Promise<{ userId: string; provider: Provider; codeVerifier: string } | null>;

  enqueue(queue: QueueName, message: unknown, delaySeconds?: number): Promise<void>;
  readQueue<T>(
    queue: QueueName,
    visibilityTimeoutSeconds: number,
    quantity: number,
  ): Promise<QueueMessage<T>[]>;
  deleteQueueMessage(queue: QueueName, msgId: number): Promise<void>;
  archiveQueueMessage(queue: QueueName, msgId: number): Promise<void>;
  /** Makes a message invisible for `seconds` more, e.g. to honour a provider's Retry-After. */
  delayQueueMessage(queue: QueueName, msgId: number, seconds: number): Promise<void>;

  verifyCronSecret(secret: string | null): Promise<boolean>;
}

const ACCOUNT_SELECT =
  "id,user_id,provider,email_address,status,last_synced_at,sync:email_account_sync(account_id,access_token_expires_at,gmail_history_id,gmail_watch_expires_at,gmail_watch_renewed_at,outlook_subscription_id,outlook_subscription_expires_at,outlook_client_state)";

function check<T>(result: { data: T; error: { message: string } | null }, context: string): T {
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  return result.data;
}

function normalizeAccount(row: any): AccountWithSync {
  const sync = Array.isArray(row.sync) ? row.sync[0] ?? null : row.sync ?? null;
  if (sync && sync.gmail_history_id !== null && sync.gmail_history_id !== undefined) {
    sync.gmail_history_id = String(sync.gmail_history_id);
  }
  return { ...row, sync };
}

export function createAdminClient(): SupabaseClient {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export class SupabaseStore implements Store {
  constructor(readonly client: SupabaseClient) {}

  async getAccount(accountId: string) {
    const data = check(
      await this.client.from("email_accounts").select(ACCOUNT_SELECT).eq("id", accountId)
        .maybeSingle(),
      "getAccount",
    );
    return data ? normalizeAccount(data) : null;
  }

  async findAccountsByAddress(provider: Provider, emailAddress: string) {
    const data = check(
      await this.client.from("email_accounts").select(ACCOUNT_SELECT).eq("provider", provider)
        .eq("email_address", emailAddress.toLowerCase()),
      "findAccountsByAddress",
    );
    return (data ?? []).map(normalizeAccount);
  }

  async findAccountBySubscriptionId(subscriptionId: string) {
    const data = check(
      await this.client.from("email_account_sync").select("account_id")
        .eq("outlook_subscription_id", subscriptionId).maybeSingle(),
      "findAccountBySubscriptionId",
    );
    return data ? await this.getAccount(data.account_id) : null;
  }

  async listAccounts(filter: { userId?: string; status?: AccountStatus }) {
    let query = this.client.from("email_accounts").select(ACCOUNT_SELECT);
    if (filter.userId) query = query.eq("user_id", filter.userId);
    if (filter.status) query = query.eq("status", filter.status);
    return (check(await query, "listAccounts") ?? []).map(normalizeAccount);
  }

  async upsertAccount(input: AccountUpsert) {
    const account = check(
      await this.client.from("email_accounts").upsert({
        user_id: input.userId,
        provider: input.provider,
        email_address: input.emailAddress,
        provider_user_id: input.providerUserId,
        status: "active",
        last_error: null,
      }, { onConflict: "user_id,provider,email_address" }).select(
        "id,user_id,provider,email_address,status,last_synced_at",
      )
        .single(),
      "upsertAccount",
    ) as EmailAccount;
    check(
      await this.client.from("email_account_sync").upsert({ account_id: account.id }, {
        onConflict: "account_id",
        ignoreDuplicates: true,
      }),
      "upsertAccount sync row",
    );
    return account;
  }

  async deleteAccount(accountId: string) {
    check(await this.client.from("email_accounts").delete().eq("id", accountId), "deleteAccount");
  }

  async updateAccount(accountId: string, patch: Record<string, unknown>) {
    check(
      await this.client.from("email_accounts").update(patch).eq("id", accountId),
      "updateAccount",
    );
  }

  async updateSync(accountId: string, patch: Record<string, unknown>) {
    check(
      await this.client.from("email_account_sync").update(patch).eq("account_id", accountId),
      "updateSync",
    );
  }

  async advanceHistoryId(accountId: string, historyId: string) {
    check(
      await this.client.from("email_account_sync").update({ gmail_history_id: historyId })
        .eq("account_id", accountId)
        .or(`gmail_history_id.is.null,gmail_history_id.lt.${BigInt(historyId).toString()}`),
      "advanceHistoryId",
    );
  }

  async getTokens(accountId: string) {
    return check(
      await this.client.rpc("get_account_tokens", { p_account_id: accountId }),
      "getTokens",
    ) as
      | TokenSet
      | null;
  }

  async saveTokens(accountId: string, tokens: TokenSet) {
    check(
      await this.client.rpc("store_account_tokens", {
        p_account_id: accountId,
        p_tokens: tokens,
        p_expires_at: new Date(tokens.expires_at).toISOString(),
      }),
      "saveTokens",
    );
  }

  async deleteTokens(accountId: string) {
    check(
      await this.client.rpc("delete_account_tokens", { p_account_id: accountId }),
      "deleteTokens",
    );
  }

  async filterUnprocessed(accountId: string, messageIds: string[]) {
    if (messageIds.length === 0) return [];
    const seen = new Set<string>();
    for (let i = 0; i < messageIds.length; i += 200) {
      const chunk = messageIds.slice(i, i + 200);
      const data = check(
        await this.client.from("processed_messages").select("provider_message_id")
          .eq("email_account_id", accountId).in("provider_message_id", chunk),
        "filterUnprocessed",
      );
      for (const row of data ?? []) seen.add(row.provider_message_id);
    }
    return messageIds.filter((id) => !seen.has(id));
  }

  async recordMessage(input: RecordMessageInput) {
    return check(
      await this.client.rpc("record_classified_message", {
        p_account_id: input.accountId,
        p_provider_message_id: input.providerMessageId,
        p_received_at: input.receivedAt?.toISOString() ?? null,
        p_outcome: input.outcome,
        p_classifier: input.classifier ?? null,
        p_classifier_version: input.classifierVersion ?? null,
        p_job_probability: input.jobProbability ?? null,
        p_confidence: input.confidence ?? null,
        p_company: input.company ?? null,
        p_position: input.position ?? null,
        p_status: input.status ?? null,
        p_subject: input.subject ?? null,
        p_sender: input.sender ?? null,
        p_error: input.error ?? null,
      }),
      "recordMessage",
    ) as RecordMessageResult;
  }

  async notificationsEnabled(userId: string) {
    const data = check(
      await this.client.from("profiles").select("notifications_enabled").eq("id", userId)
        .maybeSingle(),
      "notificationsEnabled",
    );
    return data?.notifications_enabled ?? true;
  }

  async listDeviceTokens(userId: string) {
    return (check(
      await this.client.from("device_tokens").select("token,environment,bundle_id").eq(
        "user_id",
        userId,
      ),
      "listDeviceTokens",
    ) ?? []) as DeviceToken[];
  }

  async deleteDeviceToken(token: string) {
    check(await this.client.from("device_tokens").delete().eq("token", token), "deleteDeviceToken");
  }

  async createOAuthState(
    input: { state: string; userId: string; provider: Provider; codeVerifier: string },
  ) {
    check(
      await this.client.from("oauth_states").insert({
        state: input.state,
        user_id: input.userId,
        provider: input.provider,
        code_verifier: input.codeVerifier,
      }),
      "createOAuthState",
    );
  }

  async consumeOAuthState(state: string) {
    const data = check(
      await this.client.from("oauth_states").delete().eq("state", state).gt(
        "expires_at",
        new Date().toISOString(),
      )
        .select("user_id,provider,code_verifier").maybeSingle(),
      "consumeOAuthState",
    );
    return data
      ? {
        userId: data.user_id,
        provider: data.provider as Provider,
        codeVerifier: data.code_verifier,
      }
      : null;
  }

  async enqueue(queue: QueueName, message: unknown, delaySeconds = 0) {
    check(
      await this.client.rpc("queue_send", {
        queue_name: queue,
        message,
        delay_seconds: delaySeconds,
      }),
      `enqueue ${queue}`,
    );
  }

  async readQueue<T>(queue: QueueName, visibilityTimeoutSeconds: number, quantity: number) {
    return (check(
      await this.client.rpc("queue_read", {
        queue_name: queue,
        visibility_timeout: visibilityTimeoutSeconds,
        quantity,
      }),
      `read ${queue}`,
    ) ?? []) as QueueMessage<T>[];
  }

  async deleteQueueMessage(queue: QueueName, msgId: number) {
    check(
      await this.client.rpc("queue_delete", { queue_name: queue, message_id: msgId }),
      `delete ${queue}`,
    );
  }

  async archiveQueueMessage(queue: QueueName, msgId: number) {
    check(
      await this.client.rpc("queue_archive", { queue_name: queue, message_id: msgId }),
      `archive ${queue}`,
    );
  }

  async delayQueueMessage(queue: QueueName, msgId: number, seconds: number) {
    check(
      await this.client.rpc("queue_set_visibility", {
        queue_name: queue,
        message_id: msgId,
        visibility_timeout: Math.max(1, Math.ceil(seconds)),
      }),
      `delay ${queue}`,
    );
  }

  async verifyCronSecret(secret: string | null) {
    if (!secret) return false;
    return Boolean(
      check(await this.client.rpc("verify_cron_secret", { p_secret: secret }), "verifyCronSecret"),
    );
  }
}
