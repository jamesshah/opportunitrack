import { base64UrlDecodeText, decodeJwtPayload } from "../encoding.ts";
import { decodeHtmlEntities, htmlToText, parseAddressHeader } from "../email/text.ts";
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

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const SCOPES = ["openid", "email", GMAIL_READONLY_SCOPE];
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailConfig {
  clientId: string;
  clientSecret: string;
  pubsubTopic?: string;
}

/** Gmail's stored history id is too old (or invalid); fall back to a time-window listing. */
export class HistoryExpiredError extends Error {
  override name = "HistoryExpiredError";
}

export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GmailPart;
}

export interface GmailHistoryPage {
  history?: { messagesAdded?: { message: { id: string; labelIds?: string[] } }[] }[];
  historyId?: string;
  nextPageToken?: string;
}

export interface WatchResult {
  historyId: string;
  expiration: Date;
}

export class GmailProvider implements MailProvider {
  readonly id = "google" as const;

  constructor(private readonly config: GmailConfig, private readonly fetchFn: FetchFn = fetch) {}

  buildAuthorizationUrl({ state, codeChallenge, redirectUri }: AuthorizationRequest): string {
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    }).toString();
    return url.toString();
  }

  async exchangeCode({ code, codeVerifier, redirectUri }: CodeExchange): Promise<TokenSet> {
    const response = await postTokenRequest(this.fetchFn, TOKEN_URL, {
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    }, { isRefresh: false });
    const tokens = toTokenSet(response);
    if (response.id_token) {
      (tokens as TokenSet & { id_token_sub?: string }).id_token_sub = String(
        decodeJwtPayload(response.id_token).sub ?? "",
      ) || undefined;
    }
    return tokens;
  }

  async refreshTokens(tokens: TokenSet): Promise<TokenSet> {
    if (!tokens.refresh_token) throw new ReauthRequiredError("no refresh token stored");
    const response = await postTokenRequest(this.fetchFn, TOKEN_URL, {
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    }, { isRefresh: true });
    return toTokenSet(response, tokens);
  }

  async getProfile(accessToken: string, tokens?: TokenSet): Promise<MailboxProfile> {
    const profile = await this.get<{ emailAddress: string }>(
      accessToken,
      `${API}/profile`,
      "gmail profile",
    );
    const sub = (tokens as (TokenSet & { id_token_sub?: string }) | undefined)?.id_token_sub;
    return { emailAddress: profile.emailAddress.toLowerCase(), providerUserId: sub ?? null };
  }

  /** `format=metadata` costs 20 quota units versus 60 for `format=full`. */
  async getMessageSummary(accessToken: string, messageId: string): Promise<MessageSummary | null> {
    const params = new URLSearchParams({ format: "metadata" });
    for (const h of ["From", "Subject", "Date"]) params.append("metadataHeaders", h);
    const message = await this.getOrNull<GmailMessage & { snippet?: string }>(
      accessToken,
      `${API}/messages/${encodeURIComponent(messageId)}?${params}`,
      "gmail messages.get(metadata)",
    );
    if (!message) return null;
    const parsed = parseGmailMessage(message);
    return {
      id: parsed.id,
      subject: parsed.subject,
      fromName: parsed.fromName,
      fromAddress: parsed.fromAddress,
      receivedAt: parsed.receivedAt,
      snippet: decodeHtmlEntities(message.snippet ?? ""),
      labels: parsed.labels,
    };
  }

  async getMessage(accessToken: string, messageId: string): Promise<NormalizedEmail | null> {
    const message = await this.getOrNull<GmailMessage>(
      accessToken,
      `${API}/messages/${encodeURIComponent(messageId)}?format=full`,
      "gmail messages.get",
    );
    return message ? parseGmailMessage(message) : null;
  }

  async listCandidateMessageIdsSince(
    accessToken: string,
    since: Date,
    limit: number,
  ): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    const q = gmailBackfillQuery(since);
    do {
      const params = new URLSearchParams({ q, maxResults: "100" });
      if (pageToken) params.set("pageToken", pageToken);
      const page = await this.get<{ messages?: { id: string }[]; nextPageToken?: string }>(
        accessToken,
        `${API}/messages?${params}`,
        "gmail messages.list",
      );
      for (const m of page.messages ?? []) ids.push(m.id);
      pageToken = page.nextPageToken;
    } while (pageToken && ids.length < limit);
    return ids.slice(0, limit);
  }

  /** New INBOX message ids since `startHistoryId`, and the newest history id seen. */
  async listHistory(
    accessToken: string,
    startHistoryId: string,
  ): Promise<{ messageIds: string[]; historyId: string }> {
    const ids = new Set<string>();
    let latest = startHistoryId;
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        startHistoryId,
        historyTypes: "messageAdded",
        labelId: "INBOX",
        maxResults: "500",
      });
      if (pageToken) params.set("pageToken", pageToken);
      let page: GmailHistoryPage;
      try {
        page = await this.get<GmailHistoryPage>(
          accessToken,
          `${API}/history?${params}`,
          "gmail history.list",
        );
      } catch (error) {
        if (error instanceof ProviderHttpError && error.status === 404) {
          throw new HistoryExpiredError(`history ${startHistoryId} is no longer available`);
        }
        throw error;
      }
      for (const entry of page.history ?? []) {
        for (const added of entry.messagesAdded ?? []) ids.add(added.message.id);
      }
      if (page.historyId) latest = maxHistoryId(latest, page.historyId);
      pageToken = page.nextPageToken;
    } while (pageToken);
    return { messageIds: [...ids], historyId: latest };
  }

  async watch(accessToken: string): Promise<WatchResult> {
    if (!this.config.pubsubTopic) throw new Error("GMAIL_PUBSUB_TOPIC is not configured");
    const result = await fetchJson<{ historyId: string; expiration: string }>(
      this.fetchFn,
      `${API}/watch`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          topicName: this.config.pubsubTopic,
          labelIds: ["INBOX"],
          labelFilterBehavior: "INCLUDE",
        }),
      },
      "gmail watch",
    );
    return { historyId: String(result.historyId), expiration: new Date(Number(result.expiration)) };
  }

  async stopWatch(accessToken: string): Promise<void> {
    await fetchJson<void>(this.fetchFn, `${API}/stop`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    }, "gmail stop");
  }

  async revoke(tokens: TokenSet): Promise<void> {
    const token = tokens.refresh_token ?? tokens.access_token;
    await this.fetchFn(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  }

  private get<T>(accessToken: string, url: string, context: string): Promise<T> {
    return fetchJson<T>(this.fetchFn, url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    }, context);
  }

  private async getOrNull<T>(accessToken: string, url: string, context: string): Promise<T | null> {
    try {
      return await this.get<T>(accessToken, url, context);
    } catch (error) {
      if (error instanceof ProviderHttpError && error.status === 404) return null;
      throw error;
    }
  }
}

