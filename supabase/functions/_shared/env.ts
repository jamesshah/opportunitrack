export class ConfigError extends Error {
  override name = "ConfigError";
}

export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new ConfigError(`Missing environment variable ${name}`);
  return value;
}

export function optionalEnv(name: string, fallback: string): string {
  return Deno.env.get(name) || fallback;
}

export function numberEnv(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new ConfigError(`${name} must be a number`);
  return parsed;
}

/** Public base URL of this project's Edge Functions, used for OAuth redirects and webhooks. */
export function functionsBaseUrl(): string {
  const explicit = Deno.env.get("PUBLIC_FUNCTIONS_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  return `${requireEnv("SUPABASE_URL").replace(/\/+$/, "")}/functions/v1`;
}

export function oauthRedirectUri(): string {
  return `${functionsBaseUrl()}/oauth-callback`;
}

export function appRedirectUrl(): string {
  return optionalEnv("APP_REDIRECT_URL", "tech.jamesshah.OpportuniTrack://oauth-callback");
}
