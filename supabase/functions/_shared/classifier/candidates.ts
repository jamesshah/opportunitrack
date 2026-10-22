import type { NormalizedEmail } from "../types.ts";

/**
 * System One only picks among options it is given, so company and position
 * candidates are proposed here (over-finding on purpose) and the model picks one.
 */

const MAX_CANDIDATES = 40;

const GENERIC_DOMAINS = new Set([
  "gmail",
  "googlemail",
  "outlook",
  "hotmail",
  "live",
  "yahoo",
  "icloud",
  "me",
  "aol",
  "proton",
  "protonmail",
  "linkedin",
  "indeed",
  "glassdoor",
  "ziprecruiter",
  "monster",
  "wellfound",
  "angellist",
  "handshake",
  "dice",
  "greenhouse",
  "greenhouse-mail",
  "lever",
  "hire",
  "myworkday",
  "myworkdayjobs",
  "workday",
  "ashbyhq",
  "icims",
  "smartrecruiters",
  "jobvite",
  "taleo",
  "successfactors",
  "bamboohr",
  "breezy",
  "recruitee",
  "workable",
  "jazzhr",
  "applytojob",
  "rippling",
  "gem",
  "teamtailor",
  "personio",
  "mail",
  "email",
  "notifications",
  "noreply",
  "no-reply",
  "talent",
  "careers",
  "jobs",
  "hr",
  "recruiting",
]);

const SENDER_NOISE =
  /\b(careers?|recruit(ing|ment|er)?|talent( acquisition)?|hiring( team)?|jobs?|team|hr|people( ops| operations)?|notifications?|no-?reply|do not reply|via [\w .-]+|at [\w .-]+ via)\b/gi;

const COMPANY_PATTERNS: RegExp[] = [
  /\b(?:applying|application|applied|interest)\s+(?:to|at|with|in)\s+([A-Z0-9][\w&.'’-]*(?:\s+[A-Z0-9&][\w&.'’-]*){0,4})/g,
  /\b(?:position|role|opportunity|job|career)\s+(?:at|with)\s+([A-Z0-9][\w&.'’-]*(?:\s+[A-Z0-9&][\w&.'’-]*){0,4})/g,
  /\b(?:join(?:ing)?|from|at|with)\s+(?:the\s+)?([A-Z][\w&.'’-]*(?:\s+[A-Z&][\w&.'’-]*){0,3})\s+(?:team|family)\b/g,
  /\b([A-Z][\w&.'’-]*(?:\s+[A-Z&][\w&.'’-]*){0,3})\s+(?:Talent Acquisition|Recruiting|Careers|Hiring Team|People Team)\b/g,
  /\bThe\s+([A-Z][\w&.'’-]*(?:\s+[A-Z&][\w&.'’-]*){0,3})\s+Team\b/g,
  /\bat\s+([A-Z][\w&.'’-]*(?:\s+[A-Z&][\w&.'’-]*){0,3})(?=[\s,.!]|$)/g,
];

const TITLE_NOUNS =
  "Engineer|Developer|Manager|Designer|Analyst|Scientist|Intern|Internship|Specialist|Consultant|Lead|Director|Architect|Administrator|Associate|Coordinator|Representative|Officer|Researcher|Technician|Strategist|Writer|Editor|Accountant|Recruiter|Marketer|Advocate|Programmer|Tester|Owner|Head|VP|President|Counsel|Attorney|Nurse|Teacher|Assistant|Producer|Partner|Fellow|Apprentice|Executive|Operator|Planner|Buyer|Agent|SRE|SDE|SWE";

const TITLE_RE = new RegExp(
  String
    .raw`\b((?:(?:Senior|Sr\.?|Junior|Jr\.?|Staff|Principal|Lead|Chief|Associate|Graduate|Entry[- ]Level|Mid[- ]Level|[A-Z][\w+#/.&-]*)\s+){0,5}(?:${TITLE_NOUNS})(?:\s+(?:I{1,3}|IV|V|[1-5]))?(?:\s*,\s*[A-Z][\w&/ -]{2,30})?)\b`,
  "g",
);

const POSITION_PATTERNS: RegExp[] = [
  /\b(?:for|to)\s+(?:the|our|a|an)\s+(.{3,80}?)\s+(?:position|role|opening|opportunity|job)\b/gi,
  /\b(?:position|role)\s+of\s+(.{3,80}?)(?=[.,;!\n]| at | with |$)/gi,
  /\bapplication\s+for\s+(?:the\s+)?(.{3,80}?)(?=[.,;!\n]| at | with | position| role|$)/gi,
  /\bapplied\s+(?:for|to)\s+(?:the\s+)?(.{3,80}?)(?=[.,;!\n]| at | with | position| role|$)/gi,
  /["“]([^"”\n]{3,80})["”]/g,
];

function clean(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/^[\s"'“”‘’(\[-]+|[\s"'“”‘’)\].,:;!?-]+$/g, "")
    .trim();
}

function addCandidate(out: Map<string, string>, raw: string | null | undefined, maxLength: number) {
  if (!raw) return;
  const value = clean(raw);
  if (value.length < 2 || value.length > maxLength) return;
  if (
    /^(the|a|an|our|your|this|that|we|you|us|me|team|hi|hello|dear|thanks|thank you)$/i.test(value)
  ) return;
  const key = value.toLowerCase();
  if (!out.has(key)) out.set(key, value);
}

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function companyFromDomain(address: string | null): string | null {
  if (!address) return null;
  const domain = address.split("@")[1];
  if (!domain) return null;
  const labels = domain.toLowerCase().split(".").filter(Boolean);
  const meaningful = labels.slice(0, -1).reverse().find((label) =>
    !GENERIC_DOMAINS.has(label) &&
    !/^(co|com|org|net|mail|email|e|m|mg|em\d*|send|bounce|careers|jobs|talent|hire|recruiting|notifications?)$/
      .test(label)
  );
  return meaningful ? meaningful.split("-").map(titleCase).join(" ") : null;
}

export function companyFromSenderName(name: string | null): string | null {
  if (!name) return null;
  const via = name.match(/\bat\s+(.+?)\s+via\b/i) ?? name.match(/^(.+?)\s+via\b/i);
  const base = via ? via[1] : name;
  const stripped = clean(base.replace(SENDER_NOISE, " ").replace(/[|•·@-]+/g, " "));
  return stripped.length >= 2 ? stripped : null;
}

export function extractCompanyCandidates(email: NormalizedEmail): string[] {
  const out = new Map<string, string>();
  addCandidate(out, companyFromSenderName(email.fromName), 60);
  addCandidate(out, companyFromDomain(email.fromAddress), 60);
  const text = `${email.subject}\n${email.text}`;
  for (const pattern of COMPANY_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      addCandidate(out, match[1], 60);
      if (out.size >= MAX_CANDIDATES) break;
    }
  }
  return [...out.values()].slice(0, MAX_CANDIDATES);
}

export function extractPositionCandidates(email: NormalizedEmail): string[] {
  const out = new Map<string, string>();
  const text = `${email.subject}\n${email.text}`;
  for (const pattern of POSITION_PATTERNS) {
    for (const match of text.matchAll(pattern)) addCandidate(out, match[1], 80);
  }
  for (const match of text.matchAll(TITLE_RE)) addCandidate(out, match[1], 80);
  return [...out.values()].filter((value) => value.split(" ").length <= 10).slice(
    0,
    MAX_CANDIDATES,
  );
}
