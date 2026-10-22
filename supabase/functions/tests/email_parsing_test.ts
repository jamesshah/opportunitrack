import { assert, assertEquals } from "@std/assert";
import {
  htmlToText,
  parseAddressHeader,
  prepareBodyForClassification,
  stripQuotedReply,
} from "../_shared/email/text.ts";
import {
  extractCompanyCandidates,
  extractPositionCandidates,
} from "../_shared/classifier/candidates.ts";
import { prefilterMessage } from "../_shared/classifier/prefilter.ts";
import { email, summaryOf } from "./fakes.ts";

Deno.test("htmlToText drops markup, scripts and decodes entities", () => {
  const text = htmlToText(
    "<html><head><style>p{}</style></head><body><p>Hi&nbsp;Jane,</p><p>Thanks &amp; regards<br>Acme</p><script>x()</script></body></html>",
  );
  assertEquals(text, "Hi Jane,\nThanks & regards\nAcme");
});

Deno.test("parseAddressHeader handles quoted names and bare addresses", () => {
  assertEquals(parseAddressHeader('"Acme Careers" <Jobs@Acme.com>'), {
    name: "Acme Careers",
    address: "jobs@acme.com",
  });
  assertEquals(parseAddressHeader("noreply@greenhouse.io"), {
    name: null,
    address: "noreply@greenhouse.io",
  });
  assertEquals(parseAddressHeader(undefined), { name: null, address: null });
});

Deno.test("stripQuotedReply keeps only the newest message", () => {
  const text =
    "Great, see you Monday.\n\nOn Mon, Oct 20, 2026 at 9:00 AM Jane <j@x.com> wrote:\n> Can you interview?";
  assertEquals(stripQuotedReply(text), "Great, see you Monday.");
});

Deno.test("prepareBodyForClassification truncates long bodies", () => {
  const out = prepareBodyForClassification("a ".repeat(10_000), 100);
  assert(out.length <= 101);
});

Deno.test("company candidates come from sender name, domain and body phrases", () => {
  const candidates = extractCompanyCandidates(email({
    fromName: "Globex Talent Acquisition",
    fromAddress: "no-reply@us.greenhouse-mail.io",
    subject: "Your application to Initech",
    text: "Thank you for your interest in Initech. The Initech Team",
  }));
  assert(candidates.includes("Globex"), `got ${candidates}`);
  assert(candidates.some((c) => c === "Initech"), `got ${candidates}`);
  assert(!candidates.some((c) => /greenhouse/i.test(c)), "ATS domains are not companies");
});

Deno.test("company from a corporate sender domain", () => {
  const candidates = extractCompanyCandidates(
    email({ fromName: null, fromAddress: "talent@mail.hooli-xyz.com", subject: "", text: "" }),
  );
  assertEquals(candidates, ["Hooli Xyz"]);
});

Deno.test("position candidates include title phrases", () => {
  const candidates = extractPositionCandidates(email({
    subject: "Interview for Staff Backend Engineer",
    text: "We'd like to schedule an interview for the Staff Backend Engineer role.",
  }));
  assert(candidates.includes("Staff Backend Engineer"), `got ${candidates}`);
});

Deno.test("prefilter keeps ATS senders and hiring language, drops the rest", () => {
  assert(
    prefilterMessage(
      summaryOf(email({ subject: "Update", text: "", fromAddress: "x@hire.lever.co" })),
    ).candidate,
  );
  assert(prefilterMessage(summaryOf(email())).candidate);
  assertEquals(
    prefilterMessage(
      summaryOf(
        email({
          subject: "Your weekly receipt",
          text: "Order #123 shipped",
          fromName: "Shop",
          fromAddress: "orders@shop.com",
        }),
      ),
    ),
    { candidate: false, reason: "no_signal" },
  );
  assertEquals(prefilterMessage(summaryOf(email({ labels: ["SPAM"] }))).reason, "excluded_label");
});

Deno.test("prefilter: ATS mail in Promotions still counts, other Promotions mail does not", () => {
  const promo = { labels: ["INBOX", "CATEGORY_PROMOTIONS"] };
  assert(
    prefilterMessage(summaryOf(email({ ...promo, fromAddress: "no-reply@myworkday.com" })))
      .candidate,
  );
  assertEquals(prefilterMessage(summaryOf(email(promo))).reason, "bulk_category");
});
