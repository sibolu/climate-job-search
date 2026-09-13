"use client";

/**
 * The Profile tab: paste box, the experience cards with their exclude toggle,
 * the skill buckets with confirm/reject, export / import / start over, and a
 * read-only view of the `profile.md` text that is the user's actual file.
 *
 * The user is in charge of the profile (PRD): cards are excluded, never
 * deleted, and an inferred skill can always be rejected.
 *
 * The card and skill controls are disabled while a turn is in flight: that
 * turn returns the whole `profile.md`, so an edit made under it would be
 * overwritten. Export, import and "Start over" stay live — they replace or
 * read the session rather than editing it, and `Workspace` abandons the
 * in-flight turn before it applies either replacement.
 */

import { useRef } from "react";

import type { Profile } from "@/lib/profile";

export interface ProfileTabProps {
  profile: Profile;
  /** `parseProfile` warnings; shown rather than swallowed. */
  warnings: string[];
  profileMd: string;
  busy: boolean;
  pasteText: string;
  onPasteTextChange: (value: string) => void;
  onCreateCards: () => void;
  onToggleCard: (cardId: string, excluded: boolean) => void;
  onConfirmSkill: (skill: string) => void;
  onRejectSkill: (skill: string) => void;
  onExport: () => void;
  onImportFile: (file: File) => void;
  onStartOver: () => void;
  /** Import failure text from `importSession`, if the last import failed. */
  importError: string | null;
}

export default function ProfileTab({
  profile,
  warnings,
  profileMd,
  busy,
  pasteText,
  onPasteTextChange,
  onCreateCards,
  onToggleCard,
  onConfirmSkill,
  onRejectSkill,
  onExport,
  onImportFile,
  onStartOver,
  importError,
}: ProfileTabProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="panel-body">
      <section className="panel-section">
        <h3>Paste your resume or profile text</h3>
        <textarea
          className="paste-box"
          rows={6}
          value={pasteText}
          placeholder="Paste plain text here. Nothing is stored on a server."
          onChange={(event) => onPasteTextChange(event.target.value)}
        />
        <button type="button" onClick={onCreateCards} disabled={busy || pasteText.trim() === ""}>
          Create cards
        </button>
      </section>

      {warnings.length > 0 ? (
        <section className="panel-section warnings" role="alert">
          <h3>Profile warnings</h3>
          <ul>
            {warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="panel-section">
        <h3>Experience cards ({profile.cards.length})</h3>
        {profile.cards.length === 0 ? (
          <p className="muted">No cards yet.</p>
        ) : (
          <ul className="card-list">
            {profile.cards.map((card) => (
              <li key={card.id} className={card.excluded ? "card card-excluded" : "card"}>
                <div className="card-head">
                  <strong>
                    {card.id} — {card.title}
                  </strong>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => onToggleCard(card.id, !card.excluded)}
                  >
                    {card.excluded ? "Include" : "Exclude"}
                  </button>
                </div>
                <dl className="sar">
                  <dt>Situation</dt>
                  <dd>{card.situation}</dd>
                  <dt>Actions</dt>
                  <dd>{card.actions}</dd>
                  <dt>Results</dt>
                  <dd>{card.results}</dd>
                </dl>
                {card.skills.length > 0 ? <p className="muted">Skills: {card.skills.join(", ")}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel-section">
        <h3>Skills</h3>
        <h4>Confirmed</h4>
        {profile.skills.confirmed.length === 0 ? (
          <p className="muted">None yet.</p>
        ) : (
          <ul className="skill-list">
            {profile.skills.confirmed.map((skill) => (
              <li key={skill}>
                <span>{skill}</span>
                <button type="button" className="secondary" disabled={busy} onClick={() => onRejectSkill(skill)}>
                  Reject
                </button>
              </li>
            ))}
          </ul>
        )}

        <h4>Inferred</h4>
        {profile.skills.inferred.length === 0 ? (
          <p className="muted">None yet.</p>
        ) : (
          <ul className="skill-list">
            {profile.skills.inferred.map((skill) => (
              <li key={skill}>
                <span>{skill}</span>
                <span className="skill-actions">
                  <button type="button" className="secondary" disabled={busy} onClick={() => onConfirmSkill(skill)}>
                    Confirm
                  </button>
                  <button type="button" className="secondary" disabled={busy} onClick={() => onRejectSkill(skill)}>
                    Reject
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {profile.skills.excluded.length > 0 ? (
          <>
            <h4>Excluded</h4>
            <ul className="skill-list">
              {profile.skills.excluded.map((skill) => (
                <li key={skill}>
                  <span>{skill}</span>
                  <button type="button" className="secondary" disabled={busy} onClick={() => onConfirmSkill(skill)}>
                    Confirm
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <section className="panel-section">
        <h3>Your file</h3>
        <div className="button-row">
          <button type="button" className="secondary" onClick={onExport}>
            Export
          </button>
          <button type="button" className="secondary" onClick={() => fileRef.current?.click()}>
            Import
          </button>
          <button type="button" className="secondary" onClick={onStartOver}>
            Start over
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onImportFile(file);
          }}
        />
        {importError !== null ? (
          <p className="warnings" role="alert">
            {importError}
          </p>
        ) : null}
        <details className="profile-md">
          <summary>profile.md</summary>
          <pre>{profileMd === "" ? "(empty)" : profileMd}</pre>
        </details>
      </section>
    </div>
  );
}
