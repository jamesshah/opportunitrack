import type { Deps } from "./context.ts";
import { ProviderHttpError, ReauthRequiredError } from "./http.ts";
import { processMessage, recordFailedMessage } from "./pipeline.ts";
import type { QueueMessage } from "./store.ts";
import { syncAccount } from "./sync.ts";
import { type MessageJob, type QueueName, QUEUES, type SyncJob } from "./types.ts";

export const MAX_ATTEMPTS = 5;
const VISIBILITY_TIMEOUT_S = 120;

export interface DrainOptions {
  /** Stop picking up new batches after this many ms (Free plan wall clock is 150 s). */
  budgetMs?: number;
  syncBatch?: number;
  messageBatch?: number;
}

export interface DrainStats {
  sync: { done: number; failed: number };
  messages: { done: number; failed: number };
}

type Outcome = "done" | "retry" | "dead";

async function runJob<T>(
  deps: Deps,
  queue: QueueName,
  job: QueueMessage<T>,
  handler: (message: T) => Promise<unknown>,
  onDead: (message: T, error: unknown) => Promise<void>,
): Promise<Outcome> {
  try {
    await handler(job.message);
    await deps.store.deleteQueueMessage(queue, job.msg_id);
    return "done";
  } catch (error) {
    if (error instanceof ReauthRequiredError) {
      // The account was flagged and the user notified; retrying cannot succeed.
      await deps.store.deleteQueueMessage(queue, job.msg_id);
      return "dead";
    }
    if (
      error instanceof ProviderHttpError && error.isRateLimited && error.retryAfterSeconds !== null
    ) {
      await deps.store.delayQueueMessage(queue, job.msg_id, error.retryAfterSeconds);
      return "retry";
    }
    console.error(`${queue} job ${job.msg_id} failed (attempt ${job.read_ct})`, error);
    if (job.read_ct >= MAX_ATTEMPTS) {
      await onDead(job.message, error).catch((e) =>
        console.error("dead-letter handling failed", e)
      );
      await deps.store.archiveQueueMessage(queue, job.msg_id);
      return "dead";
    }
    return "retry";
  }
}

/** Groups jobs by account and runs each account's jobs one after another (Graph allows 4 concurrent per mailbox). */
async function runPerAccount<T extends { account_id: string }>(
  jobs: QueueMessage<T>[],
  run: (job: QueueMessage<T>) => Promise<Outcome>,
): Promise<Outcome[]> {
  const byAccount = new Map<string, QueueMessage<T>[]>();
  for (const job of jobs) {
    const key = job.message?.account_id ?? "";
    byAccount.set(key, [...(byAccount.get(key) ?? []), job]);
  }
  const results = await Promise.all([...byAccount.values()].map(async (group) => {
    const out: Outcome[] = [];
    for (const job of group) out.push(await run(job));
    return out;
  }));
  return results.flat();
}

export async function drainQueues(deps: Deps, options: DrainOptions = {}): Promise<DrainStats> {
  const deadline = deps.now().getTime() + (options.budgetMs ?? 40_000);
  const stats: DrainStats = { sync: { done: 0, failed: 0 }, messages: { done: 0, failed: 0 } };
  const tally = (bucket: { done: number; failed: number }, outcomes: Outcome[]) => {
    for (const o of outcomes) o === "done" ? bucket.done++ : bucket.failed++;
  };

  while (deps.now().getTime() < deadline) {
    const syncJobs = await deps.store.readQueue<SyncJob>(
      QUEUES.sync,
      VISIBILITY_TIMEOUT_S,
      options.syncBatch ?? 5,
    );
    tally(
      stats.sync,
      await runPerAccount(
        syncJobs,
        (job) => runJob(deps, QUEUES.sync, job, (m) => syncAccount(deps, m), async () => {}),
      ),
    );

    if (deps.now().getTime() >= deadline) break;

    const messageJobs = await deps.store.readQueue<MessageJob>(
      QUEUES.messages,
      VISIBILITY_TIMEOUT_S,
      options.messageBatch ?? 10,
    );
    tally(
      stats.messages,
      await runPerAccount(
        messageJobs,
        (job) =>
          runJob(
            deps,
            QUEUES.messages,
            job,
            (m) => processMessage(deps, m),
            (m, e) => recordFailedMessage(deps, m, e),
          ),
      ),
    );

    if (syncJobs.length === 0 && messageJobs.length === 0) break;
  }
  return stats;
}
