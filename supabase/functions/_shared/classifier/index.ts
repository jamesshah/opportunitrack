import { ConfigError, numberEnv, optionalEnv, requireEnv } from "../env.ts";
import { HeuristicClassifier } from "./heuristic.ts";
import { SystemOneClassifier } from "./systemone.ts";
import type { EmailClassifier } from "./types.ts";

export type { EmailClassification, EmailClassifier } from "./types.ts";

export function createClassifierFromEnv(): EmailClassifier {
  const provider = optionalEnv("CLASSIFIER_PROVIDER", "systemone");
  switch (provider) {
    case "systemone":
      return new SystemOneClassifier({
        apiKey: requireEnv("TYPESAFE_API_KEY"),
        model: optionalEnv("TYPESAFE_MODEL", "jev-latest"),
        baseUrl: optionalEnv("TYPESAFE_BASE_URL", "https://api.typesafe.ai"),
        jobThreshold: numberEnv("JOB_THRESHOLD", 0.6),
      });
    case "heuristic":
      return new HeuristicClassifier();
    default:
      throw new ConfigError(`Unknown CLASSIFIER_PROVIDER "${provider}"`);
  }
}
