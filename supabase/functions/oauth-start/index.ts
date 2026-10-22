import { requireUser } from "../_shared/auth.ts";
import { handleOAuthStart, oauthUrlsFromEnv } from "../_shared/handlers/oauth.ts";
import { createRuntime } from "../_shared/runtime.ts";

const runtime = createRuntime();

Deno.serve((req) =>
  handleOAuthStart(req, runtime, (r) => requireUser(r, runtime.store.client), oauthUrlsFromEnv())
);
