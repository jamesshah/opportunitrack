import { handleOAuthCallback, oauthUrlsFromEnv } from "../_shared/handlers/oauth.ts";
import { createRuntime } from "../_shared/runtime.ts";

const runtime = createRuntime();

Deno.serve((req) => handleOAuthCallback(req, runtime, oauthUrlsFromEnv()));
