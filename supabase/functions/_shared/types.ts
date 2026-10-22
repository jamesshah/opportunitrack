export type Provider = "google" | "microsoft";

export const APPLICATION_STATUSES = ["applied", "interview", "rejected", "offer"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export type AccountStatus = "active" | "reauth_required" | "error";

export type MessageOutcome = "job_related" | "not_job_related" | "unmatched" | "failed";

export interface NormalizedEmail {
  id: string;
  subject: string;
  fromName: string | null;
  fromAddress: string | null;
  receivedAt: Date;
  text: string;
  labels?: string[];
}

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  /** Epoch milliseconds. */
  expires_at: number;
  scope?: string;
}

export interface EmailAccount {
  id: string;
  user_id: string;
  provider: Provider;
  email_address: string;
  status: AccountStatus;
  last_synced_at: string | null;
}

export interface EmailAccountSync {
  account_id: string;
  access_token_expires_at: string | null;
  gmail_history_id: string | null;
  gmail_watch_expires_at: string | null;
  gmail_watch_renewed_at: string | null;
  outlook_subscription_id: string | null;
  outlook_subscription_expires_at: string | null;
  outlook_client_state: string | null;
}

export interface AccountWithSync extends EmailAccount {
  sync: EmailAccountSync | null;
}

export interface DeviceToken {
  token: string;
  environment: "sandbox" | "production";
  bundle_id: string | null;
}

export interface RecordMessageInput {
  accountId: string;
  providerMessageId: string;
  receivedAt: Date | null;
  outcome: MessageOutcome;
  classifier?: string;
  classifierVersion?: string;
  jobProbability?: number | null;
  confidence?: number | null;
  company?: string | null;
  position?: string | null;
  status?: ApplicationStatus | null;
  subject?: string | null;
  sender?: string | null;
  error?: string | null;
}

export interface RecordMessageResult {
  duplicate: boolean;
  processed_message_id?: string;
  application_id?: string;
  user_id?: string;
  company_name?: string;
  position_title?: string | null;
  status?: ApplicationStatus;
  previous_status?: ApplicationStatus | null;
  created?: boolean;
  status_changed?: boolean;
}

export type SyncReason = "push" | "backfill" | "catchup" | "lifecycle";

export interface SyncJob {
  account_id: string;
  reason: SyncReason;
  /** ISO timestamp; list messages received after this instant. */
  since?: string;
  history_id?: string;
  lifecycle_event?: string;
}

export interface MessageJob {
  account_id: string;
  message_id: string;
}

export const QUEUES = {
  sync: "mail_sync",
  messages: "mail_messages",
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
