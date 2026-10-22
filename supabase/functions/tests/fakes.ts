import type { EmailClassification, EmailClassifier } from "../_shared/classifier/types.ts";
import type { Deps, WorkerConfig } from "../_shared/context.ts";
import type { Notifier } from "../_shared/notify/notifier.ts";
import type { GmailApi, OutlookApi, ProviderRegistry } from "../_shared/providers/index.ts";
import type { MessageSummary } from "../_shared/providers/types.ts";
import type { AccountUpsert, QueueMessage, Store } from "../_shared/store.ts";
import type {
  AccountStatus,
  AccountWithSync,
  DeviceToken,
  EmailAccount,
  EmailAccountSync,
  NormalizedEmail,
  Provider,
  QueueName,
  RecordMessageInput,
  RecordMessageResult,
  TokenSet,
} from "../_shared/types.ts";

export function account(overrides: Partial<AccountWithSync> = {}): AccountWithSync {
  const id = overrides.id ?? "acc-1";
  return {
    id,
    user_id: "user-1",
    provider: "google",
    email_address: "me@example.com",
    status: "active",
    last_synced_at: null,
    sync: {
      account_id: id,
      access_token_expires_at: null,
      gmail_history_id: null,
      gmail_watch_expires_at: null,
      gmail_watch_renewed_at: null,
      outlook_subscription_id: null,
      outlook_subscription_expires_at: null,
      outlook_client_state: null,
    },
    ...overrides,
  };
}

export class MemoryStore implements Store {
  accounts = new Map<string, AccountWithSync>();
  tokens = new Map<string, TokenSet>();
  processed = new Map<string, RecordMessageInput>();
  applications = new Map<string, { id: string; status: string }>();
  devices: (DeviceToken & { user_id: string })[] = [];
  notificationsOn = true;
  oauthStates = new Map<string, { userId: string; provider: Provider; codeVerifier: string }>();
  queues: Record<string, QueueMessage<any>[]> = { mail_sync: [], mail_messages: [] };
  archived: { queue: string; msgId: number }[] = [];
  delayed: { queue: string; msgId: number; seconds: number }[] = [];
  cronSecret = "cron-secret";
  private nextMsgId = 1;

  addAccount(a: AccountWithSync, tokens?: TokenSet) {
    this.accounts.set(a.id, a);
    if (tokens) this.tokens.set(a.id, tokens);
    return a;
  }

