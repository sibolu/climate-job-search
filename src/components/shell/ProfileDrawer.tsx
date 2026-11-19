"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";

import { parseProfile } from "@/lib/profile";
import { PROFILE_MD_FILENAME, profileSummary, type SummarySection } from "@/lib/profile-summary";
import type { SessionState } from "@/lib/session";
import { exportSession, importSession } from "@/lib/session";
import { EXPORT_FILENAME } from "@/lib/workspace";

export interface ProfileDrawerProps {
  state: SessionState;
  profileMd: string;
  onImport: (state: SessionState) => void;
  onClose: () => void;
}

function saveFile(text: string, type: string, filename: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** One headed section; an empty one says so rather than disappearing. */
function Section<T>({
  section,
  children,
}: {
  section: SummarySection<T>;
  children: (item: T) => ReactNode;
}) {
  return (
    <div className="cc-drawer-section">
      <h3 className="cc-drawer-heading">{section.heading}</h3>
      {section.items.length === 0 ? (
        <p className="cc-drawer-empty">{section.emptyText}</p>
      ) : (
        <ul className="cc-drawer-list">{section.items.map(children)}</ul>
      )}
    </div>
  );
}

/**
 * The read-only profile view (technical-plan.md D42): corrections happen
 * through the UI, not here. It shows a readable summary of `profile.md`
 * (technical-plan.md D49; the summary's policy and wording live in
 * `profile-summary.ts`), with the raw file, export and import under
 * "Export". Everything shown lives in this browser only.
 */
export default function ProfileDrawer({ state, profileMd, onImport, onClose }: ProfileDrawerProps) {
  const [importError, setImportError] = useState<string | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const summary = useMemo(() => profileSummary(parseProfile(profileMd).profile), [profileMd]);

  const readFile = async (file: File) => {
    const result = importSession(await file.text());
    if (result.ok) {
      setImportError(undefined);
      onImport(result.value);
    } else {
      setImportError(result.error);
    }
  };

  return (
    <section
      className="cc-drawer"
      aria-label="Your profile"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="cc-drawer-head">
        <div>
          <h2 className="cc-drawer-title">Your profile</h2>
          <p className="cc-drawer-sub">
            Everything here is stored only in this browser, never on a server.
          </p>
        </div>
        <button type="button" className="cc-drawer-btn" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="cc-drawer-body">
        <Section section={summary.preferences}>
          {(pref) => (
            <li key={pref.label}>
              <span className="cc-drawer-label">{pref.label}:</span> {pref.value}{" "}
              {pref.source === "inferred" ? (
                <span className="cc-drawer-note">({pref.sourceText.toLowerCase()})</span>
              ) : null}
            </li>
          )}
        </Section>

        <Section section={summary.expertise}>
          {(skill) => (
            <li key={skill.name}>
              {skill.name}
              {skill.inferred ? <span className="cc-drawer-note"> (inferred)</span> : null}
            </li>
          )}
        </Section>

        <Section section={summary.highlights}>
          {(card) => (
            <li key={`${card.title}-${card.years ?? ""}`}>
              {card.excluded ? <s>{card.title}</s> : card.title}
              {card.years ? <span className="cc-drawer-note"> · {card.years}</span> : null}
              {card.excluded ? <span className="cc-drawer-note"> (left out)</span> : null}
            </li>
          )}
        </Section>

        <Section section={summary.selectedRoles}>
          {(role) => (
            <li key={`${role.title}-${role.fieldName}`}>
              {role.title}
              {role.fieldName ? (
                <span className="cc-drawer-note"> · {role.fieldName}</span>
              ) : null}
            </li>
          )}
        </Section>

        <Section section={summary.searches}>
          {(search) => (
            <li key={`${search.roleTitle}-${search.query}`}>
              <span className="cc-drawer-label">{search.roleTitle}</span>
              <code className="cc-drawer-query">{search.query}</code>
            </li>
          )}
        </Section>
      </div>

      <details className="cc-drawer-export">
        <summary>Export</summary>
        <p className="cc-drawer-empty">
          Save a copy of your profile, or load one you saved earlier.
        </p>
        <div className="cc-drawer-actions">
          <button
            type="button"
            className="cc-drawer-btn"
            onClick={() => saveFile(profileMd, "text/markdown", PROFILE_MD_FILENAME)}
          >
            Download profile.md
          </button>
          <button
            type="button"
            className="cc-drawer-btn"
            onClick={() => saveFile(exportSession(state), "application/json", EXPORT_FILENAME)}
          >
            Download JSON
          </button>
          <button type="button" className="cc-drawer-btn" onClick={() => fileRef.current?.click()}>
            Import
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void readFile(file);
            event.target.value = "";
          }}
        />
        {importError ? (
          <p className="cc-drawer-error" role="alert">
            {importError}
          </p>
        ) : null}
        <details className="cc-drawer-raw">
          <summary>Show the raw file</summary>
          <pre className="cc-drawer-pre">{profileMd.trim() === "" ? "Nothing yet." : profileMd}</pre>
        </details>
      </details>
    </section>
  );
}
