import type { ApplicationStatus, NormalizedEmail } from "../types.ts";
import { extractCompanyCandidates, extractPositionCandidates } from "./candidates.ts";
import type { EmailClassification, EmailClassifier } from "./types.ts";

/** Keyword fallback for local development or when no model key is configured. Low accuracy. */

const STATUS_RULES: [ApplicationStatus, RegExp][] = [
  ["offer", /\b(offer letter|pleased to offer|extend (you )?an offer|job offer|your offer)\b/i],
  [
    "rejected",
    /\b(unfortunately|regret to inform|not (be )?moving forward|decided to (move|proceed) (forward )?with other|other candidates|not been selected|will not be progressing|position has been filled)\b/i,
  ],
  [
    "interview",
    /\b(interview|phone screen|schedule (a )?(call|time|chat)|availability|next steps?|assessment|coding challenge|take-home|meet the team)\b/i,
  ],
  [
    "applied",
    /\b(thank(s| you) for (applying|your application|your interest)|application (has been )?(received|submitted)|we('ve| have) received your application|application confirmation)\b/i,
  ],
];

export class HeuristicClassifier implements EmailClassifier {
  readonly name = "heuristic";
  readonly version = "1";

  classify(email: NormalizedEmail): Promise<EmailClassification> {
    const text = `${email.subject}\n${email.text}`;
    const match = STATUS_RULES.find(([, re]) => re.test(text));
    const company = extractCompanyCandidates(email)[0] ?? null;
    const position = extractPositionCandidates(email)[0] ?? null;
    return Promise.resolve({
      isJobRelated: Boolean(match),
      jobProbability: match ? 0.7 : 0.1,
      status: match ? match[0] : null,
      company,
      position,
      confidence: match ? 0.5 : null,
      model: "heuristic-1",
    });
  }
}