  getAccount(id: string) {
    const a = this.accounts.get(id);
    return Promise.resolve(a ? structuredClone(a) : null);
  }
  findAccountsByAddress(provider: Provider, email: string) {
    return Promise.resolve(
      [...this.accounts.values()].filter((a) =>
        a.provider === provider && a.email_address === email.toLowerCase()
      ),
    );
  }
  findAccountBySubscriptionId(subscriptionId: string) {
    return Promise.resolve(
      [...this.accounts.values()].find((a) => a.sync?.outlook_subscription_id === subscriptionId) ??
        null,
    );
  }
  listAccounts(filter: { userId?: string; status?: AccountStatus }) {
    return Promise.resolve(
      [...this.accounts.values()].filter((a) =>
        (!filter.userId || a.user_id === filter.userId) &&
        (!filter.status || a.status === filter.status)
      ).map((a) => structuredClone(a)),
    );
  }
  upsertAccount(input: AccountUpsert): Promise<EmailAccount> {
    const existing = [...this.accounts.values()].find((a) =>
      a.user_id === input.userId && a.provider === input.provider &&
      a.email_address === input.emailAddress
    );
    const a = existing ?? account({
      id: `acc-${this.accounts.size + 1}`,
      user_id: input.userId,
      provider: input.provider,
      email_address: input.emailAddress,
    });
    a.status = "active";
    this.accounts.set(a.id, a);
    return Promise.resolve(a);
  }
  deleteAccount(id: string) {
    this.accounts.delete(id);
    this.tokens.delete(id);
    return Promise.resolve();
  }
  updateAccount(id: string, patch: Record<string, unknown>) {
    Object.assign(this.accounts.get(id)!, patch);
    return Promise.resolve();
  }
  updateSync(id: string, patch: Partial<EmailAccountSync>) {
    const a = this.accounts.get(id)!;
    a.sync = { ...a.sync!, ...patch };
    return Promise.resolve();
  }
  advanceHistoryId(id: string, historyId: string) {
    const sync = this.accounts.get(id)!.sync!;
    if (!sync.gmail_history_id || BigInt(historyId) > BigInt(sync.gmail_history_id)) {
      sync.gmail_history_id = historyId;
    }
    return Promise.resolve();
  }
  getTokens(id: string) {
    return Promise.resolve(this.tokens.get(id) ?? null);
  }
  saveTokens(id: string, tokens: TokenSet) {
    this.tokens.set(id, tokens);
    return Promise.resolve();
  }
  deleteTokens(id: string) {
    this.tokens.delete(id);
    return Promise.resolve();
  }
  filterUnprocessed(accountId: string, ids: string[]) {
    return Promise.resolve(ids.filter((id) => !this.processed.has(`${accountId}:${id}`)));
  }
  recordMessage(input: RecordMessageInput): Promise<RecordMessageResult> {
    const key = `${input.accountId}:${input.providerMessageId}`;
    if (this.processed.has(key)) return Promise.resolve({ duplicate: true });
    this.processed.set(key, input);
    if (input.outcome !== "job_related" || !input.company || !input.status) {
      return Promise.resolve({ duplicate: false, processed_message_id: key });
    }
    const appKey = input.company.toLowerCase();
    const existing = this.applications.get(appKey);
    const created = !existing;
    const statusChanged = !existing || existing.status !== input.status;
    const app = existing ?? { id: `app-${this.applications.size + 1}`, status: input.status };
    app.status = input.status;
    this.applications.set(appKey, app);
    return Promise.resolve({
      duplicate: false,
      processed_message_id: key,
      application_id: app.id,
      user_id: this.accounts.get(input.accountId)?.user_id,
      company_name: input.company,
      position_title: input.position ?? null,
      status: input.status,
      created,
      status_changed: statusChanged,
    });
  }
  notificationsEnabled() {
    return Promise.resolve(this.notificationsOn);
  }
  listDeviceTokens(userId: string) {
    return Promise.resolve(this.devices.filter((d) => d.user_id === userId));
  }
  deleteDeviceToken(token: string) {
    this.devices = this.devices.filter((d) => d.token !== token);
    return Promise.resolve();
  }
  createOAuthState(
    input: { state: string; userId: string; provider: Provider; codeVerifier: string },
  ) {
    this.oauthStates.set(input.state, input);
    return Promise.resolve();
  }
  consumeOAuthState(state: string) {
    const value = this.oauthStates.get(state) ?? null;
    this.oauthStates.delete(state);
    return Promise.resolve(value);
  }
  enqueue(queue: QueueName, message: unknown) {
    this.queues[queue].push({ msg_id: this.nextMsgId++, read_ct: 0, enqueued_at: "", message });
    return Promise.resolve();
  }
  readQueue<T>(queue: QueueName, _vt: number, quantity: number): Promise<QueueMessage<T>[]> {
    const visible = this.queues[queue].filter((m) => !(m as any).invisible).slice(0, quantity);
    for (const m of visible) {
      m.read_ct++;
      (m as any).invisible = true;
    }
    return Promise.resolve(visible as QueueMessage<T>[]);
  }
  /** Simulates visibility timeouts expiring. */
  releaseAll() {
    for (const q of Object.values(this.queues)) for (const m of q) delete (m as any).invisible;
  }
  deleteQueueMessage(queue: QueueName, msgId: number) {
    this.queues[queue] = this.queues[queue].filter((m) => m.msg_id !== msgId);
    return Promise.resolve();
  }
  archiveQueueMessage(queue: QueueName, msgId: number) {
    this.archived.push({ queue, msgId });
    return this.deleteQueueMessage(queue, msgId);
  }
  delayQueueMessage(queue: QueueName, msgId: number, seconds: number) {
    this.delayed.push({ queue, msgId, seconds });
    return Promise.resolve();
  }
  verifyCronSecret(secret: string | null) {
    return Promise.resolve(secret === this.cronSecret);
  }
}

export function email(overrides: Partial<NormalizedEmail> = {}): NormalizedEmail {
  return {
    id: "msg-1",
    subject: "Thank you for applying to Acme",
    fromName: "Acme Recruiting",
    fromAddress: "no-reply@acme.com",
    receivedAt: new Date("2026-10-20T12:00:00Z"),
    text:
      "Thanks for applying for the Senior Software Engineer position at Acme. We'll review your application.",
    labels: ["INBOX"],
    ...overrides,
  };
}

export function summaryOf(e: NormalizedEmail, full = false): MessageSummary {
  return {
    id: e.id,
    subject: e.subject,
    fromName: e.fromName,
    fromAddress: e.fromAddress,
    receivedAt: e.receivedAt,
    snippet: e.text.slice(0, 200),
    labels: e.labels,
    ...(full ? { full: e } : {}),
  };
}

export class Calls {
  log: string[] = [];
  record(name: string) {
    this.log.push(name);
  }
  count(name: string) {
    return this.log.filter((n) => n === name).length;
  }
}

