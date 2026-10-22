import { optionalEnv } from "../env.ts";
import type { Store } from "../store.ts";
import type { ApplicationStatus, EmailAccount, RecordMessageResult } from "../types.ts";
import { type ApnsAlert, ApnsClient } from "./apns.ts";

export interface Notifier {
  applicationChanged(result: RecordMessageResult): Promise<void>;
  reconnectRequired(account: EmailAccount): Promise<void>;
}

export interface PushSender {
  send(
    device: { token: string; environment: "sandbox" | "production"; bundle_id: string | null },
    alert: ApnsAlert,
  ): Promise<
    { ok: boolean; unregistered: boolean; status: number; reason?: string }
  >;
}

export function alertForApplication(result: RecordMessageResult): ApnsAlert {
  const company = result.company_name ?? "a company";
  const role = result.position_title ? ` for ${result.position_title}` : "";
  const copy: Record<ApplicationStatus, { title: string; body: string }> = {
    applied: {
      title: "New application tracked",
      body: `You applied to ${company}${role}. We'll keep an eye on it.`,
    },
    interview: {
      title: "You're on the radar!",
      body: `${company} wants to talk${role}. Check the details in the app.`,
    },
    rejected: {
      title: "Application update",
      body: `${company} won't be moving forward${role}. New opportunities await.`,
    },
    offer: {
      title: "Offer received! 🎉",
      body: `${company} sent you an offer${role}. Open the app to see it.`,
    },
  };
  const { title, body } = copy[result.status ?? "applied"];
  return {
    title,
    body,
    threadId: result.application_id,
    data: { job_application_id: result.application_id, status: result.status },
  };
}

export function alertForReconnect(account: EmailAccount): ApnsAlert {
  const provider = account.provider === "google" ? "Gmail" : "Outlook";
  return {
    title: `Reconnect your ${provider} inbox`,
    body:
      `We lost access to ${account.email_address}, so new application emails aren't being tracked. Tap to reconnect.`,
    data: { email_account_id: account.id, action: "reconnect" },
  };
}

export class PushNotifier implements Notifier {
  constructor(private readonly store: Store, private readonly sender: PushSender) {}

  async applicationChanged(result: RecordMessageResult): Promise<void> {
    if (!result.user_id || !(result.created || result.status_changed)) return;
    await this.sendToUser(result.user_id, alertForApplication(result));
  }

  async reconnectRequired(account: EmailAccount): Promise<void> {
    await this.sendToUser(account.user_id, alertForReconnect(account));
  }

  private async sendToUser(userId: string, alert: ApnsAlert): Promise<void> {
    if (!(await this.store.notificationsEnabled(userId))) return;
    const devices = await this.store.listDeviceTokens(userId);
    await Promise.all(devices.map(async (device) => {
      try {
        const result = await this.sender.send(device, alert);
        if (result.unregistered) await this.store.deleteDeviceToken(device.token);
        else if (!result.ok) console.warn("APNs rejected push", result.status, result.reason);
      } catch (error) {
        console.error("APNs send failed", error);
      }
    }));
  }
}

class NoopNotifier implements Notifier {
  applicationChanged(): Promise<void> {
    return Promise.resolve();
  }
  reconnectRequired(): Promise<void> {
    return Promise.resolve();
  }
}

export function notifierFromEnv(store: Store): Notifier {
  const keyP8 = Deno.env.get("APNS_KEY_P8");
  const keyId = Deno.env.get("APNS_KEY_ID");
  const teamId = Deno.env.get("APNS_TEAM_ID");
  if (!keyP8 || !keyId || !teamId) {
    console.warn("APNs is not configured; push notifications are disabled");
    return new NoopNotifier();
  }
  return new PushNotifier(
    store,
    new ApnsClient({
      keyP8,
      keyId,
      teamId,
      bundleId: optionalEnv("APNS_BUNDLE_ID", "tech.jamesshah.OpportuniTrack"),
    }),
  );
}