const BACKFILL_KEYWORDS = [
  "application",
  "applying",
  "applied",
  "interview",
  "offer",
  "position",
  "role",
  "candidate",
  "candidacy",
  "recruiter",
  "recruiting",
  "hiring",
  "careers",
  "talent",
  "assessment",
  "greenhouse",
  "lever",
  "workday",
  "ashby",
  "icims",
  "smartrecruiters",
  "jobvite",
];

/**
 * Gmail search for backfill and catch-up: inbox only, newer than `since`, excluding
 * Social/Promotions, and mentioning at least one hiring keyword. Push-driven sync
 * uses history.list instead and is not narrowed here.
 */
export function gmailBackfillQuery(since: Date): string {
  const after = Math.floor(since.getTime() / 1000);
  return `in:inbox after:${after} -category:social -category:promotions {${
    BACKFILL_KEYWORDS.join(" ")
  }}`;
}

export function maxHistoryId(a: string, b: string): string {
  return BigInt(a) >= BigInt(b) ? a : b;
}

function header(part: GmailPart | undefined, name: string): string | undefined {
  return part?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

function findBody(part: GmailPart | undefined, mimeType: string): string | null {
  if (!part) return null;
  if (part.mimeType === mimeType && part.body?.data && !part.filename) {
    return base64UrlDecodeText(part.body.data);
  }
  for (const child of part.parts ?? []) {
    const found = findBody(child, mimeType);
    if (found) return found;
  }
  return null;
}

export function parseGmailMessage(message: GmailMessage): NormalizedEmail {
  const from = parseAddressHeader(header(message.payload, "From"));
  const plain = findBody(message.payload, "text/plain");
  const html = plain ? null : findBody(message.payload, "text/html");
  const dateHeader = header(message.payload, "Date");
  const receivedAt = message.internalDate
    ? new Date(Number(message.internalDate))
    : dateHeader
    ? new Date(dateHeader)
    : new Date();
  return {
    id: message.id,
    subject: header(message.payload, "Subject") ?? "",
    fromName: from.name,
    fromAddress: from.address,
    receivedAt,
    text: plain ?? (html ? htmlToText(html) : ""),
    labels: message.labelIds ?? [],
  };
}

export interface GmailPushNotification {
  emailAddress: string;
  historyId: string;
}

export function decodePubSubPush(body: unknown): GmailPushNotification {
  const data = (body as { message?: { data?: string } } | null)?.message?.data;
  if (!data) throw new Error("Pub/Sub push body has no message.data");
  const decoded = JSON.parse(base64UrlDecodeText(data));
  if (typeof decoded.emailAddress !== "string" || decoded.historyId === undefined) {
    throw new Error("Pub/Sub message is not a Gmail notification");
  }
  return { emailAddress: decoded.emailAddress.toLowerCase(), historyId: String(decoded.historyId) };
}
