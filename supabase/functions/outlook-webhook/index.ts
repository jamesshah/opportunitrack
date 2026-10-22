import { handleOutlookWebhook } from "../_shared/handlers/webhooks.ts";
import { createRuntime } from "../_shared/runtime.ts";

const runtime = createRuntime();

Deno.serve((req) => handleOutlookWebhook(req, runtime));
