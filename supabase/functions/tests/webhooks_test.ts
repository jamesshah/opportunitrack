import { assertEquals } from "@std/assert";
import { handleGmailWebhook, handleOutlookWebhook } from "../_shared/handlers/webhooks.ts";
import { account, makeDeps, MemoryStore } from "./fakes.ts";

const pubsubBody = (payload: unknown) => ({
  message: { data: btoa(JSON.stringify(payload)), messageId: "1" },
  subscription: "projects/p/subscriptions/s",
});

function gmailRequest(body: unknown, token = "good") {
  return new Request("https://ref.supabase.co/functions/v1/gmail-webhook", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const verify = (token: string) => Promise.resolve(token === "good");

Deno.test("Gmail webhook rejects unauthenticated pushes", async () => {
  const { deps, store } = makeDeps();
  const res = await handleGmailWebhook(gmailRequest(pubsubBody({}), "forged"), deps, verify);
  assertEquals(res.status, 401);
  assertEquals(store.queues.mail_sync.length, 0);
});

Deno.test("Gmail webhook enqueues a push sync for the matching account", async () => {
  const store = new MemoryStore();
  store.addAccount(account());
  store.addAccount(
    account({
      id: "acc-2",
      status: "reauth_required",
      email_address: "me@example.com",
      user_id: "user-2",
    }),
  );
  const { deps } = makeDeps({ store });

  const res = await handleGmailWebhook(
    gmailRequest(pubsubBody({ emailAddress: "Me@Example.com", historyId: 4242 })),
    deps,
    verify,
  );

  assertEquals(res.status, 204);
  assertEquals(store.queues.mail_sync.map((m) => m.message), [
    { account_id: "acc-1", reason: "push", history_id: "4242" },
  ]);
});

Deno.test("Gmail webhook acks malformed messages so Pub/Sub stops redelivering", async () => {
  const { deps } = makeDeps();
  const res = await handleGmailWebhook(gmailRequest({ message: {} }), deps, verify);
  assertEquals(res.status, 204);
});

Deno.test("Outlook webhook echoes the validation token as text/plain", async () => {
  const { deps } = makeDeps();
  const res = await handleOutlookWebhook(
    new Request("https://ref.supabase.co/functions/v1/outlook-webhook?validationToken=abc%20123", {
      method: "POST",
    }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "text/plain");
  assertEquals(await res.text(), "abc 123");
});

function outlookStore() {
  const store = new MemoryStore();
  const a = account({ provider: "microsoft" });
  a.sync!.outlook_subscription_id = "sub-1";
  a.sync!.outlook_client_state = "secret-state";
  store.addAccount(a);
  return store;
}

const graphRequest = (value: unknown[]) =>
  new Request("https://ref.supabase.co/functions/v1/outlook-webhook", {
    method: "POST",
    body: JSON.stringify({ value }),
  });

Deno.test("Outlook webhook queues message ids only when clientState matches", async () => {
  const store = outlookStore();
  const { deps } = makeDeps({ store });

  const res = await handleOutlookWebhook(
    graphRequest([
      {
        subscriptionId: "sub-1",
        clientState: "secret-state",
        resource: "Users/x/Messages/AAA",
        resourceData: { id: "AAA" },
      },
      { subscriptionId: "sub-1", clientState: "wrong", resourceData: { id: "BBB" } },
      { subscriptionId: "sub-unknown", clientState: "secret-state", resourceData: { id: "CCC" } },
    ]),
    deps,
  );

  assertEquals(res.status, 202);
  assertEquals(store.queues.mail_messages.map((m) => m.message), [{
    account_id: "acc-1",
    message_id: "AAA",
  }]);
});

Deno.test("Outlook lifecycle notifications go to the sync queue", async () => {
  const store = outlookStore();
  const { deps } = makeDeps({ store });

  await handleOutlookWebhook(
    graphRequest([{
      subscriptionId: "sub-1",
      clientState: "secret-state",
      lifecycleEvent: "reauthorizationRequired",
    }]),
    deps,
  );

  assertEquals(store.queues.mail_sync.map((m) => m.message), [
    { account_id: "acc-1", reason: "lifecycle", lifecycle_event: "reauthorizationRequired" },
  ]);
  assertEquals(store.queues.mail_messages.length, 0);
});
