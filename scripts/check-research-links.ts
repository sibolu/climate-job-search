/**
 * `pnpm research:check-links [path…]` — check every URL in the research notes.
 *
 * Walks `docs/research/` (or the files and folders given) for `.md`, collects
 * each http(s) URL with the files it appears in, and checks it:
 *
 * - A URL on a blocked host (linkedin.com, indeed.com, climatebase.org and
 *   their subdomains, `BLOCKED_SOURCE_DOMAINS`) is a failure and is never
 *   fetched.
 * - Every other URL gets a HEAD request (GET once more on 403/404/405/501 or a
 *   network error, with the body cancelled unread). Redirects are followed by
 *   hand so each hop's host is checked against the blocked list *before* it is
 *   requested; a redirect onto a blocked host is a failure.
 * - 2xx/3xx is ok, 401/403/429 is "refused" (a warning: the site answered but
 *   refuses automated checks), anything else is broken.
 *
 * Exits 1 on any blocked or broken URL, else 0.
 *
 * This is a dev-only fetch path outside `src/lib/llm.ts` (technical-plan.md
 * D59). It checks the blocked list before any request, reads only status codes
 * and redirect `Location` headers, never a response body, and sends a generic
 * User-Agent. It prints error codes, never response text.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { isBlockedSourceHost } from "../src/lib/reference-schema";
import { classifyStatus, extractUrls, type LinkResult } from "../src/lib/research-links";

const DEFAULT_ROOT = "docs/research";
const CONCURRENCY = 8;
const TIMEOUT_MS = 45_000;
const MAX_REDIRECTS = 10;
const USER_AGENT = "research-link-check/1.0";
const RETRY_WITH_GET = new Set([403, 404, 405, 501]);

async function markdownFiles(target: string): Promise<string[]> {
  const info = await stat(target);
  if (info.isFile()) return target.endsWith(".md") ? [target] : [];
  const out: string[] = [];
  for (const entry of await readdir(target, { withFileTypes: true })) {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) out.push(...(await markdownFiles(child)));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(child);
  }
  return out.sort();
}

type Probe =
  | { kind: "status"; status: number; finalUrl: string }
  | { kind: "blocked"; finalUrl: string }
  | { kind: "error"; error: string };

function errorCode(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: { code?: unknown } }).cause;
    if (cause && typeof cause.code === "string") return cause.code;
    if (err.name && err.name !== "Error") return err.name;
  }
  return "network-error";
}

/** One method, redirects followed by hand so a blocked hop is never requested. */
async function probe(url: string, method: "HEAD" | "GET"): Promise<Probe> {
  let current = url;
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (isBlockedSourceHost(current)) return { kind: "blocked", finalUrl: current };
      const res = await fetch(current, {
        method,
        redirect: "manual",
        signal,
        headers: { "User-Agent": USER_AGENT },
      });
      await res.body?.cancel();
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        current = new URL(location, current).toString();
        continue;
      }
      return { kind: "status", status: res.status, finalUrl: current };
    }
    return { kind: "error", error: "too-many-redirects" };
  } catch (err) {
    return { kind: "error", error: errorCode(err) };
  }
}

async function check(url: string, files: string[]): Promise<LinkResult> {
  if (isBlockedSourceHost(url)) return { url, files, outcome: "blocked" };
  let result = await probe(url, "HEAD");
  if (result.kind === "error" || (result.kind === "status" && RETRY_WITH_GET.has(result.status))) {
    result = await probe(url, "GET");
  }
  if (result.kind === "error") return { url, files, outcome: "broken", error: result.error };
  const finalUrl = result.finalUrl === url ? undefined : result.finalUrl;
  if (result.kind === "blocked") return { url, files, outcome: "blocked", finalUrl };
  return { url, files, outcome: classifyStatus(result.status), status: result.status, finalUrl };
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function printGroup(title: string, results: LinkResult[]): void {
  if (results.length === 0) return;
  console.log(`\n${title} (${results.length})`);
  for (const r of results) {
    const detail = r.status !== undefined ? String(r.status) : (r.error ?? "blocked host");
    const via = r.finalUrl ? ` -> ${r.finalUrl}` : "";
    console.log(`  [${detail}] ${r.url}${via}`);
    console.log(`      in ${r.files.join(", ")}`);
  }
}

async function main(): Promise<void> {
  const targets = process.argv.slice(2);
  const roots = targets.length > 0 ? targets : [DEFAULT_ROOT];

  const filesByUrl = new Map<string, string[]>();
  let fileCount = 0;
  for (const root of roots) {
    for (const file of await markdownFiles(root)) {
      fileCount++;
      for (const url of extractUrls(await readFile(file, "utf8"))) {
        const files = filesByUrl.get(url) ?? [];
        if (!files.includes(file)) files.push(file);
        filesByUrl.set(url, files);
      }
    }
  }

  const results = await pool([...filesByUrl], CONCURRENCY, ([url, files]) => check(url, files));
  const by = (o: LinkResult["outcome"]) => results.filter((r) => r.outcome === o);
  const blocked = by("blocked");
  const broken = by("broken");
  const refused = by("refused");

  printGroup("BLOCKED (never fetched; remove these)", blocked);
  printGroup("BROKEN", broken);
  printGroup("REFUSED (warning: site refuses automated checks; verify by hand)", refused);
  console.log(
    `\n${results.length} URLs in ${fileCount} files: ${by("ok").length} ok, ` +
      `${refused.length} refused, ${broken.length} broken, ${blocked.length} blocked`,
  );

  process.exit(blocked.length > 0 || broken.length > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(`check-research-links failed: ${err instanceof Error ? err.name : "unknown error"}`);
  process.exit(1);
});
