const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
  zwnj: "",
  zwj: "",
};

export function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x"
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|head|title)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|table|section|article|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ");
  return normalizeWhitespace(decodeHtmlEntities(text));
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00a0\u200b\u200c\u200d\ufeff\u034f]/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Drops quoted replies so the classifier sees the newest message in a thread. */
export function stripQuotedReply(text: string): string {
  const lines = text.split("\n");
  const cut = lines.findIndex((line, i) =>
    /^On .{4,200} wrote:$/.test(line) ||
    /^-{2,}\s*Original Message\s*-{2,}$/i.test(line) ||
    (/^From: /.test(line) && i > 0 && /^(Sent|Date): /.test(lines[i + 1] ?? ""))
  );
  const kept = cut > 0 ? lines.slice(0, cut) : lines;
  return kept.filter((line) => !line.startsWith(">")).join("\n").trim();
}

export function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}

export interface ParsedAddress {
  name: string | null;
  address: string | null;
}

export function parseAddressHeader(value: string | null | undefined): ParsedAddress {
  if (!value) return { name: null, address: null };
  const trimmed = value.trim();
  const angle = trimmed.match(/^(.*?)<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/);
  if (angle) {
    const name = angle[1].trim().replace(/^"(.*)"$/, "$1").trim();
    return { name: name || null, address: angle[2].toLowerCase() };
  }
  const bare = trimmed.match(/[^\s<>"]+@[^\s<>"]+/);
  return { name: null, address: bare ? bare[0].toLowerCase() : null };
}

export function prepareBodyForClassification(text: string, maxChars = 6000): string {
  return truncate(stripQuotedReply(normalizeWhitespace(text)), maxChars);
}
