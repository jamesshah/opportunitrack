import { assertEquals, assertRejects } from "@std/assert";
import { ReauthRequiredError } from "../_shared/http.ts";
import { processMessage } from "../_shared/pipeline.ts";
import {
  account,
  Calls,
  email,
  FakeClassifier,
  fakeGmail,
  makeDeps,
  MemoryStore,
  validTokens,
} from "./fakes.ts";

Deno.test("job-related email is classified, recorded and pushed", async () => {
  const gmail = fakeGmail([email()]);
  const store = new MemoryStore();
  store.addAccount(account(), validTokens());
  const { deps, notifier, classifier } = makeDeps({ store, google: gmail });

  const result = await processMessage(deps, { account_id: "acc-1", message_id: "msg-1" });

  assertEquals(result.kind, "recorded");
  assertEquals((classifier as FakeClassifier).calls, 1);
  assertEquals(gmail.calls.log, ["summary", "full"]);
  assertEquals(store.processed.get("acc-1:msg-1")?.outcome, "job_related");
  assertEquals(store.processed.get("acc-1:msg-1")?.company, "Acme");
  assertEquals(notifier.changes.length, 1);
});

Deno.test("prefilter rejects bulk mail from metadata without a full fetch or model call", async () => {
  const gmail = fakeGmail([
    email({
      subject: "50% off sneakers",
      fromName: "Shoe Shop",
      fromAddress: "deals@shoes.example",
      text: "Sale",
      labels: ["INBOX", "CATEGORY_PROMOTIONS"],
    }),
  ]);
  const store = new MemoryStore();
  store.addAccount(account(), validTokens());
  const { deps, notifier, classifier } = makeDeps({ store, google: gmail });

  await processMessage(deps, { account_id: "acc-1", message_id: "msg-1" });

  assertEquals(gmail.calls.count("full"), 0);
  assertEquals((classifier as FakeClassifier).calls, 0);
  const recorded = store.processed.get("acc-1:msg-1");
  assertEquals(recorded?.outcome, "not_job_related");
  assertEquals(recorded?.classifier, "prefilter");
  assertEquals(notifier.changes.length, 0);
});

Deno.test("job-related but no company is recorded as unmatched and not pushed", async () => {
  const store = new MemoryStore();
  store.addAccount(account(), validTokens());
  const { deps, notifier } = makeDeps({
    store,
    google: fakeGmail([email()]),
    classifier: new FakeClassifier({ company: null }),
  });

  const result = await processMessage(deps, { account_id: "acc-1", message_id: "msg-1" });

  assertEquals(result.kind === "recorded" && result.outcome, "unmatched");
  assertEquals(store.processed.get("acc-1:msg-1")?.company, null);
  assertEquals(notifier.changes.length, 0);
});

Deno.test("already-processed message is skipped before any provider call", async () => {
  const gmail = fakeGmail([email()]);
  const store = new MemoryStore();
  store.addAccount(account(), validTokens());
  const { deps } = makeDeps({ store, google: gmail });

  await processMessage(deps, { account_id: "acc-1", message_id: "msg-1" });
  const second = await processMessage(deps, { account_id: "acc-1", message_id: "msg-1" });

  assertEquals(second.kind, "duplicate");
  assertEquals(gmail.calls.count("summary"), 1);
});

Deno.test("revoked refresh token flips the account to reauth_required and notifies once", async () => {
  const calls = new Calls();
  const gmail = fakeGmail([email(), email({ id: "msg-2" })], calls);
  gmail.refresh = () => Promise.reject(new ReauthRequiredError("invalid_grant"));
  const store = new MemoryStore();
  store.addAccount(account(), { ...validTokens(), expires_at: Date.now() - 1000 });
  const { deps, notifier } = makeDeps({ store, google: gmail });

  await assertRejects(
    () => processMessage(deps, { account_id: "acc-1", message_id: "msg-1" }),
    ReauthRequiredError,
  );
  const second = await processMessage(deps, { account_id: "acc-1", message_id: "msg-2" });

  assertEquals(store.accounts.get("acc-1")?.status, "reauth_required");
  assertEquals(notifier.reconnects.length, 1);
  assertEquals(second.kind, "skipped_account");
  assertEquals(calls.count("summary"), 0);
});

Deno.test("expiring access token is refreshed and the new token persisted", async () => {
  const gmail = fakeGmail([email()]);
  const store = new MemoryStore();
  store.addAccount(account(), { ...validTokens(), expires_at: Date.now() + 30_000 });
  const { deps } = makeDeps({ store, google: gmail });

  await processMessage(deps, { account_id: "acc-1", message_id: "msg-1" });

  assertEquals(gmail.calls.count("refresh"), 1);
  assertEquals(store.tokens.get("acc-1")?.access_token, "refreshed");
});
