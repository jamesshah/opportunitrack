import type { Deps } from "../context.ts";
import { functionsBaseUrl, requireEnv } from "../env.ts";
import { bearerToken, json, safeEqual } from "../http.ts";
import { decodePubSubPush } from "../providers/gmail.ts";
import { notificationMessageId, parseGraphNotifications } from "../providers/outlook.ts";
import { QUEUES } from "../types.ts";

export type PushTokenVerifier = (token: string) => Promise<boolean>;

export function gmailPushAudienceFromEnv(): { audience: string; serviceAccountEmail: string } {
  return {
    audience: Deno.env.get("GMAIL_PUSH_AUDIENCE") || `${functionsBaseUrl()}/gmail-webhook`,
    serviceAccountEmail: requireEnv("GMAIL_PUSH_SERVICE_ACCOUNT"),
  };
}

/** Pub/Sub push endpoint. 2xx acks the message; anything else makes Pub/Sub retry. */
export async function handleGmailWebhook(
  req: Request,
  deps: Deps,
  verify: PushTokenVerifier,
): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const token = bearerToken(req);
  if (!token || !(await verify(token))) return json({ error: "unauthorized" }, 401);

  let notification;
  try {
    notification = decodePubSubPush(await req.json());
  } catch (error) {
    // Malformed messages would be redelivered forever; ack and log instead.
    console.warn("ignoring malformed Pub/Sub message", error);
    return new Response(null, { status: 204 });
  }

  const accounts = await deps.store.findAccountsByAddress("google", notification.emailAddress);
  for (const account of accounts) {
    if (account.status === "reauth_required") continue;
    await deps.store.enqueue(QUEUES.sync, {
      account_id: account.id,
      reason: "push",
      history_id: notification.historyId,
    });
  }
  return new Response(null, { status: 204 });
}

/** Graph change and lifecycle notifications, including the subscription validation handshake. */
export async function handleOutlookWebhook(req: Request, deps: Deps): Promise<Response> {
  const url = new URL(req.url);
  const validationToken = url.searchParams.get("validationToken");
  if (validationToken !== null) {
    return new Response(validationToken, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  for (const notification of parseGraphNotifications(body)) {
    const account = await deps.store.findAccountBySubscriptionId(notification.subscriptionId);
    const expected = account?.sync?.outlook_client_state;
    if (
      !account || !expected || !notification.clientState ||
      !safeEqual(notification.clientState, expected)
    ) {
      console.warn("dropping Graph notification with unknown subscription or bad clientState");
      continue;
    }
    if (notification.lifecycleEvent) {
      await deps.store.enqueue(QUEUES.sync, {
        account_id: account.id,
        reason: "lifecycle",
        lifecycle_event: notification.lifecycleEvent,
      });
      continue;
    }
    const messageId = notificationMessageId(notification);
    if (messageId && account.status !== "reauth_required") {
      await deps.store.enqueue(QUEUES.messages, { account_id: account.id, message_id: messageId });
    }
  }
  return new Response(null, { status: 202 });
}
