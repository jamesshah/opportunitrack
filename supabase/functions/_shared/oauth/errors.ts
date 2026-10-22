export type ConnectErrorReason =
  | "admin_consent_required"
  | "access_denied"
  | "missing_scope"
  | "invalid_state"
  | "exchange_failed"
  | "server_error";

/**
 * AADSTS65001: consent not granted; AADSTS90094: admin approval required;
 * AADSTS90095: admin consent workflow request. Work/school tenants block user
 * consent to Mail.Read by default, so these are expected for corporate mailboxes.
 */
const ADMIN_CONSENT_CODES = /AADSTS(65001|90094|90095|90008)\b/i;

export function classifyAuthError(
  error: string | null,
  description: string | null,
): ConnectErrorReason {
  const text = `${error ?? ""} ${description ?? ""}`;
  if (ADMIN_CONSENT_CODES.test(text) || /admin[_ ]consent|admin approval|need admin/i.test(text)) {
    return "admin_consent_required";
  }
  if (error === "consent_required" || error === "interaction_required") {
    return "admin_consent_required";
  }
  if (error === "access_denied") return "access_denied";
  if (error) return "exchange_failed";
  return "server_error";
}
