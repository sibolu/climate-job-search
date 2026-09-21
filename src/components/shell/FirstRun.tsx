"use client";

import { useState } from "react";

import { composeStartText } from "@/lib/screens";

export interface FirstRunProps {
  busy: boolean;
  /** Receives the pasted text with the notes block already appended (D39). */
  onStart: (text: string) => void;
  onOpenProfile: () => void;
}

export default function FirstRun({ busy, onStart, onOpenProfile }: FirstRunProps) {
  const [pasted, setPasted] = useState("");
  const [notes, setNotes] = useState("");
  const ready = pasted.trim() !== "" && !busy;

  return (
    <div className="cc-firstrun">
      <h1 className="cc-h1">
        Start from what you have done, not from the word &ldquo;climate&rdquo;.
      </h1>
      <p className="cc-lead">
        Paste your resume or bio. See climate fields your experience could open up, and the
        searches to run on job boards.
      </p>

      <div className="cc-firstrun-card">
        <label className="cc-visually-hidden" htmlFor="cc-resume">
          Your resume or bio
        </label>
        <textarea
          id="cc-resume"
          className="cc-textarea"
          placeholder="Paste your resume or bio…"
          value={pasted}
          onChange={(event) => setPasted(event.target.value)}
        />
        <div className="cc-divider" />
        <label className="cc-visually-hidden" htmlFor="cc-notes">
          Notes
        </label>
        <textarea
          id="cc-notes"
          className="cc-textarea cc-textarea-notes"
          placeholder="Notes: constraints, interests, what you don't want. Optional."
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
        <div className="cc-divider" />
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="button"
            className="cc-btn"
            disabled={!ready}
            onClick={() => onStart(composeStartText(pasted, notes))}
          >
            {busy ? "Reading…" : "Start"}
          </button>
          <span className="cc-note">About a minute. You can correct everything after.</span>
        </div>
      </div>

      <p style={{ marginTop: 14 }}>
        <button type="button" className="cc-linkish" onClick={onOpenProfile}>
          No account, nothing stored.
        </button>
      </p>
    </div>
  );
}
