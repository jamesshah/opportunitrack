import { randomToken, sha256Base64Url } from "../encoding.ts";

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export async function createPkcePair(): Promise<PkcePair> {
  const verifier = randomToken(48);
  return { verifier, challenge: await sha256Base64Url(verifier) };
}

export function createOAuthState(): string {
  return randomToken(32);
}
