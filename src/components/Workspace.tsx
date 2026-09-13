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
 * The Fields and Queries tabs (step 2.4) edit the profile locally through
 * `workspace.ts` and post their own turns — explore, queries, revise.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useRouter } from "next/navigation";

import ChatPane from "@/components/ChatPane";
import FieldsTab from "@/components/FieldsTab";
import ProfileTab from "@/components/ProfileTab";
import QueriesTab from "@/components/QueriesTab";
import type { AnswerPill, QueryFeedback, SessionState, TurnInput } from "@/lib/session";
import {
  buildTurnRequest,
  clearSession,
  exportSession,
  importSession,
  loadSession,
  saveSession,
  startOver,
} from "@/lib/session";
import type { Field } from "@/lib/profile";
import { parseProfile } from "@/lib/profile";
import { sendTurn } from "@/lib/turn-stream";
import {
  appendAssistantMessage,
  appendUserMessage,
  applyQueryFeedback,
  applyTurnResponse,
  canGenerateQueries,
  confirmProfileSkill,
  EXPORT_FILENAME,
  exploreChatText,
  feedbackChatText,
  GENERATE_QUERIES_TEXT,
  nextStep,
  profileView,
  rejectProfileSkill,
  setProfileFieldStatus,
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

  /**
   * Posts one turn. `input` is what the server receives (a message or query
   * feedback); `chatText` is the bubble the user sees for it.
   */
  const send = useCallback(
    async (input: TurnInput, source: TurnSource, chatText: string) => {
      const current = stateRef.current;
      const text = chatText.trim();
      if (current === null || busy || text === "") return;

      const withUser = appendUserMessage(current, text);
      commit(withUser);
      setError(null);
      setBusy(true);
      setStreaming("");

      const { profile } = parseProfile(withUser.profileMd);
      const step = nextStep(profile, { source });
      const request = buildTurnRequest(withUser, step, input);

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
    const text = draft.trim();
    if (text === "") return;
    setDraft("");
    void send({ kind: "message", content: text }, "chat", text);
  }, [draft, send]);

  const onPill = useCallback(
    (pill: AnswerPill) => {
      void send({ kind: "message", content: pill.value }, "chat", pill.value);
    },
    [send],
  );

  const onCreateCards = useCallback(() => {
    const text = pasteText.trim();
    if (text === "") return;
    setPasteText("");
    void send({ kind: "message", content: text }, "paste", text);
  }, [pasteText, send]);

  const editProfile = useCallback(
    (edit: (s: SessionState) => SessionState) => {
      const current = stateRef.current;
      if (current === null) return;
      commit(edit(current));
    },
    [commit],
  );

  /** Explore a field. The server marks it explored; nothing changes locally. */
  const onExplore = useCallback(
    (field: Field) => {
      const text = exploreChatText(field);
      void send({ kind: "message", content: text }, "explore", text);
    },
    [send],
  );

  const onGenerateQueries = useCallback(() => {
    void send(
      { kind: "message", content: GENERATE_QUERIES_TEXT },
      "queries",
      GENERATE_QUERIES_TEXT,
    );
  }, [send]);

  /**
   * "Tried it": the profile text is updated first so the verdict survives a
   * failed request, then the revision turn is posted.
   */
  const onQueryFeedback = useCallback(
    (feedback: QueryFeedback, board: string) => {
      const current = stateRef.current;
      if (current === null || busy) return;
      commit(applyQueryFeedback(current, feedback));
      void send({ kind: "feedback", feedback }, "feedback", feedbackChatText(feedback, board));
    },
    [busy, commit, send],
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
          <FieldsTab
            profile={profile}
            busy={busy}
            onSetFieldStatus={(fieldId, status) =>
              editProfile((s) => setProfileFieldStatus(s, fieldId, status))
            }
            onExplore={onExplore}
          />
        ) : null}

        {tab === "queries" ? (
          <QueriesTab
            profile={profile}
            busy={busy}
            canGenerate={canGenerateQueries(profile)}
            onGenerateQueries={onGenerateQueries}
            onFeedback={onQueryFeedback}
          />
        ) : null}
      </aside>
    </div>
  );
}
