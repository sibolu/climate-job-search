"use client";

/**
 * One board search: the query text, Copy, a link that opens the board's own
 * search page in the person's tab (never fetched here — PRD: no scraping),
 * the alert steps, and the two feedback buttons.
 */

import { useState } from "react";

import { ALERT_STEPS, boardLabel } from "@/lib/boards";
import type { Query } from "@/lib/profile";
import { boardSearchUrl } from "@/lib/screens";

export interface QueryCardProps {
  query: Query;
  /** `m` minutes since the copy, or `undefined` when it was never copied. */
  copiedMinutes?: number;
  onCopy: () => void;
  onFeedback: (verdict: "good" | "wrong") => void;
}

export default function QueryCard({ query, copiedMinutes, onCopy, onFeedback }: QueryCardProps) {
  const [failed, setFailed] = useState(false);
  const label = boardLabel(query);
  const url = boardSearchUrl(query.board, query.query);

  async function copy() {
    try {
      await navigator.clipboard.writeText(query.query);
      setFailed(false);
      onCopy();
    } catch {
      setFailed(true);
    }
  }

  return (
    <article className="cc-query-card">
      <div className="cc-query-head">
        <span className="cc-move-dot" data-board={query.board} aria-hidden="true" />
        <span className="cc-query-board">{label}</span>
        {query.status !== "untried" ? (
          <span className="cc-mono-label" style={{ marginLeft: "auto" }}>
            marked {query.status === "good" ? "good" : "wrong"}
          </span>
        ) : null}
      </div>

      <pre className="cc-query-text">{query.query}</pre>

      <div className="cc-query-actions">
        <button type="button" className="cc-btn" onClick={() => void copy()}>
          {copiedMinutes === undefined ? "Copy query" : "Copied"}
        </button>
        {url ? (
          <a className="cc-btn-outline" href={url} target="_blank" rel="noreferrer noopener">
            Open {label}
          </a>
        ) : null}
        {copiedMinutes !== undefined ? (
          <span className="cc-note">
            copied {copiedMinutes === 0 ? "just now" : `${copiedMinutes} min ago`}
          </span>
        ) : null}
        {failed ? <span className="cc-note">Copy the text by hand — the clipboard was blocked.</span> : null}
      </div>

      <details className="cc-alert">
        <summary>Turn it into an email alert</summary>
        <ol>
          {ALERT_STEPS[query.board].map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </details>

      <div className="cc-query-footer">
        <span className="cc-note">Ran it?</span>
        <button type="button" className="cc-btn-outline" onClick={() => onFeedback("good")}>
          Good results
        </button>
        <button type="button" className="cc-btn-outline" onClick={() => onFeedback("wrong")}>
          Wrong results
        </button>
      </div>
    </article>
  );
}
