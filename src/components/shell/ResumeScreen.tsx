"use client";

import { useState } from "react";

import type { ResumeView } from "@/lib/screens";

import StartOverDialog from "./StartOverDialog";

export interface ResumeScreenProps {
  /** Which state shows and what it holds: `resumeView` in `screens.ts`. */
  view: ResumeView;
  busy: boolean;
  /** Receives the two boxes as typed; the shell records them, then reads the resume. */
  onStart: (resume: string, notes: string) => void;
  onOpenProfile: () => void;
  onDownloadProfile: () => void;
  onStartOver: () => void;
}

/** Nothing pasted yet: the two boxes and Start. */
function ResumeEntry({
  resume: initialResume,
  notes: initialNotes,
  busy,
  onStart,
  onOpenProfile,
}: {
  resume: string;
  notes: string;
  busy: boolean;
  onStart: (resume: string, notes: string) => void;
  onOpenProfile: () => void;
}) {
  const [resume, setResume] = useState(initialResume);
  const [notes, setNotes] = useState(initialNotes);
  const ready = resume.trim() !== "" && !busy;

  return (
    <>
      <h1 className="cc-h1">Your experience already fits climate work. Find out where.</h1>
      <p className="cc-lead">
        Explore the climate fields that could most use your skills, pick the ones that interest
        you, and get searches to run on job boards.
      </p>

      <div className="cc-resume-card">
        <label className="cc-field-label" htmlFor="cc-resume">
          Paste your resume or bio
        </label>
        <textarea
          id="cc-resume"
          className="cc-textarea"
          value={resume}
          onChange={(event) => setResume(event.target.value)}
        />
        <div className="cc-divider" />
        <label className="cc-field-label" htmlFor="cc-notes">
          What else should shape your results? Where you want to work, what you care about,
          anything you want to avoid. <span className="cc-optional">Optional</span>
        </label>
        <textarea
          id="cc-notes"
          className="cc-textarea cc-textarea-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
        <div className="cc-divider" />
        <div className="cc-resume-actions">
          <button
            type="button"
            className="cc-btn"
            disabled={!ready}
            onClick={() => onStart(resume, notes)}
          >
            {busy ? "Reading…" : "Start"}
          </button>
          <span className="cc-note">You can change anything later.</span>
        </div>
      </div>

      <p style={{ marginTop: 14 }}>
        <button type="button" className="cc-linkish" onClick={onOpenProfile}>
          Data policy
        </button>
      </p>
    </>
  );
}

/**
 * The Resume page (technical-plan.md D55, D56), always reachable from the
 * nav. Before a paste it collects the resume and notes; after, it shows what
 * was read and holds the app's only "Start over".
 */
export default function ResumeScreen({
  view,
  busy,
  onStart,
  onOpenProfile,
  onDownloadProfile,
  onStartOver,
}: ResumeScreenProps) {
  const [confirming, setConfirming] = useState(false);

  if (view.kind === "entry") {
    return (
      <div className="cc-resume">
        <ResumeEntry
          resume={view.resume}
          notes={view.notes}
          busy={busy}
          onStart={onStart}
          onOpenProfile={onOpenProfile}
        />
      </div>
    );
  }

  return (
    <div className="cc-resume">
      <h1 className="cc-h1">Your resume</h1>
      {view.kind === "notStored" ? (
        <p className="cc-lead">This profile was saved without its resume text.</p>
      ) : (
        <>
          <textarea
            className="cc-textarea cc-readonly"
            aria-label="Your resume or bio"
            readOnly
            value={view.resume}
          />
          {view.notes !== undefined ? (
            <>
              <label className="cc-field-label" htmlFor="cc-notes-stored">
                Your notes
              </label>
              <textarea
                id="cc-notes-stored"
                className="cc-textarea cc-textarea-notes cc-readonly"
                readOnly
                value={view.notes}
              />
            </>
          ) : null}
        </>
      )}
      <div className="cc-resume-actions" style={{ marginTop: 18 }}>
        <span className="cc-note">To use a different resume, start over.</span>
        <button type="button" className="cc-btn-outline" onClick={() => setConfirming(true)}>
          Start over
        </button>
      </div>
      <StartOverDialog
        open={confirming}
        onDownload={onDownloadProfile}
        onStartOver={() => {
          setConfirming(false);
          onStartOver();
        }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
