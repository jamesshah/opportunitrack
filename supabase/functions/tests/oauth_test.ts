import { assert, assertEquals } from "@std/assert";
import { handleOAuthCallback, handleOAuthStart } from "../_shared/handlers/oauth.ts";
import { OAuthTokenError } from "../_shared/providers/oauth-token.ts";
import { fakeGmail, fakeOutlook, makeDeps, MemoryStore } from "./fakes.ts";

const urls = {
  redirectUri: "https://ref.supabase.co/functions/v1/oauth-callback",
  appRedirectUrl: "tech.jamesshah.OpportuniTrack://oauth-callback",
};

const callback = (query: string) => new Request(`${urls.redirectUri}?${query}`);

function redirectParams(res: Response) {
  assertEquals(res.status, 302);
  const location = res.headers.get("Location")!;
  assert(location.toLowerCase().startsWith(`${urls.appRedirectUrl.toLowerCase()}?`), location);
  return Object.fromEntries(new URL(location).searchParams);
}

Deno.test("start stores a one-time state with a PKCE verifier and returns the provider URL", async () => {
  const { deps, store } = makeDeps();
  const res = await handleOAuthStart(
    new Request("https://x/oauth-start", {
      method: "POST",
      body: JSON.stringify({ provider: "google" }),
    }),
    deps,
    () => Promise.resolve({ id: "user-1" }),
    urls,
  );
  assertEquals(res.status, 200);
  assert((await res.json()).authorization_url.startsWith("https://accounts.google.com"));
  const [state] = [...store.oauthStates.values()];
  assertEquals(state.userId, "user-1");
  assert(state.codeVerifier.length >= 43);
});

Deno.test("start rejects unknown providers", async () => {
  const { deps } = makeDeps();
  const res = await handleOAuthStart(
    new Request("https://x/oauth-start", {
      method: "POST",
      body: JSON.stringify({ provider: "yahoo" }),
    }),
    deps,
    () => Promise.resolve({ id: "user-1" }),
    urls,
  );
  assertEquals(res.status, 400);
});

Deno.test("callback with an unknown state is refused", async () => {
  const { deps } = makeDeps();
  const params = redirectParams(
    await handleOAuthCallback(callback("state=nope&code=c"), deps, urls),
  );
  assertEquals(params, { status: "error", reason: "invalid_state" });
});

Deno.test("successful Gmail connect stores tokens, starts the watch and queues a backfill", async () => {
  const gmail = fakeGmail();
  const store = new MemoryStore();
  await store.createOAuthState({
    state: "s1",
    userId: "user-1",
    provider: "google",
    codeVerifier: "v",
  });
  const { deps } = makeDeps({ store, google: gmail });

  const params = redirectParams(
    await handleOAuthCallback(callback("state=s1&code=abc"), deps, urls),
  );

  assertEquals(params.status, "success");
  const id = params.account_id;
  assertEquals(store.tokens.get(id)?.refresh_token, "rt");
  assertEquals(gmail.calls.count("watch"), 1);
  assertEquals(store.accounts.get(id)?.sync?.gmail_history_id, "500");
  assertEquals(store.queues.mail_sync.map((m) => m.message), [{
    account_id: id,
    reason: "backfill",
  }]);
  assertEquals(store.oauthStates.size, 0);
});

Deno.test("Gmail grant without the gmail.readonly scope is reported as missing_scope", async () => {
  const gmail = fakeGmail();
  gmail.exchangeCode = () =>
    Promise.resolve({
      access_token: "at",
      refresh_token: "rt",
      expires_at: Date.now() + 3600_000,
      scope: "openid email",
    });
  const store = new MemoryStore();
  await store.createOAuthState({
    state: "s1",
    userId: "user-1",
    provider: "google",
    codeVerifier: "v",
  });
  const { deps } = makeDeps({ store, google: gmail });

  const params = redirectParams(
    await handleOAuthCallback(callback("state=s1&code=abc"), deps, urls),
  );

  assertEquals(params.reason, "missing_scope");
  assertEquals(store.accounts.size, 0);
});

Deno.test("work tenant that needs admin approval redirects with admin_consent_required", async () => {
  const store = new MemoryStore();
  await store.createOAuthState({
    state: "s1",
    userId: "user-1",
    provider: "microsoft",
    codeVerifier: "v",
  });
  const { deps } = makeDeps({ store });

  const params = redirectParams(
    await handleOAuthCallback(
      callback(
        "state=s1&error=consent_required&error_description=" +
          encodeURIComponent("AADSTS65001: The user or administrator has not consented"),
      ),
      deps,
      urls,
    ),
  );

  assertEquals(params, {
    status: "error",
    reason: "admin_consent_required",
    provider: "microsoft",
  });
});

Deno.test("admin-consent errors surfaced by the token endpoint are classified too", async () => {
  const outlook = fakeOutlook();
  outlook.exchangeCode = () =>
    Promise.reject(new OAuthTokenError(400, "invalid_grant", "AADSTS90094: admin approval"));
  const store = new MemoryStore();
  await store.createOAuthState({
    state: "s1",
    userId: "user-1",
    provider: "microsoft",
    codeVerifier: "v",
  });
  const { deps } = makeDeps({ store, microsoft: outlook });

  const params = redirectParams(
    await handleOAuthCallback(callback("state=s1&code=abc"), deps, urls),
  );

  assertEquals(params.reason, "admin_consent_required");
});

Deno.test("Outlook connect still succeeds if subscription setup fails", async () => {
  const outlook = fakeOutlook();
  outlook.createSubscription = () => Promise.reject(new Error("notification URL unreachable"));
  const store = new MemoryStore();
  await store.createOAuthState({
    state: "s1",
    userId: "user-1",
    provider: "microsoft",
    codeVerifier: "v",
  });
  const { deps } = makeDeps({ store, microsoft: outlook });

  const params = redirectParams(
    await handleOAuthCallback(callback("state=s1&code=abc"), deps, urls),
  );

  assertEquals(params.status, "success");
  assert(
    String((store.accounts.get(params.account_id) as any)?.last_error ?? "").startsWith(
      "Push setup failed",
    ),
  );
  assertEquals(store.queues.mail_sync.length, 1);
});
