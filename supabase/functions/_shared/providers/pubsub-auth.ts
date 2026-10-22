import { jose } from "../deps.ts";

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const GOOGLE_CERTS = new URL("https://www.googleapis.com/oauth2/v3/certs");

let remoteJwks: ReturnType<typeof jose.createRemoteJWKSet> | undefined;

export interface PubSubAuthOptions {
  audience: string;
  serviceAccountEmail: string;
  /** Override for tests; defaults to Google's published signing keys. */
  jwks?: Parameters<typeof jose.jwtVerify>[1];
}

/**
 * Verifies the OIDC token Pub/Sub attaches to authenticated push requests:
 * Google-signed, for our audience, issued to the configured service account.
 */
export async function verifyPubSubPushToken(
  token: string,
  options: PubSubAuthOptions,
): Promise<boolean> {
  try {
    const keys = options.jwks ?? (remoteJwks ??= jose.createRemoteJWKSet(GOOGLE_CERTS));
    const { payload } = await jose.jwtVerify(token, keys as any, {
      issuer: GOOGLE_ISSUERS,
      audience: options.audience,
    });
    return payload.email === options.serviceAccountEmail && payload.email_verified === true;
  } catch {
    return false;
  }
}
