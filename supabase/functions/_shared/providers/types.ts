import type { NormalizedEmail, Provider, TokenSet } from "../types.ts";

export interface AuthorizationRequest {
  state: string;
  codeChallenge: string;
  redirectUri: string;
}

export interface CodeExchange {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export interface MailboxProfile {
  emailAddress: string;
  providerUserId: string | null;
}

/** Cheap view of a message used to triage before paying for a full fetch. */
export interface MessageSummary {
  id: string;
  subject: string;
  fromName: string | null;
  fromAddress: string | null;
  receivedAt: Date;
  snippet: string;
  labels?: string[];
  /** Set when the provider returned the full message in the same call (Outlook). */
  full?: NormalizedEmail;
}

/** What the sync pipeline needs from any mailbox provider. */
export interface MailProvider {
  readonly id: Provider;
  buildAuthorizationUrl(request: AuthorizationRequest): string;
  exchangeCode(exchange: CodeExchange): Promise<TokenSet>;
  refreshTokens(tokens: TokenSet): Promise<TokenSet>;
  getProfile(accessToken: string, tokens?: TokenSet): Promise<MailboxProfile>;
  getMessageSummary(accessToken: string, messageId: string): Promise<MessageSummary | null>;
  getMessage(accessToken: string, messageId: string): Promise<NormalizedEmail | null>;
  /** Inbox messages after `since`, narrowed by provider-side search where available. */
  listCandidateMessageIdsSince(accessToken: string, since: Date, limit: number): Promise<string[]>;
  revoke?(tokens: TokenSet): Promise<void>;
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

export function toTokenSet(response: OAuthTokenResponse, previous?: TokenSet): TokenSet {
  return {
    access_token: response.access_token,
    refresh_token: response.refresh_token ?? previous?.refresh_token,
    expires_at: Date.now() + (response.expires_in ?? 3600) * 1000,
    scope: response.scope ?? previous?.scope,
  };
}
