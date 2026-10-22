import { decodeJwtPayload } from "../encoding.ts";
import { htmlToText, normalizeWhitespace } from "../email/text.ts";
import { type FetchFn, fetchJson, ProviderHttpError, ReauthRequiredError } from "../http.ts";
import type { NormalizedEmail, TokenSet } from "../types.ts";
import { postTokenRequest } from "./oauth-token.ts";
import {
  type AuthorizationRequest,
  type CodeExchange,
  type MailboxProfile,
  type MailProvider,
  type MessageSummary,
  toTokenSet,
} from "./types.ts";

const SCOPES = ["openid", "email", "offline_access", "User.Read", "Mail.Read"];
const GRAPH = "https://graph.microsoft.com/v1.0";
const SUMMARY_FIELDS = "id,subject,from,receivedDateTime,bodyPreview,isDraft";

/** Graph caps message subscriptions at 10,080 minutes; we stay well under and renew daily. */
export const SUBSCRIPTION_LIFETIME_MS = 3 * 24 * 60 * 60 * 1000;
export const MAX_SUBSCRIPTION_LIFETIME_MS = 10_080 * 60 * 1000;

export interface OutlookConfig {
  clientId: string;
  clientSecret: string;
  tenant?: string;
}

interface GraphMessage {
  id: string;
  subject?: string | null;
  from?: { emailAddress?: { name?: string; address?: string } } | null;
  receivedDateTime?: string;
  bodyPreview?: string;
  isDraft?: boolean;
  body?: { contentType?: string; content?: string };
}

export interface GraphSubscription {
  id: string;
  expirationDateTime: string;
}

export class OutlookProvider implements MailProvider {
  readonly id = "microsoft" as const;
  private readonly authority: string;

  constructor(private readonly config: OutlookConfig, private readonly fetchFn: FetchFn = fetch) {
    this.authority = `https://login.microsoftonline.com/${config.tenant || "common"}/oauth2/v2.0`;
  }

