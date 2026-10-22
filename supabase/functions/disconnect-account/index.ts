import { requireUser } from "../_shared/auth.ts";
import { handleDisconnectAccount } from "../_shared/handlers/accounts.ts";
import { createRuntime } from "../_shared/runtime.ts";

const runtime = createRuntime();

Deno.serve((req) =>
  handleDisconnectAccount(req, runtime, (r) => requireUser(r, runtime.store.client))
);
