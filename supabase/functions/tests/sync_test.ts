import { assertEquals } from "@std/assert";
import { HistoryExpiredError } from "../_shared/providers/gmail.ts";
import { gmailWatchDue, outlookSubscriptionAction } from "../_shared/subscriptions.ts";
import { syncAccount } from "../_shared/sync.ts";
import {
  account,
  email,
  fakeGmail,
  fakeOutlook,
  makeDeps,
  MemoryStore,
  summaryOf,
  validTokens,
} from "./fakes.ts";

const HOUR = 3600_000;

function gmailAccount(historyId: string | null) {
  const a = account();
  a.sync!.gmail_history_id = historyId;
  return a;
}

Deno.test("push sync uses history.list and advances the stored history id", async () => {
  const gmail = fakeGmail();
  gmail.history = { messageIds: ["m1", "m2"], historyId: "120" };
  const store = new MemoryStore();
  store.addAccount(gmailAccount("100"), validTokens());
  const { deps } = makeDeps({ store, google: gmail });

  const result = await syncAccount(deps, {
    account_id: "acc-1",
    reason: "push",
    history_id: "120",
  });

  assertEquals(result.enqueued, 2);
  assertEquals(gmail.calls.log, ["history"]);
  assertEquals(store.accounts.get("acc-1")?.sync?.gmail_history_id, "120");
  assertEquals(store.queues.mail_messages.map((m) => m.message.message_id), ["m1", "m2"]);
});

Deno.test("expired history falls back to a filtered search listing and resets the cursor", async () => {
  const gmail = fakeGmail();
  gmail.history = new HistoryExpiredError();
  gmail.listed = ["m9"];
  const store = new MemoryStore();
  store.addAccount(gmailAccount("5"), validTokens());
  const { deps } = makeDeps({ store, google: gmail });

  const result = await syncAccount(deps, {
    account_id: "acc-1",
    reason: "push",
    history_id: "900",
  });

  assertEquals(result.enqueued, 1);
  assertEquals(gmail.calls.log, ["history", "list"]);
  assertEquals(store.accounts.get("acc-1")?.sync?.gmail_history_id, "900");
});

Deno.test("backfill skips history and never enqueues already-processed ids", async () => {
  const gmail = fakeGmail();
  gmail.listed = ["old", "new"];
  const store = new MemoryStore();
  store.addAccount(gmailAccount("100"), validTokens());
  store.processed.set("acc-1:old", {} as any);
  const { deps } = makeDeps({ store, google: gmail });

  const result = await syncAccount(deps, { account_id: "acc-1", reason: "backfill" });

  assertEquals(gmail.calls.log, ["list"]);
  assertEquals(result.enqueued, 1);
  assertEquals(store.accounts.get("acc-1")?.status, "active");
  assertEquals(typeof store.accounts.get("acc-1")?.last_synced_at, "string");
});

Deno.test("Outlook sync triages listing metadata before enqueueing", async () => {
  const outlook = fakeOutlook();
  outlook.summaries = [
    summaryOf(email({ id: "job" })),
    summaryOf(
      email({
        id: "news",
        subject: "Weekly digest",
        fromName: "News",
        fromAddress: "news@paper.example",
        text: "Headlines",
      }),
    ),
  ];
  const store = new MemoryStore();
  store.addAccount(account({ provider: "microsoft" }), validTokens());
  const { deps } = makeDeps({ store, microsoft: outlook });

  await syncAccount(deps, { account_id: "acc-1", reason: "catchup" });

  assertEquals(store.queues.mail_messages.map((m) => m.message.message_id), ["job"]);
});

Deno.test("Graph reauthorizationRequired lifecycle event reauthorizes and renews", async () => {
  const outlook = fakeOutlook();
  const a = account({ provider: "microsoft" });
  a.sync!.outlook_subscription_id = "sub-1";
  const store = new MemoryStore();
  store.addAccount(a, validTokens());
  const { deps } = makeDeps({ store, microsoft: outlook });

  await syncAccount(deps, {
    account_id: "acc-1",
    reason: "lifecycle",
    lifecycle_event: "reauthorizationRequired",
  });

  assertEquals(outlook.calls.log, ["reauthorize", "renew", "list"]);
});

Deno.test("Graph subscriptionRemoved lifecycle event recreates the subscription", async () => {
  const outlook = fakeOutlook();
  const a = account({ provider: "microsoft" });
  a.sync!.outlook_subscription_id = "sub-1";
  const store = new MemoryStore();
  store.addAccount(a, validTokens());
  const { deps } = makeDeps({ store, microsoft: outlook });

  await syncAccount(deps, {
    account_id: "acc-1",
    reason: "lifecycle",
    lifecycle_event: "subscriptionRemoved",
  });

  assertEquals(outlook.calls.log, ["create", "list"]);
  assertEquals(store.accounts.get("acc-1")?.sync?.outlook_subscription_id, "sub-new");
});

Deno.test("Gmail watch is renewed about daily, not only near the 7-day expiry", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  const sync = (renewedHoursAgo: number, expiresInHours: number) => ({
    ...account().sync!,
    gmail_watch_renewed_at: new Date(now.getTime() - renewedHoursAgo * HOUR).toISOString(),
    gmail_watch_expires_at: new Date(now.getTime() + expiresInHours * HOUR).toISOString(),
  });
  assertEquals(gmailWatchDue(null, now), true);
  assertEquals(gmailWatchDue(sync(6, 162), now), false);
  assertEquals(gmailWatchDue(sync(21, 147), now), true);
  assertEquals(gmailWatchDue(sync(1, 24), now), true);
});

Deno.test("Graph subscription is PATCHed when under 2 days remain", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  const sync = (expiresInHours: number) => ({
    ...account().sync!,
    outlook_subscription_id: "sub-1",
    outlook_subscription_expires_at: new Date(now.getTime() + expiresInHours * HOUR).toISOString(),
  });
  assertEquals(outlookSubscriptionAction(account().sync, now), "create");
  assertEquals(outlookSubscriptionAction(sync(60), now), "none");
  assertEquals(outlookSubscriptionAction(sync(47), now), "renew");
  assertEquals(outlookSubscriptionAction(sync(-1), now), "renew");
});
