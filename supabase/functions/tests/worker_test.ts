import { assertEquals } from "@std/assert";
import { ProviderHttpError, ReauthRequiredError } from "../_shared/http.ts";
import { drainQueues, MAX_ATTEMPTS } from "../_shared/worker.ts";
import { account, email, fakeGmail, makeDeps, MemoryStore, validTokens } from "./fakes.ts";

function setup(getMessage?: () => Promise<never>) {
  const gmail = fakeGmail([email()]);
  if (getMessage) gmail.getMessage = getMessage;
  const store = new MemoryStore();
  store.addAccount(account(), validTokens());
  const { deps, notifier } = makeDeps({ store, google: gmail });
  return { deps, store, gmail, notifier };
}

Deno.test("drain processes a queued message and deletes it", async () => {
  const { deps, store, notifier } = setup();
  await store.enqueue("mail_messages", { account_id: "acc-1", message_id: "msg-1" });

  const stats = await drainQueues(deps);

  assertEquals(stats.messages, { done: 1, failed: 0 });
  assertEquals(store.queues.mail_messages.length, 0);
  assertEquals(notifier.changes.length, 1);
});

Deno.test("transient failures are retried, then archived and recorded as failed", async () => {
  const { deps, store } = setup(() => Promise.reject(new Error("boom")));
  await store.enqueue("mail_messages", { account_id: "acc-1", message_id: "msg-1" });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    store.releaseAll();
    await drainQueues(deps);
  }

  assertEquals(store.queues.mail_messages.length, 0);
  assertEquals(store.archived, [{ queue: "mail_messages", msgId: 1 }]);
  assertEquals(store.processed.get("acc-1:msg-1")?.outcome, "failed");
});

Deno.test("a message below the attempt limit stays queued", async () => {
  const { deps, store } = setup(() => Promise.reject(new Error("boom")));
  await store.enqueue("mail_messages", { account_id: "acc-1", message_id: "msg-1" });

  const stats = await drainQueues(deps);

  assertEquals(stats.messages, { done: 0, failed: 1 });
  assertEquals(store.queues.mail_messages.length, 1);
  assertEquals(store.archived.length, 0);
});

Deno.test("429 with Retry-After pushes the job's visibility out instead of burning an attempt", async () => {
  const { deps, store } = setup(() => Promise.reject(new ProviderHttpError(429, "", "Graph", 37)));
  await store.enqueue("mail_messages", { account_id: "acc-1", message_id: "msg-1" });

  await drainQueues(deps);

  assertEquals(store.delayed, [{ queue: "mail_messages", msgId: 1, seconds: 37 }]);
  assertEquals(store.queues.mail_messages.length, 1);
});

Deno.test("reauth errors drop the job rather than retrying", async () => {
  const { deps, store } = setup(() => Promise.reject(new ReauthRequiredError("gone")));
  await store.enqueue("mail_messages", { account_id: "acc-1", message_id: "msg-1" });

  await drainQueues(deps);

  assertEquals(store.queues.mail_messages.length, 0);
  assertEquals(store.archived.length, 0);
});

Deno.test("sync jobs feed the messages queue within the same drain", async () => {
  const { deps, store, gmail } = setup();
  gmail.listed = ["msg-1"];
  await store.enqueue("mail_sync", { account_id: "acc-1", reason: "backfill" });

  const stats = await drainQueues(deps);

  assertEquals(stats.sync.done, 1);
  assertEquals(stats.messages.done, 1);
  assertEquals(store.processed.get("acc-1:msg-1")?.outcome, "job_related");
});
