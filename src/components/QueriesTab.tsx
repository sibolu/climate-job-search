"use client";

/**
 * The Queries tab: one card per search query — the board it is for, the query
 * text with a Copy button, the fields it serves, its status, the steps for
 * saving it as an email alert on that board, and the "Tried it" control.
 *
 * The app never fetches a job board (PRD). Copy the query, run it yourself,
 * and tell us how it went: the feedback edits the profile text locally and
 * then asks for a revision.
 */

import { useState } from "react";

import { ALERT_STEPS, boardLabel } from "@/lib/boards";
import type { Profile, Query, QueryStatus } from "@/lib/profile";
import type { QueryFeedback } from "@/lib/session";
import { MAX_FEEDBACK_REASON, normalizeFeedbackReason } from "@/lib/workspace";

export interface QueriesTabProps {
  profile: Profile;
  busy: boolean;
  /** True when at least one field is accepted or unsure. */
  canGenerate: boolean;
  onGenerateQueries: () => void;
  onFeedback: (feedback: QueryFeedback, board: string) => void;
}

const STATUS_LABELS: Record<QueryStatus, string> = {
  untried: "Not tried yet",
  good: "Good fit",
  bad: "Bad fit",
};

type CopyState = "idle" | "copied" | "failed";

function QueryCard({
  query,
  fieldNames,
  busy,
  onFeedback,
}: {
  query: Query;
  fieldNames: string[];
  busy: boolean;
  onFeedback: (feedback: QueryFeedback, board: string) => void;
}) {
  const [copy, setCopy] = useState<CopyState>("idle");
  const [reason, setReason] = useState(query.reason);
  const board = boardLabel(query);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(query.query);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  };

  const submit = (verdict: "good" | "bad") => {
    onFeedback(
      { queryId: query.id, verdict, reason: normalizeFeedbackReason(reason) },
      board,
    );
  };

  return (
    <section className="query-card">
      <div className="field-head">
        <h3>
          {board} <span className="muted">{query.id}</span>
        </h3>
        <span className={`badge badge-query-${query.status}`}>{STATUS_LABELS[query.status]}</span>
      </div>

      <p className="query-text">{query.query}</p>
      <div className="button-row">
        <button type="button" className="secondary" onClick={() => void onCopy()}>
          Copy
        </button>
        <span className="muted" role="status">
          {copy === "copied" ? "Copied" : null}
          {copy === "failed" ? "Copy failed — select the text" : null}
        </span>
      </div>

      <p className="muted">
        {fieldNames.length === 0 ? "No fields listed" : `Serves ${fieldNames.join(", ")}`}
        {query.changedAt === undefined ? "" : ` · updated ${query.changedAt}`}
      </p>

      <details className="alert-steps">
        <summary>Save this as an email alert on {board}</summary>
        <ol>
          {ALERT_STEPS[query.board].map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </details>

      <div className="feedback-box">
        <h4>Tried it?</h4>
        <label htmlFor={`why-${query.id}`}>
          Why (optional for a good fit, and the most useful thing you can tell us about a bad one)
        </label>
        <textarea
          id={`why-${query.id}`}
          className="paste-box"
          rows={2}
          maxLength={MAX_FEEDBACK_REASON}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. mostly senior roles, or all in the wrong country"
        />
        <div className="button-row">
          <button type="button" className="secondary" disabled={busy} onClick={() => submit("good")}>
            Good fit
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => submit("bad")}>
            Bad fit
          </button>
        </div>
      </div>
    </section>
  );
}

export default function QueriesTab({
  profile,
  busy,
  canGenerate,
  onGenerateQueries,
  onFeedback,
}: QueriesTabProps) {
  const nameOf = (fieldId: string) =>
    profile.fields.find((f) => f.id === fieldId)?.name ?? fieldId;

  return (
    <div className="panel-body">
      <section className="panel-section">
        <div className="button-row">
          <button
            type="button"
            className="secondary"
            disabled={busy || !canGenerate}
            onClick={onGenerateQueries}
          >
            Generate queries
          </button>
        </div>
        {canGenerate ? null : (
          <p className="muted">
            Accept a field (or mark one unsure) on the Fields tab first — queries are built from the
            fields you are actually aiming at.
          </p>
        )}
      </section>

      {profile.queries.length === 0 ? (
        <p className="muted">No search queries yet.</p>
      ) : (
        profile.queries.map((query) => (
          <QueryCard
            key={query.id}
            query={query}
            fieldNames={query.fieldIds.map(nameOf)}
            busy={busy}
            onFeedback={onFeedback}
          />
        ))
      )}
    </div>
  );
}
