import { prepareBodyForClassification } from "../email/text.ts";
import { type FetchFn, parseRetryAfter, ProviderHttpError } from "../http.ts";
import { APPLICATION_STATUSES, type ApplicationStatus, type NormalizedEmail } from "../types.ts";
import { extractCompanyCandidates, extractPositionCandidates } from "./candidates.ts";
import type { EmailClassification, EmailClassifier } from "./types.ts";

/** TypeSafe AI System One API: https://docs.typesafe.ai/api/system-one */

export const NONE = "none";

type NoulQuestion = {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
};
type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string | null>;
};
export type SystemOneQuestion = NoulQuestion | ChoiceQuestion;

export interface SystemOneRequest {
  model: string;
  state: unknown;
  questions: Record<string, SystemOneQuestion>;
}

type NoulAnswer = { type: "noul"; noul: number };
type ChoiceAnswer = {
  type: "choice";
  choice: string;
  confidence?: number | null;
  probabilities?: Record<string, number>;
};

export interface SystemOneResponse {
  model: string;
  answers: Record<string, NoulAnswer | ChoiceAnswer | undefined>;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface SystemOneConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  jobThreshold?: number;
  maxRetries?: number;
  fetchFn?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
}

const STATUS_CRITERIA: Record<ApplicationStatus, string> = {
  applied: "Confirms an application was received or submitted, or that it is under review",
  interview:
    "Invites the recipient to an interview, phone screen, assessment, or to schedule a next-step conversation",
  rejected: "Says the company will not move forward with the recipient's application",
  offer: "Extends a job offer or discusses offer terms with the recipient",
};

export function buildSystemOneRequest(email: NormalizedEmail, model: string): {
  request: SystemOneRequest;
  companies: string[];
  positions: string[];
} {
  const companies = extractCompanyCandidates(email);
  const positions = extractPositionCandidates(email);

  const questions: Record<string, SystemOneQuestion> = {
    is_job_update: {
      type: "noul",
      instructions:
        "Is this email from an employer, recruiter, or applicant tracking system about a job application the recipient submitted or a hiring process the recipient is in?",
      criteria: {
        true:
          "Application confirmation, interview invitation or scheduling, assessment, rejection, or offer for the recipient",
        false:
          "Job alerts, job recommendations, newsletters, marketing, networking requests, or mail unrelated to the recipient's own application",
      },
    },
    status: {
      type: "choice",
      instructions: "Which stage of the recipient's application does this email communicate?",
      criteria: { ...STATUS_CRITERIA },
    },
  };

  if (companies.length > 0) {
    questions.company = {
      type: "choice",
      instructions: "Which option is the name of the hiring company this email is about?",
      criteria: {
        ...Object.fromEntries(companies.map((c) => [c, null])),
        [NONE]: "None of these is the hiring company",
      },
    };
  }
  if (positions.length > 0) {
    questions.position = {
      type: "choice",
      instructions:
        "Which option is the job title the recipient applied or is being considered for?",
      criteria: {
        ...Object.fromEntries(positions.map((p) => [p, null])),
        [NONE]: "None of these is the job title",
      },
    };
  }

  return {
    request: {
      model,
      state: {
        from: [email.fromName, email.fromAddress && `<${email.fromAddress}>`].filter(Boolean).join(
          " ",
        ),
        subject: email.subject,
        received_at: email.receivedAt.toISOString(),
        body: prepareBodyForClassification(email.text),
      },
      questions,
    },
    companies,
    positions,
  };
}

function pick(answer: NoulAnswer | ChoiceAnswer | undefined, options: string[]): {
  value: string | null;
  confidence: number | null;
} {
  if (!answer || answer.type !== "choice") return { value: null, confidence: null };
  if (answer.choice === NONE || !options.includes(answer.choice)) {
    return { value: null, confidence: answer.confidence ?? null };
  }
  return { value: answer.choice, confidence: answer.confidence ?? null };
}

export function interpretSystemOneResponse(
  response: SystemOneResponse,
  companies: string[],
  positions: string[],
  jobThreshold: number,
): EmailClassification {
  const noul = response.answers.is_job_update;
  const jobProbability = noul?.type === "noul" ? noul.noul : 0;
  const statusAnswer = response.answers.status;
  const status = statusAnswer?.type === "choice" &&
      (APPLICATION_STATUSES as readonly string[]).includes(statusAnswer.choice)
    ? (statusAnswer.choice as ApplicationStatus)
    : null;
  const company = pick(response.answers.company, companies);
  const position = pick(response.answers.position, positions);
  const confidences = [
    statusAnswer?.type === "choice" ? statusAnswer.confidence : null,
    company.confidence,
  ].filter((c): c is number => typeof c === "number");

  return {
    isJobRelated: jobProbability >= jobThreshold,
    jobProbability,
    status,
    company: company.value,
    position: position.value,
    confidence: confidences.length ? Math.min(...confidences) : null,
    model: response.model,
  };
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);

export class SystemOneClassifier implements EmailClassifier {
  readonly name = "typesafe-systemone";
  readonly version: string;
  private readonly baseUrl: string;
  private readonly jobThreshold: number;
  private readonly maxRetries: number;
  private readonly fetchFn: FetchFn;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly config: SystemOneConfig) {
    this.version = config.model ?? "jev-latest";
    this.baseUrl = (config.baseUrl ?? "https://api.typesafe.ai").replace(/\/+$/, "");
    this.jobThreshold = config.jobThreshold ?? 0.6;
    this.maxRetries = config.maxRetries ?? 2;
    this.fetchFn = config.fetchFn ?? fetch;
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async classify(email: NormalizedEmail): Promise<EmailClassification> {
    const { request, companies, positions } = buildSystemOneRequest(email, this.version);
    const response = await this.send(request);
    return interpretSystemOneResponse(response, companies, positions, this.jobThreshold);
  }

  private async send(request: SystemOneRequest): Promise<SystemOneResponse> {
    for (let attempt = 0;; attempt++) {
      const res = await this.fetchFn(`${this.baseUrl}/v1/systemone`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });
      if (res.ok) return (await res.json()) as SystemOneResponse;
      const body = await res.text();
      const retryAfter = parseRetryAfter(res.headers.get("Retry-After"));
      if (!RETRYABLE.has(res.status) || attempt >= this.maxRetries) {
        throw new ProviderHttpError(res.status, body, "TypeSafe System One", retryAfter);
      }
      await this.sleep(
        retryAfter !== null ? retryAfter * 1000 : Math.min(500 * 2 ** attempt, 5000),
      );
    }
  }
}
