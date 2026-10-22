import type { EmailClassifier } from "./classifier/types.ts";
import { functionsBaseUrl, numberEnv, optionalEnv } from "./env.ts";
import type { Notifier } from "./notify/notifier.ts";
import type { ProviderRegistry } from "./providers/index.ts";
import type { Store } from "./store.ts";

export interface WorkerConfig {
  functionsBaseUrl: string;
  prefilterEnabled: boolean;
  backfillDays: number;
  backfillMaxMessages: number;
}

export interface Deps {
  store: Store;
  providers: ProviderRegistry;
  notifier: Notifier;
  /** Built lazily so functions that never classify don't need a model key. */
  classifier: () => EmailClassifier;
  config: WorkerConfig;
  now: () => Date;
}

export function workerConfigFromEnv(): WorkerConfig {
  return {
    functionsBaseUrl: functionsBaseUrl(),
    prefilterEnabled: optionalEnv("PREFILTER_ENABLED", "true") !== "false",
    backfillDays: numberEnv("BACKFILL_DAYS", 30),
    backfillMaxMessages: numberEnv("BACKFILL_MAX_MESSAGES", 300),
  };
}
