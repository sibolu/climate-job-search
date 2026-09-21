"use client";

/**
 * Post-search feedback (technical-plan.md D41). The four verdicts collapse onto the
 * server's good/bad contract and the chips are prefixed into the `reason`
 * text, so nothing on the server changes. Once the revision lands, the person
 * can accept it, edit it locally, or keep the old one — a whole-turn undo
 * that restores the pre-turn profile and re-records the verdict.
 */

import { useState } from "react";

import { boardLabel } from "@/lib/boards";
import type { Query } from "@/lib/profile";
import type { RevisedQuery, RevisionState, Verdict } from "@/lib/screens";
import {
  REVISION_NOTES,
  VERDICTS,
  VERDICT_CHIPS,
  VERDICT_LABELS,
  feedbackReason,
} from "@/lib/screens";
import { MAX_FEEDBACK_REASON } from "@/lib/workspace";

export interface FeedbackProps {
  /** The query the person judged, as it stood when they pressed the button. */
  query: Query;
  /** The verdict the Searches button preselected. */
  initialVerdict: Verdict;
  /** Minutes since the copy, for the sub line; `undefined` when never copied. */
  copiedMinutes?: number;
  /** Set once the revise turn has landed. */
  revised?: RevisedQuery;
  revisionState: RevisionState;
  onSend: (verdict: Verdict, reason: string) => void;
  onEditRevised: (text: string) => void;
  onAccept: () => void;
  onKeepOld: () => void;
  onBack: () => void;
}

export default function Feedback({
  query,
  initialVerdict,
  copiedMinutes,
  revised,
  revisionState,
  onSend,
  onEditRevised,
  onAccept,
  onKeepOld,
  onBack,
}: FeedbackProps) {
  const [verdict, setVerdict] = useState<Verdict>(initialVerdict);
  const [chips, setChips] = useState<string[]>([]);
  const [text, setText] = useState("");
  const label = boardLabel(query);
  const timing =
    copiedMinutes === undefined
      ? "not copied yet"
      : copiedMinutes === 0
        ? "copied just now"
        : `copied ${copiedMinutes} min ago`;

  return (
    <section className="cc-feedback">
      <div className="cc-screen-head">
        <div>
          <h2 className="cc-h2">How did that search go?</h2>
          <p className="cc-sub">
            {label} · {query.query} · {timing}
          </p>
        </div>
        <button type="button" className="cc-btn-outline" onClick={onBack}>
          Back to searches
        </button>
      </div>

      <div className="cc-card" style={{ padding: 18 }}>
        <div className="cc-verdicts">
          {VERDICTS.map((option) => (
            <button
              key={option}
              type="button"
              className="cc-pill"
              aria-pressed={verdict === option}
              onClick={() => {
                setVerdict(option);
                setChips([]);
              }}
            >
              {VERDICT_LABELS[option]}
            </button>
          ))}
        </div>

        <div className="cc-mono-label" style={{ marginTop: 14 }}>
          What was off?
        </div>
        <div className="cc-chips">
          {VERDICT_CHIPS[verdict].map((chip) => (
            <button
              key={chip}
              type="button"
              className="cc-pill"
              aria-pressed={chips.includes(chip)}
              onClick={() =>
                setChips((current) =>
                  current.includes(chip) ? current.filter((c) => c !== chip) : [...current, chip],
                )
              }
            >
              {chip}
            </button>
          ))}
        </div>

        <textarea
          className="cc-textarea"
          style={{ minHeight: 78, marginTop: 12 }}
          maxLength={MAX_FEEDBACK_REASON}
          placeholder="e.g. mostly utility engineering roles asking for a PE licence"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
          <button
            type="button"
            className="cc-btn"
            disabled={revised !== undefined}
            onClick={() => onSend(verdict, feedbackReason(verdict, chips, text))}
          >
            Send and revise
          </button>
          <span className="cc-note">Revises the query, the ranking and your profile.</span>
        </div>
      </div>

      {revised ? (
        <div className="cc-revised">
          <div className="cc-revised-head">
            <span className="cc-mono-label">Revised search</span>
            <span className="cc-note" style={{ marginLeft: "auto" }}>
              {REVISION_NOTES[revisionState]}
            </span>
          </div>
          <textarea
            className="cc-query-edit"
            value={revised.query.query}
            onChange={(event) => onEditRevised(event.target.value)}
          />
          {revisionState === "accepted" ? (
            <p className="cc-accepted">
              <span className="cc-square" aria-hidden="true" /> Accepted. This replaces the {label}{" "}
              search for this field.
            </p>
          ) : (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button type="button" className="cc-btn" onClick={onAccept}>
                Accept and use
              </button>
              <button type="button" className="cc-btn-outline" onClick={onKeepOld}>
                Keep the old one
              </button>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
