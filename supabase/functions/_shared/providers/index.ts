import { optionalEnv, requireEnv } from "../env.ts";
import type { Provider } from "../types.ts";
import { GmailProvider, type WatchResult } from "./gmail.ts";
import { type GraphSubscription, OutlookProvider } from "./outlook.ts";
import type { MailProvider, MessageSummary } from "./types.ts";

export interface GmailApi extends MailProvider {
  readonly id: "google";
  listHistory(
    accessToken: string,
    startHistoryId: string,
  ): Promise<{ messageIds: string[]; historyId: string }>;
  watch(accessToken: string): Promise<WatchResult>;
  stopWatch(accessToken: string): Promise<void>;
}

export interface OutlookApi extends MailProvider {
  readonly id: "microsoft";
  listInboxSummariesSince(
    accessToken: string,
    since: Date,
    limit: number,
  ): Promise<MessageSummary[]>;
  createSubscription(
    accessToken: string,
    params: { notificationUrl: string; lifecycleUrl: string; clientState: string; now?: Date },
  ): Promise<GraphSubscription>;
  renewSubscription(
    accessToken: string,
    subscriptionId: string,
    now?: Date,
  ): Promise<GraphSubscription>;
  reauthorizeSubscription(accessToken: string, subscriptionId: string): Promise<void>;
  deleteSubscription(accessToken: string, subscriptionId: string): Promise<void>;
}

export interface ProviderRegistry {
  readonly google: GmailApi;
  readonly microsoft: OutlookApi;
}

export function providerFor(registry: ProviderRegistry, provider: Provider): MailProvider {
  return provider === "google" ? registry.google : registry.microsoft;
}

/** Providers are built on first use so a function only needs the env vars it touches. */
export function providersFromEnv(): ProviderRegistry {
  let google: GmailApi | undefined;
  let microsoft: OutlookApi | undefined;
  return {
    get google() {
      return google ??= new GmailProvider({
        clientId: requireEnv("GOOGLE_CLIENT_ID"),
        clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
        pubsubTopic: Deno.env.get("GMAIL_PUBSUB_TOPIC") ?? undefined,
      });
    },
    get microsoft() {
      return microsoft ??= new OutlookProvider({
        clientId: requireEnv("MICROSOFT_CLIENT_ID"),
        clientSecret: requireEnv("MICROSOFT_CLIENT_SECRET"),
        tenant: optionalEnv("MICROSOFT_TENANT", "common"),
      });
    },
  };
}
