/**
 * Pure helpers for `pnpm research:check-links` (scripts/check-research-links.ts),
 * the link checker for the reference-data research notes in `docs/research/`.
 *
 * The script is a dev-only fetch path outside `src/lib/llm.ts`: it checks every
 * URL (and every redirect hop) against the blocked list before any request,
 * and reads only status codes and redirect targets, never a response body
 * (technical-plan.md D59). This module holds the parts that need no network:
 * pulling URLs out of markdown and classifying a status code.
 */

/** How one URL came out of the check. */
export type LinkOutcome = "ok" | "refused" | "broken" | "blocked";

/** One checked URL and the research files it appears in. */
export type LinkResult = {
  url: string;
  files: string[];
  outcome: LinkOutcome;
  /** Final HTTP status, when the site answered. */
  status?: number;
  /** Error code (e.g. `ENOTFOUND`, `TimeoutError`) when no status came back. Never response text. */
  error?: string;
  /** Where redirects ended, when that differs from `url`. */
  finalUrl?: string;
};

// `[`, `]`, `|`, quotes, backticks and angle brackets end a URL: they delimit
// markdown links, autolinks, table cells and code spans far more often than
// they appear inside a real URL.
const URL_PATTERN = /https?:\/\/[^\s<>"'`|[\]]+/gi;

const TRAILING_PUNCTUATION = new Set([".", ",", ";", ":", "]", ">", "*", "!", "?", "…"]);

function count(text: string, ch: string): number {
  let n = 0;
  for (const c of text) if (c === ch) n++;
  return n;
}

/** Strips trailing punctuation and any `)` that does not close a `(` inside the URL. */
function trimUrl(raw: string): string {
  let url = raw;
  for (;;) {
    const last = url.at(-1);
    if (last === undefined) return url;
    if (TRAILING_PUNCTUATION.has(last)) {
      url = url.slice(0, -1);
    } else if (last === ")" && count(url, ")") > count(url, "(")) {
      url = url.slice(0, -1);
    } else {
      return url;
    }
  }
}

/**
 * Every http(s) URL in `markdown` — bare, `<…>` autolinks and `[text](url)`
 * links — trimmed of trailing punctuation, deduped, in first-seen order.
 */
export function extractUrls(markdown: string): string[] {
  const seen = new Set<string>();
  for (const match of markdown.matchAll(URL_PATTERN)) {
    const url = trimUrl(match[0]);
    if (/^https?:\/\/[^/]+/i.test(url)) seen.add(url);
  }
  return [...seen];
}

/**
 * 2xx/3xx are ok; 401, 403 and 429 mean the site answered but refuses
 * automated checks (a warning, not a failure); anything else is broken.
 */
export function classifyStatus(status: number): "ok" | "refused" | "broken" {
  if (status >= 200 && status < 400) return "ok";
  if (status === 401 || status === 403 || status === 429) return "refused";
  return "broken";
}
