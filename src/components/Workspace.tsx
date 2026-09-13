"use client";

/**
 * The single-page workspace (PLAN.md Phase 2.1): chat on the left, the
 * Profile / Fields / Queries panel on the right. This component owns the
 * browser session state and nothing else — every rule it applies is a pure
 * function from `workspace.ts`, `session.ts` or `profile.ts`.
 *
 * All state lives in `localStorage` through `session.ts` and is resent with
 * each turn (PRD: no user data server-side). The only request that leaves the
 * page is `POST /api/turn`, whose stream is decoded by `turn-stream.ts`.
 *
 * The Fields and Queries tabs are placeholders until step 2.4.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useRouter } from "next/navigation";

import ChatPane from "@/components/ChatPane";
import ProfileTab from "@/components/ProfileTab";
import type { AnswerPill, SessionState } from "@/lib/session";
import {
  buildTurnRequest,
  clearSession,
  exportSession,
  importSession,
  loadSession,
  saveSession,
  startOver,
} from "@/lib/session";
import { parseProfile } from "@/lib/profile";
import { sendTurn } from "@/lib/turn-stream";
import {
  appendAssistantMessage,
  appendUserMessage,
  applyTurnResponse,
  confirmProfileSkill,
  EXPORT_FILENAME,
  nextStep,
  profileView,
  rejectProfileSkill,
  toggleCardExcluded,
  type TurnSource,
} from "@/lib/workspace";

type TabName = "profile" | "fields" | "queries";

const TABS: { id: TabName; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "fields", label: "Fields" },
  { id: "queries", label: "Queries" },
];

export default function Workspace() {
  const [state, setState] = useState<SessionState | null>(null);
  const [tab, setTab] = useState<TabName>("profile");
  const [draft, setDraft] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  /** The latest state, readable from inside an in-flight turn. */
  const stateRef = useRef<SessionState | null>(null);

  // localStorage is a browser API: load after mount so the server and the
  // first client render agree.
  useEffect(() => {
    const loaded = loadSession();
    stateRef.current = loaded;
    // The first render has to match the server's (storage-free) output, so the
    // restore can only happen after mount — the documented exception to the
    // "no setState in an effect" rule.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(loaded);
  }, []);

  const commit = useCallback((next: SessionState) => {
    stateRef.current = next;
    setState(next);
    saveSession(next);
  }, []);

  const send = useCallback(
    async (rawText: string, source: TurnSource) => {
      const current = stateRef.current;
      const text = rawText.trim();
      if (current === null || busy || text === "") return;

      const withUser = appendUserMessage(current, text);
      commit(withUser);
      setError(null);
      setBusy(true);
      setStreaming("");

      const { profile } = parseProfile(withUser.profileMd);
      const step = nextStep(profile, { source });
      const request = buildTurnRequest(withUser, step, { kind: "message", content: text });

      try {
        const result = await sendTurn(request);
        if (!result.ok) {
          if (result.kind === "unauthorized") {
            router.replace("/enter");
            return;
          }
          setError(result.message);
          return;
        }

        let accumulated = "";
        let settled = false;
        for await (const event of result.events) {
          if (event.type === "delta") {
            accumulated += event.text;
            setStreaming(accumulated);
          } else if (event.type === "final") {
            const base = stateRef.current ?? withUser;
            commit(applyTurnResponse(base, event.response));
            settled = true;
          } else {
            setError(event.message);
            settled = true;
          }
        }
        if (!settled) {
          if (accumulated === "") {
            setError("The turn ended without a response. Your message is still here; try sending it again.");
          } else {
            const base = stateRef.current ?? withUser;
            commit(appendAssistantMessage(base, accumulated));
          }
        }
      } finally {
        setBusy(false);
        setStreaming(null);
      }
    },
    [busy, commit, router],
  );

  const onSend = useCallback(() => {
    const text = draft;
    if (text.trim() === "") return;
    setDraft("");
    void send(text, "chat").then(() => undefined);
  }, [draft, send]);

  const onPill = useCallback(
    (pill: AnswerPill) => {
      void send(pill.value, "chat");
    },
    [send],
  );

  const onCreateCards = useCallback(() => {
    const text = pasteText;
    if (text.trim() === "") return;
    setPasteText("");
    void send(text, "paste");
  }, [pasteText, send]);

  const editProfile = useCallback(
    (edit: (s: SessionState) => SessionState) => {
      const current = stateRef.current;
      if (current === null) return;
      commit(edit(current));
    },
    [commit],
  );

  const onExport = useCallback(() => {
    const current = stateRef.current;
    if (current === null) return;
    const blob = new Blob([exportSession(current)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = EXPORT_FILENAME;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  const onImportFile = useCallback(
    (file: File) => {
      setImportError(null);
      void file.text().then((text) => {
        const result = importSession(text);
        if (!result.ok) {
          setImportError(result.error);
          return;
        }
        commit(result.value);
      });
    },
    [commit],
  );

  const onStartOver = useCallback(() => {
    if (!window.confirm("Start over? This deletes the profile and chat stored in this browser.")) return;
    clearSession();
    const fresh = startOver();
    setDraft("");
    setPasteText("");
    setError(null);
    setImportError(null);
    setStreaming(null);
    commit(fresh);
  }, [commit]);

  if (state === null) {
    return (
      <div className="workspace-loading">
        <p>Loading your workspace...</p>
      </div>
    );
  }

  const { profile, warnings } = profileView(state);

  return (
    <div className="workspace">
      <ChatPane
        messages={state.messages}
        streaming={streaming}
        error={error}
        busy={busy}
        draft={draft}
        onDraftChange={setDraft}
        onSend={onSend}
        onPill={onPill}
      />

      <aside className="panel" aria-label="Workspace">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? "tab tab-active" : "tab"}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "profile" ? (
          <ProfileTab
            profile={profile}
            warnings={warnings}
            profileMd={state.profileMd}
            busy={busy}
            pasteText={pasteText}
            onPasteTextChange={setPasteText}
            onCreateCards={onCreateCards}
            onToggleCard={(cardId, excluded) =>
              editProfile((s) => toggleCardExcluded(s, cardId, excluded))
            }
            onConfirmSkill={(skill) => editProfile((s) => confirmProfileSkill(s, skill))}
            onRejectSkill={(skill) => editProfile((s) => rejectProfileSkill(s, skill))}
            onExport={onExport}
            onImportFile={onImportFile}
            onStartOver={onStartOver}
            importError={importError}
          />
        ) : null}

        {tab === "fields" ? (
          <div className="panel-body">
            <p className="muted">Fields appear here once discovery runs (step 2.4).</p>
          </div>
        ) : null}

        {tab === "queries" ? (
          <div className="panel-body">
            <p className="muted">Search queries and their feedback appear here (step 2.4).</p>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
