import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { base64UrlEncode } from "../_shared/encoding.ts";
import {
  decodePubSubPush,
  gmailBackfillQuery,
  GmailProvider,
  HistoryExpiredError,
  parseGmailMessage,
} from "../_shared/providers/gmail.ts";
import {
  MAX_SUBSCRIPTION_LIFETIME_MS,
  notificationMessageId,
  OutlookProvider,
  parseGraphNotifications,
  subscriptionExpiry,
} from "../_shared/providers/outlook.ts";
import { ReauthRequiredError } from "../_shared/http.ts";
import { classifyAuthError } from "../_shared/oauth/errors.ts";
import { jsonResponse, scriptedFetch } from "./fakes.ts";

const b64 = (s: string) => base64UrlEncode(new TextEncoder().encode(s));
const gmailConfig = { clientId: "cid", clientSecret: "secret", pubsubTopic: "projects/p/topics/t" };

Deno.test("parseGmailMessage prefers text/plain in multipart bodies", () => {
  const parsed = parseGmailMessage({
    id: "m1",
    internalDate: "1760000000000",
    labelIds: ["INBOX"],
    payload: {
      mimeType: "multipart/alternative",
      headers: [{ name: "From", value: "Acme <jobs@acme.com>" }, {
        name: "Subject",
        value: "Interview",
      }],
      parts: [
        { mimeType: "text/html", body: { data: b64("<p>html</p>") } },
        { mimeType: "text/plain", body: { data: b64("Plain body ✓") } },
      ],
    },
  });
  assertEquals(parsed.text, "Plain body ✓");
  assertEquals(parsed.fromAddress, "jobs@acme.com");
  assertEquals(parsed.receivedAt.getTime(), 1760000000000);
});

Deno.test("decodePubSubPush reads the Gmail payload", () => {
  const body = {
    message: { data: b64(JSON.stringify({ emailAddress: "Me@Example.com", historyId: 42 })) },
  };
  assertEquals(decodePubSubPush(body), { emailAddress: "me@example.com", historyId: "42" });
});

Deno.test("Gmail summary uses format=metadata (20 units) not full", async () => {
  const { fetch, requests } = scriptedFetch([
    () => jsonResponse({ id: "m1", snippet: "Thanks &amp; hi", payload: { headers: [] } }),
  ]);
  const summary = await new GmailProvider(gmailConfig, fetch).getMessageSummary("at", "m1");
  const url = new URL(requests[0].url);
  assertEquals(url.searchParams.get("format"), "metadata");
  assertEquals(url.searchParams.getAll("metadataHeaders"), ["From", "Subject", "Date"]);
  assertEquals(summary?.snippet, "Thanks & hi");
});

Deno.test("Gmail backfill query is search-filtered", () => {
  const q = gmailBackfillQuery(new Date("2026-10-01T00:00:00Z"));
  assertStringIncludes(q, "in:inbox after:1790812800");
  assertStringIncludes(q, "-category:promotions");
  assertStringIncludes(q, "{application ");
});

Deno.test("history.list pages and maps 404 to HistoryExpiredError", async () => {
  const { fetch, requests } = scriptedFetch([
    () =>
      jsonResponse({
        history: [{ messagesAdded: [{ message: { id: "a" } }] }],
        nextPageToken: "p2",
        historyId: "10",
      }),
    () =>
      jsonResponse({
        history: [{ messagesAdded: [{ message: { id: "b" } }, { message: { id: "a" } }] }],
        historyId: "12",
      }),
    () => new Response("gone", { status: 404 }),
  ]);
  const gmail = new GmailProvider(gmailConfig, fetch);
  assertEquals(await gmail.listHistory("at", "5"), { messageIds: ["a", "b"], historyId: "12" });
  const first = new URL(requests[0].url).searchParams;
  assertEquals(first.get("historyTypes"), "messageAdded");
  assertEquals(first.get("labelId"), "INBOX");
  await assertRejects(() => gmail.listHistory("at", "1"), HistoryExpiredError);
});

Deno.test("Gmail watch targets INBOX on the configured topic", async () => {
  const { fetch, requests } = scriptedFetch([
    () => jsonResponse({ historyId: "99", expiration: "1760600000000" }),
  ]);
  const result = await new GmailProvider(gmailConfig, fetch).watch("at");
  assertEquals(await requests[0].json(), {
    topicName: "projects/p/topics/t",
    labelIds: ["INBOX"],
    labelFilterBehavior: "INCLUDE",
  });
  assertEquals(result.historyId, "99");
});

