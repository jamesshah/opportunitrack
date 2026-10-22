import { requireCron } from "../_shared/auth.ts";
import { handleRenewSubscriptions } from "../_shared/handlers/jobs.ts";
import { createRuntime } from "../_shared/runtime.ts";

const runtime = createRuntime();

Deno.serve((req) => handleRenewSubscriptions(req, runtime, (r) => requireCron(r, runtime.store)));
