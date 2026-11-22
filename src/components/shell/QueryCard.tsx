"use client";

/**
 * One ticked role's LinkedIn search (technical-plan.md D47): the role, its
 * field, the query, "Open on LinkedIn" (a plain link the person clicks; the
 * app never fetches LinkedIn — PRD: no scraping) and Copy. The email-alert
 * steps stay in `boards.ts` as data and are not shown (technical-plan.md D57).
 * Location and work mode are LinkedIn filters, not part of the query (D36).
 * There are no verdict buttons: query feedback has no UI path in the alpha
 * (D51).
 */

import { useState } from "react";

import type { Query } from "@/lib/profile";
import { boardSearchUrl } from "@/lib/screens";

export interface QueryCardProps {
  roleTitle: string;
  fieldName: string;
  query: Query;
  /** Minutes since the copy, or `undefined` when it was never copied. */
  copiedMinutes?: number;
  onCopy: () => void;
}

export default function QueryCard({
  roleTitle,
  fieldName,
  query,
  copiedMinutes,
  onCopy,
}: QueryCardProps) {
  const [failed, setFailed] = useState(false);
  const url = boardSearchUrl("linkedin", query.query);

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
      <h3 className="cc-query-role">{roleTitle}</h3>
      {fieldName ? <p className="cc-note">{fieldName}</p> : null}

      <pre className="cc-query-text">{query.query}</pre>

      <div className="cc-query-actions">
        {url ? (
          <a className="cc-btn cc-btn-link" href={url} target="_blank" rel="noopener noreferrer">
            Open on LinkedIn
          </a>
        ) : null}
        <button type="button" className="cc-btn-outline" onClick={() => void copy()}>
          {copiedMinutes === undefined ? "Copy" : "Copied"}
        </button>
        {copiedMinutes !== undefined ? (
          <span className="cc-note">
            copied {copiedMinutes === 0 ? "just now" : `${copiedMinutes} min ago`}
          </span>
        ) : null}
        {failed ? (
          <span className="cc-note">Copy the text by hand: the clipboard was blocked.</span>
        ) : null}
      </div>

    </article>
  );
}
