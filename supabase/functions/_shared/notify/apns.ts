import { jose } from "../deps.ts";
import type { FetchFn } from "../http.ts";
import type { DeviceToken } from "../types.ts";

export interface ApnsConfig {
  keyP8: string;
  keyId: string;
  teamId: string;
  bundleId: string;
  fetchFn?: FetchFn;
}

export interface ApnsAlert {
  title: string;
  body: string;
  threadId?: string;
  data?: Record<string, unknown>;
}

export interface ApnsResult {
  token: string;
  ok: boolean;
  status: number;
  reason?: string;
  /** The token is dead and should be removed. */
  unregistered: boolean;
}

const HOSTS = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
} as const;

const DEAD_TOKEN_REASONS = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"]);

export function buildApnsPayload(alert: ApnsAlert): Record<string, unknown> {
  return {
    aps: {
      alert: { title: alert.title, body: alert.body },
      sound: "default",
      ...(alert.threadId ? { "thread-id": alert.threadId } : {}),
    },
    ...(alert.data ?? {}),
  };
}

/** Token-based (.p8) APNs client. Provider JWTs are reused for 50 minutes, as Apple requires < 60. */
export class ApnsClient {
  private jwt: { value: string; issuedAt: number } | null = null;
  private key: CryptoKey | null = null;
  private readonly fetchFn: FetchFn;

  constructor(private readonly config: ApnsConfig) {
    this.fetchFn = config.fetchFn ?? fetch;
  }

  async providerToken(now = Date.now()): Promise<string> {
    if (this.jwt && now - this.jwt.issuedAt < 50 * 60 * 1000) return this.jwt.value;
    this.key ??= await jose.importPKCS8(
      this.config.keyP8.replace(/\\n/g, "\n"),
      "ES256",
    ) as CryptoKey;
    const issuedAt = Math.floor(now / 1000);
    const value = await new jose.SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: this.config.keyId })
      .setIssuer(this.config.teamId)
      .setIssuedAt(issuedAt)
      .sign(this.key);
    this.jwt = { value, issuedAt: now };
    return value;
  }

  async send(device: DeviceToken, alert: ApnsAlert): Promise<ApnsResult> {
    const res = await this.fetchFn(`${HOSTS[device.environment]}/3/device/${device.token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${await this.providerToken()}`,
        "apns-topic": device.bundle_id || this.config.bundleId,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
      },
      body: JSON.stringify(buildApnsPayload(alert)),
    });
    if (res.ok) {
      await res.body?.cancel();
      return { token: device.token, ok: true, status: res.status, unregistered: false };
    }
    let reason: string | undefined;
    try {
      reason = (await res.json()).reason;
    } catch {
      reason = undefined;
    }
    return {
      token: device.token,
      ok: false,
      status: res.status,
      reason,
      unregistered: res.status === 410 || (reason !== undefined && DEAD_TOKEN_REASONS.has(reason)),
    };
  }
}
