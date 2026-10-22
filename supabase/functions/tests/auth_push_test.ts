import { assert, assertEquals } from "@std/assert";
import { jose } from "../_shared/deps.ts";
import { ApnsClient } from "../_shared/notify/apns.ts";
import { PushNotifier } from "../_shared/notify/notifier.ts";
import { verifyPubSubPushToken } from "../_shared/providers/pubsub-auth.ts";
import { MemoryStore, scriptedFetch } from "./fakes.ts";

const AUDIENCE = "https://ref.supabase.co/functions/v1/gmail-webhook";
const SERVICE_ACCOUNT = "push@project.iam.gserviceaccount.com";

async function googleLikeKeys() {
  const { publicKey, privateKey } = await jose.generateKeyPair("RS256");
  const jwk = { ...(await jose.exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  return { privateKey, jwks: jose.createLocalJWKSet({ keys: [jwk] }) };
}

async function sign(
  privateKey: CryptoKey | jose.KeyLike,
  claims: Record<string, unknown>,
  audience = AUDIENCE,
) {
  return await new jose.SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer("https://accounts.google.com")
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

Deno.test("Pub/Sub OIDC token must be for our audience and service account", async () => {
  const { privateKey, jwks } = await googleLikeKeys();
  const opts = { audience: AUDIENCE, serviceAccountEmail: SERVICE_ACCOUNT, jwks };

  assert(
    await verifyPubSubPushToken(
      await sign(privateKey, { email: SERVICE_ACCOUNT, email_verified: true }),
      opts,
    ),
  );
  assertEquals(
    await verifyPubSubPushToken(
      await sign(privateKey, { email: "other@x.iam.gserviceaccount.com", email_verified: true }),
      opts,
    ),
    false,
  );
  assertEquals(
    await verifyPubSubPushToken(
      await sign(privateKey, { email: SERVICE_ACCOUNT, email_verified: true }, "https://evil"),
      opts,
    ),
    false,
  );
  assertEquals(await verifyPubSubPushToken("not-a-jwt", opts), false);
});

Deno.test("Pub/Sub token signed by an unknown key is rejected", async () => {
  const { jwks } = await googleLikeKeys();
  const other = await googleLikeKeys();
  const token = await sign(other.privateKey, { email: SERVICE_ACCOUNT, email_verified: true });
  assertEquals(
    await verifyPubSubPushToken(token, {
      audience: AUDIENCE,
      serviceAccountEmail: SERVICE_ACCOUNT,
      jwks,
    }),
    false,
  );
});

async function apnsKeyP8() {
  const { privateKey } = await jose.generateKeyPair("ES256", { extractable: true });
  return await jose.exportPKCS8(privateKey);
}

Deno.test("APNs sends an ES256 provider token to the right host and topic", async () => {
  const { fetch, requests } = scriptedFetch([() => new Response(null, { status: 200 })]);
  const client = new ApnsClient({
    keyP8: await apnsKeyP8(),
    keyId: "KEY123",
    teamId: "TEAM456",
    bundleId: "tech.app",
    fetchFn: fetch,
  });

  const result = await client.send({ token: "abcd", environment: "sandbox", bundle_id: null }, {
    title: "t",
    body: "b",
  });

  assert(result.ok);
  const req = requests[0];
  assertEquals(req.url, "https://api.sandbox.push.apple.com/3/device/abcd");
  assertEquals(req.headers.get("apns-topic"), "tech.app");
  const jwt = req.headers.get("authorization")!.replace(/^bearer /, "");
  const header = jose.decodeProtectedHeader(jwt);
  assertEquals(header, { alg: "ES256", kid: "KEY123" });
  assertEquals(jose.decodeJwt(jwt).iss, "TEAM456");
  assertEquals((await req.json()).aps.alert, { title: "t", body: "b" });
});

Deno.test("APNs provider token is reused rather than minted per push", async () => {
  const client = new ApnsClient({
    keyP8: await apnsKeyP8(),
    keyId: "K",
    teamId: "T",
    bundleId: "b",
  });
  const now = Date.now();
  assertEquals(await client.providerToken(now), await client.providerToken(now + 49 * 60_000));
});

Deno.test("dead device tokens (410 / Unregistered) are deleted", async () => {
  const store = new MemoryStore();
  store.devices = [
    { user_id: "user-1", token: "dead", environment: "production", bundle_id: null },
    { user_id: "user-1", token: "alive", environment: "production", bundle_id: null },
  ] as any;
  const { fetch } = scriptedFetch([
    (req) =>
      req.url.endsWith("/dead")
        ? new Response(JSON.stringify({ reason: "Unregistered" }), { status: 410 })
        : new Response(null, { status: 200 }),
    (req) =>
      req.url.endsWith("/dead")
        ? new Response(JSON.stringify({ reason: "Unregistered" }), { status: 410 })
        : new Response(null, { status: 200 }),
  ]);
  const notifier = new PushNotifier(
    store,
    new ApnsClient({
      keyP8: await apnsKeyP8(),
      keyId: "K",
      teamId: "T",
      bundleId: "b",
      fetchFn: fetch,
    }),
  );

  await notifier.applicationChanged({
    duplicate: false,
    user_id: "user-1",
    application_id: "app-1",
    company_name: "Acme",
    status: "interview",
    status_changed: true,
  });

  assertEquals(store.devices.map((d) => d.token), ["alive"]);
});

Deno.test("no push when the user turned notifications off", async () => {
  const store = new MemoryStore();
  store.notificationsOn = false;
  store.devices = [{
    user_id: "user-1",
    token: "t",
    environment: "production",
    bundle_id: null,
  }] as any;
  const { fetch, requests } = scriptedFetch([]);
  const notifier = new PushNotifier(
    store,
    new ApnsClient({ keyP8: "unused", keyId: "K", teamId: "T", bundleId: "b", fetchFn: fetch }),
  );

  await notifier.applicationChanged({
    duplicate: false,
    user_id: "user-1",
    status: "offer",
    created: true,
  });

  assertEquals(requests.length, 0);
});
