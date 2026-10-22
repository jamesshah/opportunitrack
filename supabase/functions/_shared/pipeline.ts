import { prefilterMessage } from "./classifier/prefilter.ts";
import type { Deps } from "./context.ts";
import { providerFor } from "./providers/index.ts";
import { getAccessToken } from "./tokens.ts";
import type { MessageJob, MessageOutcome, RecordMessageResult } from "./types.ts";

export type ProcessResult =
  | { kind: "duplicate" }
  | { kind: "missing" }
  | { kind: "skipped_account" }
  | { kind: "recorded"; outcome: MessageOutcome; result: RecordMessageResult };

/**
 * Fetches, triages, classifies and records one message. Safe to run more than
 * once for the same message: `record_classified_message` is idempotent.
 */
export async function processMessage(deps: Deps, job: MessageJob): Promise<ProcessResult> {
  const account = await deps.store.getAccount(job.account_id);
  if (!account || account.status === "reauth_required") return { kind: "skipped_account" };

  const [unprocessed] = await deps.store.filterUnprocessed(account.id, [job.message_id]);
  if (!unprocessed) return { kind: "duplicate" };

  const provider = providerFor(deps.providers, account.provider);
  const accessToken = await getAccessToken(deps, account);

  const summary = await provider.getMessageSummary(accessToken, job.message_id);
  if (!summary) return { kind: "missing" };
  const sender = [summary.fromName, summary.fromAddress && `<${summary.fromAddress}>`].filter(
    Boolean,
  ).join(" ");

  if (deps.config.prefilterEnabled) {
    const triage = prefilterMessage(summary);
    if (!triage.candidate) {
      const result = await deps.store.recordMessage({
        accountId: account.id,
        providerMessageId: summary.id,
        receivedAt: summary.receivedAt,
        outcome: "not_job_related",
        classifier: "prefilter",
        classifierVersion: triage.reason,
      });
      return result.duplicate
        ? { kind: "duplicate" }
        : { kind: "recorded", outcome: "not_job_related", result };
    }
  }

  const email = summary.full ?? await provider.getMessage(accessToken, job.message_id);
  if (!email) return { kind: "missing" };

  const classifier = deps.classifier();
  const classification = await classifier.classify(email);

  let outcome: MessageOutcome = "not_job_related";
  if (classification.isJobRelated) {
    outcome = classification.company && classification.status ? "job_related" : "unmatched";
  }

  const result = await deps.store.recordMessage({
    accountId: account.id,
    providerMessageId: email.id,
    receivedAt: email.receivedAt,
    outcome,
    classifier: classifier.name,
    classifierVersion: classification.model ?? classifier.version,
    jobProbability: classification.jobProbability,
    confidence: classification.confidence,
    company: outcome === "job_related" ? classification.company : null,
    position: outcome === "job_related" ? classification.position : null,
    status: outcome === "job_related" ? classification.status : null,
    subject: email.subject,
    sender,
  });
  if (result.duplicate) return { kind: "duplicate" };

  if (outcome === "job_related") await deps.notifier.applicationChanged(result);
  return { kind: "recorded", outcome, result };
}

/** Records a message that exhausted its retries so it isn't fetched forever. */
export async function recordFailedMessage(
  deps: Deps,
  job: MessageJob,
  error: unknown,
): Promise<void> {
  const account = await deps.store.getAccount(job.account_id);
  if (!account) return;
  await deps.store.recordMessage({
    accountId: account.id,
    providerMessageId: job.message_id,
    receivedAt: null,
    outcome: "failed",
    error: String(error instanceof Error ? error.message : error).slice(0, 1000),
  });
}
