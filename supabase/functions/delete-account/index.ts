import { requireUser } from "../_shared/auth.ts";
import { handleDeleteAccount } from "../_shared/handlers/accounts.ts";
import { createRuntime } from "../_shared/runtime.ts";

const runtime = createRuntime();

Deno.serve((req) =>
  handleDeleteAccount(
    req,
    runtime,
    (r) => requireUser(r, runtime.store.client),
    async (userId) => {
      const { error } = await runtime.store.client.auth.admin.deleteUser(userId);
      if (error) throw error;
    },
  )
);
