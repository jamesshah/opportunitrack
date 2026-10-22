import { gmailPushAudienceFromEnv, handleGmailWebhook } from "../_shared/handlers/webhooks.ts";
import { verifyPubSubPushToken } from "../_shared/providers/pubsub-auth.ts";
import { createRuntime } from "../_shared/runtime.ts";

const runtime = createRuntime();
const pushAuth = gmailPushAudienceFromEnv();

Deno.serve((req) =>
  handleGmailWebhook(req, runtime, (token) => verifyPubSubPushToken(token, pushAuth))
);
