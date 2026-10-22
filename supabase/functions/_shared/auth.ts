import type { SupabaseClient } from "./deps.ts";
import { bearerToken, HttpError } from "./http.ts";
import type { Store } from "./store.ts";

export async function requireUser(req: Request, client: SupabaseClient): Promise<{ id: string }> {
  const token = bearerToken(req);
  if (!token) throw new HttpError(401, "missing_authorization");
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "invalid_token");
  return { id: data.user.id };
}

export async function requireCron(req: Request, store: Store): Promise<void> {
  if (!(await store.verifyCronSecret(req.headers.get("x-cron-secret")))) {
    throw new HttpError(401, "invalid_cron_secret");
  }
}
