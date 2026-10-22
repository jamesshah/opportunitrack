import { createClassifierFromEnv } from "./classifier/index.ts";
import type { EmailClassifier } from "./classifier/types.ts";
import { type Deps, workerConfigFromEnv } from "./context.ts";
import { notifierFromEnv } from "./notify/notifier.ts";
import { providersFromEnv } from "./providers/index.ts";
import { createAdminClient, SupabaseStore } from "./store.ts";

/** Production wiring for Edge Functions. Tests build `Deps` with fakes instead. */
export function createRuntime(): Deps & { store: SupabaseStore } {
  const store = new SupabaseStore(createAdminClient());
  let classifier: EmailClassifier | undefined;
  return {
    store,
    providers: providersFromEnv(),
    notifier: notifierFromEnv(store),
    classifier: () => classifier ??= createClassifierFromEnv(),
    config: workerConfigFromEnv(),
    now: () => new Date(),
  };
}
