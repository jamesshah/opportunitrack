import type { MessageSummary } from "../providers/types.ts";

/**
 * Cheap triage on subject, sender and snippet before a full fetch and a model call.
 * Deliberately liberal: a false negative loses an application update, a false
 * positive only costs one extra fetch and classification.
 */
const HIRING_TERMS =
  /\b(appl(y|ied|ying|ication|icant)s?|interview(s|ing)?|offer(s|ed)?|position|role|candida(te|cy)|recruit(er|ing|ment)?|hiring|hire|career(s)?|talent|job|opportunit(y|ies)|assessment|screening|onboarding|next steps|unfortunately|regret|moving forward|not (be )?moving forward|other candidates|thank you for your interest|resume|cv)\b/i;

const ATS_SENDERS =
  /(greenhouse(-mail)?\.io|lever\.co|hire\.lever|myworkday(jobs)?\.com|workday\.com|ashbyhq\.com|icims\.com|smartrecruiters\.com|jobvite\.com|taleo\.net|successfactors|bamboohr\.com|breezy\.hr|recruitee\.com|workable\.com|jazzhr|applytojob\.com|rippling|gem\.com|teamtailor|personio)/i;

const EXCLUDED_LABELS = new Set(["SPAM", "TRASH", "DRAFT", "SENT"]);
const BULK_CATEGORY_LABELS = new Set(["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL"]);

export interface PrefilterResult {
  candidate: boolean;
  reason: "ats_sender" | "hiring_terms" | "excluded_label" | "bulk_category" | "no_signal";
}

export function prefilterMessage(summary: MessageSummary): PrefilterResult {
  const labels = summary.labels ?? [];
  if (labels.some((label) => EXCLUDED_LABELS.has(label))) {
    return { candidate: false, reason: "excluded_label" };
  }
  if (summary.fromAddress && ATS_SENDERS.test(summary.fromAddress)) {
    return { candidate: true, reason: "ats_sender" };
  }
  if (labels.some((label) => BULK_CATEGORY_LABELS.has(label))) {
    return { candidate: false, reason: "bulk_category" };
  }
  const haystack = `${summary.subject}\n${summary.fromName ?? ""}\n${summary.snippet}`;
  if (HIRING_TERMS.test(haystack)) return { candidate: true, reason: "hiring_terms" };
  return { candidate: false, reason: "no_signal" };
}