  buildAuthorizationUrl({ state, codeChallenge, redirectUri }: AuthorizationRequest): string {
    const url = new URL(`${this.authority}/authorize`);
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: "code",
      response_mode: "query",
      redirect_uri: redirectUri,
      scope: SCOPES.join(" "),
      prompt: "select_account",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    }).toString();
    return url.toString();
  }

  async exchangeCode({ code, codeVerifier, redirectUri }: CodeExchange): Promise<TokenSet> {
    const response = await postTokenRequest(this.fetchFn, `${this.authority}/token`, {
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: SCOPES.join(" "),
    }, { isRefresh: false });
    const tokens = toTokenSet(response);
    if (response.id_token) {
      const claims = decodeJwtPayload(response.id_token);
      (tokens as TokenSet & { id_token_sub?: string }).id_token_sub =
        String(claims.oid ?? claims.sub ?? "") || undefined;
    }
    return tokens;
  }

  /** Microsoft rotates refresh tokens; the new one replaces the stored one. */
  async refreshTokens(tokens: TokenSet): Promise<TokenSet> {
    if (!tokens.refresh_token) throw new ReauthRequiredError("no refresh token stored");
    const response = await postTokenRequest(this.fetchFn, `${this.authority}/token`, {
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: SCOPES.join(" "),
    }, { isRefresh: true });
    return toTokenSet(response, tokens);
  }

  async getProfile(accessToken: string, tokens?: TokenSet): Promise<MailboxProfile> {
    const me = await this.request<{ id: string; mail?: string | null; userPrincipalName?: string }>(
      accessToken,
      `${GRAPH}/me?$select=id,mail,userPrincipalName`,
      {},
      "graph me",
    );
    const email = me.mail || me.userPrincipalName;
    if (!email) throw new Error("Microsoft account has no mail address");
    const sub = (tokens as (TokenSet & { id_token_sub?: string }) | undefined)?.id_token_sub;
    return { emailAddress: email.toLowerCase(), providerUserId: me.id ?? sub ?? null };
  }

  /** Graph metadata and body cost the same single request, so the summary carries the full message. */
  async getMessageSummary(accessToken: string, messageId: string): Promise<MessageSummary | null> {
    const full = await this.getMessage(accessToken, messageId);
    if (!full) return null;
    return {
      id: full.id,
      subject: full.subject,
      fromName: full.fromName,
      fromAddress: full.fromAddress,
      receivedAt: full.receivedAt,
      snippet: full.text.slice(0, 255),
      labels: full.labels,
      full,
    };
  }

  async getMessage(accessToken: string, messageId: string): Promise<NormalizedEmail | null> {
    try {
      const message = await this.request<GraphMessage>(
        accessToken,
        `${GRAPH}/me/messages/${encodeURIComponent(messageId)}?$select=${SUMMARY_FIELDS},body`,
        { headers: { Prefer: 'outlook.body-content-type="text"' } },
        "graph get message",
      );
      return message.isDraft ? null : parseGraphMessage(message);
    } catch (error) {
      if (error instanceof ProviderHttpError && error.status === 404) return null;
      throw error;
    }
  }

  async listCandidateMessageIdsSince(
    accessToken: string,
    since: Date,
    limit: number,
  ): Promise<string[]> {
    const summaries = await this.listInboxSummariesSince(accessToken, since, limit);
    return summaries.map((s) => s.id);
  }

  /** One list call returns subject, sender and preview for up to 100 messages. */
  async listInboxSummariesSince(
    accessToken: string,
    since: Date,
    limit: number,
  ): Promise<MessageSummary[]> {
    const out: MessageSummary[] = [];
    const params = new URLSearchParams({
      $select: SUMMARY_FIELDS,
      $filter: `receivedDateTime ge ${since.toISOString()}`,
      $orderby: "receivedDateTime desc",
      $top: "100",
    });
    let next: string | undefined = `${GRAPH}/me/mailFolders/inbox/messages?${params}`;
    while (next && out.length < limit) {
      const page: { value?: GraphMessage[]; "@odata.nextLink"?: string } = await this.request(
        accessToken,
        next,
        {},
        "graph list messages",
      );
      for (const m of page.value ?? []) {
        if (m.isDraft) continue;
        const parsed = parseGraphMessage(m);
        out.push({
          id: parsed.id,
          subject: parsed.subject,
          fromName: parsed.fromName,
          fromAddress: parsed.fromAddress,
          receivedAt: parsed.receivedAt,
          snippet: m.bodyPreview ?? "",
        });
      }
      next = page["@odata.nextLink"];
    }
    return out.slice(0, limit);
  }

  async createSubscription(
    accessToken: string,
    params: { notificationUrl: string; lifecycleUrl: string; clientState: string; now?: Date },
  ): Promise<GraphSubscription> {
    return await this.request<GraphSubscription>(accessToken, `${GRAPH}/subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changeType: "created",
        notificationUrl: params.notificationUrl,
        lifecycleNotificationUrl: params.lifecycleUrl,
        resource: "me/mailFolders('inbox')/messages",
        expirationDateTime: subscriptionExpiry(params.now).toISOString(),
        clientState: params.clientState,
      }),
    }, "graph create subscription");
  }

  async renewSubscription(
    accessToken: string,
    subscriptionId: string,
    now?: Date,
  ): Promise<GraphSubscription> {
    return await this.request<GraphSubscription>(
      accessToken,
      `${GRAPH}/subscriptions/${encodeURIComponent(subscriptionId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expirationDateTime: subscriptionExpiry(now).toISOString() }),
      },
      "graph renew subscription",
    );
  }

  async reauthorizeSubscription(accessToken: string, subscriptionId: string): Promise<void> {
    await this.request<void>(
      accessToken,
      `${GRAPH}/subscriptions/${encodeURIComponent(subscriptionId)}/reauthorize`,
      { method: "POST" },
      "graph reauthorize subscription",
    );
  }

  async deleteSubscription(accessToken: string, subscriptionId: string): Promise<void> {
    try {
      await this.request<void>(
        accessToken,
        `${GRAPH}/subscriptions/${encodeURIComponent(subscriptionId)}`,
        { method: "DELETE" },
        "graph delete subscription",
      );
    } catch (error) {
      if (!(error instanceof ProviderHttpError && error.status === 404)) throw error;
    }
  }

  private request<T>(
    accessToken: string,
    url: string,
    init: RequestInit,
    context: string,
  ): Promise<T> {
    return fetchJson<T>(this.fetchFn, url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        ...init.headers,
      },
    }, context);
  }
}

export function subscriptionExpiry(now = new Date()): Date {
  return new Date(
    now.getTime() + Math.min(SUBSCRIPTION_LIFETIME_MS, MAX_SUBSCRIPTION_LIFETIME_MS - 60_000),
  );
}

export function parseGraphMessage(message: GraphMessage): NormalizedEmail {
  const content = message.body?.content ?? "";
  const text = message.body?.contentType?.toLowerCase() === "html"
    ? htmlToText(content)
    : normalizeWhitespace(content || message.bodyPreview || "");
  return {
    id: message.id,
    subject: message.subject ?? "",
    fromName: message.from?.emailAddress?.name?.trim() || null,
    fromAddress: message.from?.emailAddress?.address?.toLowerCase() ?? null,
    receivedAt: message.receivedDateTime ? new Date(message.receivedDateTime) : new Date(),
    text,
  };
}

export interface GraphNotification {
  subscriptionId: string;
  clientState?: string;
  changeType?: string;
  lifecycleEvent?: string;
  resource?: string;
  resourceData?: { id?: string };
}

export function parseGraphNotifications(body: unknown): GraphNotification[] {
  const value = (body as { value?: unknown } | null)?.value;
  if (!Array.isArray(value)) return [];
  return value.filter((n): n is GraphNotification =>
    typeof n === "object" && n !== null &&
    typeof (n as GraphNotification).subscriptionId === "string"
  );
}

/** Message id from a notification: `resourceData.id`, else the last segment of `resource`. */
export function notificationMessageId(n: GraphNotification): string | null {
  if (n.resourceData?.id) return n.resourceData.id;
  const match = n.resource?.match(/messages\/([^/]+)$/i);
  return match ? decodeURIComponent(match[1].replace(/^\('|'\)$/g, "")) : null;
}