export function fakeGmail(messages: NormalizedEmail[] = [], calls = new Calls()): GmailApi & {
  calls: Calls;
  history: { messageIds: string[]; historyId: string } | Error;
  refresh: (t: TokenSet) => Promise<TokenSet>;
  listed: string[];
} {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const api = {
    id: "google" as const,
    calls,
    history: { messageIds: [], historyId: "1" } as
      | { messageIds: string[]; historyId: string }
      | Error,
    listed: [] as string[],
    refresh: (t: TokenSet) =>
      Promise.resolve({ ...t, access_token: "refreshed", expires_at: Date.now() + 3600_000 }),
    buildAuthorizationUrl: () => "https://accounts.google.com/o/oauth2/v2/auth?fake",
    exchangeCode: () =>
      Promise.resolve({
        access_token: "at",
        refresh_token: "rt",
        expires_at: Date.now() + 3600_000,
      }),
    refreshTokens(t: TokenSet) {
      calls.record("refresh");
      return api.refresh(t);
    },
    getProfile: () => Promise.resolve({ emailAddress: "me@example.com", providerUserId: "sub-1" }),
    getMessageSummary(_t: string, id: string) {
      calls.record("summary");
      const m = byId.get(id);
      return Promise.resolve(m ? summaryOf(m) : null);
    },
    getMessage(_t: string, id: string) {
      calls.record("full");
      return Promise.resolve(byId.get(id) ?? null);
    },
    listCandidateMessageIdsSince() {
      calls.record("list");
      return Promise.resolve(api.listed);
    },
    listHistory() {
      calls.record("history");
      return api.history instanceof Error
        ? Promise.reject(api.history)
        : Promise.resolve(api.history);
    },
    watch() {
      calls.record("watch");
      return Promise.resolve({
        historyId: "500",
        expiration: new Date(Date.now() + 7 * 86400_000),
      });
    },
    stopWatch() {
      calls.record("stop");
      return Promise.resolve();
    },
  };
  return api;
}

export function fakeOutlook(
  calls = new Calls(),
): OutlookApi & { calls: Calls; summaries: MessageSummary[] } {
  const api = {
    id: "microsoft" as const,
    calls,
    summaries: [] as MessageSummary[],
    buildAuthorizationUrl: () =>
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?fake",
    exchangeCode: () =>
      Promise.resolve({
        access_token: "at",
        refresh_token: "rt",
        expires_at: Date.now() + 3600_000,
      }),
    refreshTokens: (t: TokenSet) => Promise.resolve(t),
    getProfile: () => Promise.resolve({ emailAddress: "me@outlook.com", providerUserId: "oid-1" }),
    getMessageSummary: () => Promise.resolve(null),
    getMessage: () => Promise.resolve(null),
    listCandidateMessageIdsSince: () => Promise.resolve([]),
    listInboxSummariesSince() {
      calls.record("list");
      return Promise.resolve(api.summaries);
    },
    createSubscription() {
      calls.record("create");
      return Promise.resolve({
        id: "sub-new",
        expirationDateTime: new Date(Date.now() + 3 * 86400_000).toISOString(),
      });
    },
    renewSubscription(_t: string, id: string) {
      calls.record("renew");
      return Promise.resolve({
        id,
        expirationDateTime: new Date(Date.now() + 3 * 86400_000).toISOString(),
      });
    },
    reauthorizeSubscription() {
      calls.record("reauthorize");
      return Promise.resolve();
    },
    deleteSubscription() {
      calls.record("delete");
      return Promise.resolve();
    },
  };
  return api;
}

export class FakeClassifier implements EmailClassifier {
  readonly name = "fake";
  readonly version = "1";
  calls = 0;
  constructor(public result: Partial<EmailClassification> = {}) {}
  classify(): Promise<EmailClassification> {
    this.calls++;
    return Promise.resolve({
      isJobRelated: true,
      jobProbability: 0.95,
      status: "applied",
      company: "Acme",
      position: "Senior Software Engineer",
      confidence: 0.9,
      model: "fake-1",
      ...this.result,
    });
  }
}

export class RecordingNotifier implements Notifier {
  changes: RecordMessageResult[] = [];
  reconnects: EmailAccount[] = [];
  applicationChanged(result: RecordMessageResult) {
    this.changes.push(result);
    return Promise.resolve();
  }
  reconnectRequired(account: EmailAccount) {
    this.reconnects.push(account);
    return Promise.resolve();
  }
}

export function makeDeps(overrides: {
  store?: MemoryStore;
  google?: GmailApi;
  microsoft?: OutlookApi;
  classifier?: EmailClassifier;
  notifier?: RecordingNotifier;
  config?: Partial<WorkerConfig>;
  now?: Date;
} = {}) {
  const store = overrides.store ?? new MemoryStore();
  const classifier = overrides.classifier ?? new FakeClassifier();
  const notifier = overrides.notifier ?? new RecordingNotifier();
  const providers: ProviderRegistry = {
    google: overrides.google ?? fakeGmail(),
    microsoft: overrides.microsoft ?? fakeOutlook(),
  };
  const deps: Deps = {
    store,
    providers,
    notifier,
    classifier: () => classifier,
    config: {
      functionsBaseUrl: "https://ref.supabase.co/functions/v1",
      prefilterEnabled: true,
      backfillDays: 30,
      backfillMaxMessages: 300,
      ...overrides.config,
    },
    now: () => overrides.now ?? new Date(),
  };
  return { deps, store, classifier, notifier };
}

export const validTokens = (): TokenSet => ({
  access_token: "at",
  refresh_token: "rt",
  expires_at: Date.now() + 3600_000,
});

/** fetch stub that answers from a list of handlers in order and records requests. */
export function scriptedFetch(responses: ((req: Request) => Response | Promise<Response>)[]) {
  const requests: Request[] = [];
  const fn = (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    requests.push(req);
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request ${req.method} ${req.url}`);
    return Promise.resolve(next(req));
  };
  return { fetch: fn as typeof fetch, requests };
}

export const jsonResponse = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
