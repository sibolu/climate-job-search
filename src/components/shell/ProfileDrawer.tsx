"use client";

import { useRef, useState } from "react";

import type { SessionState } from "@/lib/session";
import { exportSession, importSession } from "@/lib/session";
import { EXPORT_FILENAME } from "@/lib/workspace";

export interface ProfileDrawerProps {
  state: SessionState;
  profileMd: string;
  onImport: (state: SessionState) => void;
  onDelete: () => void;
  onClose: () => void;
}

/**
 * The read-only profile view (technical-plan.md D42): export, import and
 * "Delete everything". Corrections happen through the UI, not here.
 * Everything shown lives in this browser only — nothing is stored server-side.
 */
export default function ProfileDrawer({
  state,
  profileMd,
  onImport,
  onDelete,
  onClose,
}: ProfileDrawerProps) {
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [importError, setImportError] = useState<string | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const download = () => {
    const blob = new Blob([exportSession(state)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = EXPORT_FILENAME;
    link.click();
    URL.revokeObjectURL(url);
  };

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
    <section className="cc-drawer" aria-label="Your profile">
      <div className="cc-drawer-head">
        <div>
          <div className="cc-drawer-title">Your profile</div>
          <div className="cc-drawer-sub">Stored on this device only. Never on a server.</div>
        </div>
        <button
          type="button"
          className="cc-info"
          aria-label="About this data"
          aria-expanded={privacyOpen}
          onClick={() => setPrivacyOpen((open) => !open)}
        >
          i
        </button>
        <div className="cc-drawer-actions">
          <button type="button" className="cc-dark-btn" onClick={download}>
            Export .json
          </button>
          <button
            type="button"
            className="cc-dark-btn cc-dark-btn-outline"
            onClick={() => fileRef.current?.click()}
          >
            Import
          </button>
          <button
            type="button"
            className="cc-dark-btn cc-dark-btn-danger"
            onClick={() => {
              if (window.confirm("Delete everything on this device and start over?")) onDelete();
            }}
          >
            Delete everything
          </button>
          <button type="button" className="cc-dark-btn cc-dark-btn-outline" onClick={onClose}>
            Hide
          </button>
        </div>
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

      {privacyOpen ? (
        <p className="cc-privacy">
          Your profile, chat and feedback live in this browser&rsquo;s local storage and are sent
          with each request only so the assistant can answer. Nothing is kept on the server.
        </p>
      ) : null}

      {importError ? (
        <p className="cc-privacy" style={{ color: "var(--danger-text)" }}>
          {importError}
        </p>
      ) : null}

      <pre className="cc-pre">{profileMd.trim() === "" ? "Nothing yet." : profileMd}</pre>
    </section>
  );
}
