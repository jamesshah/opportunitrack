import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  buildSystemOneRequest,
  interpretSystemOneResponse,
  NONE,
  SystemOneClassifier,
  type SystemOneResponse,
} from "../_shared/classifier/systemone.ts";
import { ProviderHttpError } from "../_shared/http.ts";
import { email, jsonResponse, scriptedFetch } from "./fakes.ts";

Deno.test("request asks a noul, a status choice, and candidate choices with a none escape", () => {
  const { request, companies, positions } = buildSystemOneRequest(email(), "jev-latest");
  assertEquals(request.model, "jev-latest");
  assertEquals(request.questions.is_job_update.type, "noul");
  const status = request.questions.status;
  assert(status.type === "choice");
  assertEquals(Object.keys(status.criteria).sort(), ["applied", "interview", "offer", "rejected"]);
  const company = request.questions.company;
  assert(company?.type === "choice");
  assert(NONE in company.criteria);
  assert(companies.includes("Acme"));
  assert(positions.length > 0);
  assertEquals((request.state as Record<string, string>).subject, "Thank you for applying to Acme");
});

Deno.test("interpret thresholds the noul and maps none to null", () => {
  const response: SystemOneResponse = {
    model: "jev-1.13.0",
    answers: {
      is_job_update: { type: "noul", noul: 0.91 },
      status: { type: "choice", choice: "interview", confidence: 0.8 },
      company: { type: "choice", choice: "Acme", confidence: 0.95 },
      position: { type: "choice", choice: NONE, confidence: 0.6 },
    },
  };
  const result = interpretSystemOneResponse(response, ["Acme"], ["Engineer"], 0.6);
  assertEquals(result, {
    isJobRelated: true,
    jobProbability: 0.91,
    status: "interview",
    company: "Acme",
    position: null,
    confidence: 0.8,
    model: "jev-1.13.0",
  });
  assertEquals(
    interpretSystemOneResponse(
      { ...response, answers: { ...response.answers, is_job_update: { type: "noul", noul: 0.3 } } },
      ["Acme"],
      [],
      0.6,
    ).isJobRelated,
    false,
  );
});

Deno.test("an answer outside the offered options is rejected", () => {
  const result = interpretSystemOneResponse(
    {
      model: "m",
      answers: {
        is_job_update: { type: "noul", noul: 1 },
        status: { type: "choice", choice: "ghosted" },
        company: { type: "choice", choice: "Invented Corp" },
      },
    },
    ["Acme"],
    [],
    0.5,
  );
  assertEquals(result.status, null);
  assertEquals(result.company, null);
});

Deno.test("classifier retries 429 with Retry-After, sends bearer auth", async () => {
  const sleeps: number[] = [];
  const { fetch, requests } = scriptedFetch([
    () => new Response("slow down", { status: 429, headers: { "Retry-After": "2" } }),
    () =>
      jsonResponse({
        model: "jev-1.13.0",
        answers: {
          is_job_update: { type: "noul", noul: 0.99 },
          status: { type: "choice", choice: "applied", confidence: 0.9 },
          company: { type: "choice", choice: "Acme", confidence: 0.9 },
        },
      }),
  ]);
  const classifier = new SystemOneClassifier({
    apiKey: "key",
    fetchFn: fetch,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
  const result = await classifier.classify(email());
  assertEquals(result.company, "Acme");
  assertEquals(sleeps, [2000]);
  assertEquals(requests[0].url, "https://api.typesafe.ai/v1/systemone");
  assertEquals(requests[0].headers.get("Authorization"), "Bearer key");
});

Deno.test("classifier does not retry a 422", async () => {
  const { fetch } = scriptedFetch([() => new Response("bad", { status: 422 })]);
  const classifier = new SystemOneClassifier({
    apiKey: "key",
    fetchFn: fetch,
    sleep: () => Promise.resolve(),
  });
  await assertRejects(() => classifier.classify(email()), ProviderHttpError);
});
