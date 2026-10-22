import { requireCron } from "../_shared/auth.ts";
import { handleProcessQueue } from "../_shared/handlers/jobs.ts";
import { createRuntime } from "../_shared/runtime.ts";

const runtime = createRuntime();

Deno.serve((req) => handleProcessQueue(req, runtime, (r) => requireCron(r, runtime.store)));