Deno.test("invalid_grant on refresh means reconnect (e.g. Testing-mode 7-day expiry)", async () => {
  const { fetch } = scriptedFetch([
    () =>
      jsonResponse({
        error: "invalid_grant",
        error_description: "Token has been expired or revoked.",
      }, 400),
  ]);
  await assertRejects(
    () =>
      new GmailProvider(gmailConfig, fetch).refreshTokens({
        access_token: "a",
        refresh_token: "r",
        expires_at: 0,
      }),
    ReauthRequiredError,
  );
});

Deno.test("Google auth URL requests offline access with PKCE", () => {
  const url = new URL(
    new GmailProvider(gmailConfig).buildAuthorizationUrl({
      state: "s",
      codeChallenge: "c",
      redirectUri: "https://r",
    }),
  );
  assertEquals(url.searchParams.get("access_type"), "offline");
  assertEquals(url.searchParams.get("code_challenge_method"), "S256");
  assertStringIncludes(url.searchParams.get("scope")!, "gmail.readonly");
});

Deno.test("Graph subscription lifetime stays well under the 10,080-minute cap", () => {
  const now = new Date("2026-10-22T00:00:00Z");
  const lifetime = subscriptionExpiry(now).getTime() - now.getTime();
  assert(lifetime < MAX_SUBSCRIPTION_LIFETIME_MS);
  assertEquals(lifetime, 3 * 24 * 3600_000);
});

Deno.test("Graph subscription is basic (no resource data) with lifecycle URL", async () => {
  const { fetch, requests } = scriptedFetch([
    () => jsonResponse({ id: "s1", expirationDateTime: "2026-10-25T00:00:00Z" }, 201),
  ]);
  await new OutlookProvider({ clientId: "c", clientSecret: "s" }, fetch).createSubscription("at", {
    notificationUrl: "https://x/outlook-webhook",
    lifecycleUrl: "https://x/outlook-webhook?lifecycle=1",
    clientState: "cs",
    now: new Date("2026-10-22T00:00:00Z"),
  });
  const body = await requests[0].json();
  assertEquals(body.changeType, "created");
  assertEquals(body.resource, "me/mailFolders('inbox')/messages");
  assertEquals(body.expirationDateTime, "2026-10-25T00:00:00.000Z");
  assertEquals(body.includeResourceData, undefined);
  assertEquals(body.lifecycleNotificationUrl, "https://x/outlook-webhook?lifecycle=1");
});

Deno.test("Graph 429 keeps Retry-After for the queue", async () => {
  const { fetch } = scriptedFetch([
    () => new Response("throttled", { status: 429, headers: { "Retry-After": "17" } }),
  ]);
  const error = await assertRejects(() =>
    new OutlookProvider({ clientId: "c", clientSecret: "s" }, fetch).getMessage("at", "m")
  );
  assertEquals((error as { retryAfterSeconds: number }).retryAfterSeconds, 17);
});

Deno.test("Outlook backfill pages metadata-only listings", async () => {
  const { fetch, requests } = scriptedFetch([
    () =>
      jsonResponse({
        value: [{
          id: "1",
          subject: "Interview",
          bodyPreview: "p",
          from: { emailAddress: { address: "A@B.com" } },
        }],
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/next",
      }),
    () => jsonResponse({ value: [{ id: "2", isDraft: true }, { id: "3", subject: "x" }] }),
  ]);
  const out = await new OutlookProvider({ clientId: "c", clientSecret: "s" }, fetch)
    .listInboxSummariesSince("at", new Date(0), 50);
  assertEquals(out.map((s) => s.id), ["1", "3"]);
  assertEquals(out[0].fromAddress, "a@b.com");
  const select = new URL(requests[0].url).searchParams.get("$select")!;
  assert(!select.includes("body,"), "listing must not pull full bodies");
});

Deno.test("Graph notifications parse and yield message ids", () => {
  const notifications = parseGraphNotifications({
    value: [
      {
        subscriptionId: "s",
        clientState: "c",
        resource: "Users/u/Messages/AAMk=",
        resourceData: { id: "AAMk=" },
      },
      { subscriptionId: "s", resource: "Users/u/Messages/XYZ" },
      { nope: true },
    ],
  });
  assertEquals(notifications.length, 2);
  assertEquals(notificationMessageId(notifications[0]), "AAMk=");
  assertEquals(notificationMessageId(notifications[1]), "XYZ");
});

Deno.test("Microsoft work-tenant consent errors map to admin_consent_required", () => {
  assertEquals(
    classifyAuthError("access_denied", "AADSTS65001: The user or administrator has not consented"),
    "admin_consent_required",
  );
  assertEquals(
    classifyAuthError("invalid_request", "AADSTS90094: Need admin approval"),
    "admin_consent_required",
  );
  assertEquals(classifyAuthError("consent_required", null), "admin_consent_required");
  assertEquals(classifyAuthError("access_denied", "The user canceled"), "access_denied");
  assertEquals(classifyAuthError("server_error", "boom"), "exchange_failed");
});
