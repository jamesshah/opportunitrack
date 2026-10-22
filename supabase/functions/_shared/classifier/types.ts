import type { ApplicationStatus, NormalizedEmail } from "../types.ts";

export interface EmailClassification {
  isJobRelated: boolean;
  /** Probability (0–1) that the email is an update about the user's own application. */
  jobProbability: number;
  status: ApplicationStatus | null;
  company: string | null;
  position: string | null;
  /** Lowest confidence among the answers the result depends on, when known. */
  confidence: number | null;
  /** Concrete model/version that answered, e.g. `jev-1.13.0`. */
  model?: string;
}

/** Swap point for classification providers. */
export interface EmailClassifier {
  readonly name: string;
  readonly version: string;
  classify(email: NormalizedEmail): Promise<EmailClassification>;
}
