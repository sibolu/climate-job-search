"use client";

/**
 * The exploration-first shell (technical-plan.md D37, D38, D42): one centred
 * column, no rail (technical-plan.md D49). It owns the
 * browser session (`localStorage` through `session.ts` — nothing is stored
 * server-side), the single in-flight turn and its abort controller, and the
 * screen state, which is derived in `screens.ts` rather than tracked here.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { AnswerPill, QueryFeedback, SessionState, StepName, TurnInput } from "@/lib/session";
import { clearSession, buildTurnRequest, loadSession, saveSession, startOver } from "@/lib/session";
import { applyPillAnswer } from "@/lib/elicit";
import type { Card, FieldStatus, Profile } from "@/lib/profile";
import {
  parseProfile,
  serializeProfile,
  setCardExcluded,
  setFieldStatus,
  setQueryText,
  setRoleSelected,
  upsertCard,
} from "@/lib/profile";
import type { LogLine, NavStep, RevisionState, TurnSnapshot, Verdict, View } from "@/lib/screens";
import {
  FIND_ROLES_PILL,
  appendLogLines,
  boardOrder,
  currentScreen,
  formatElapsed,
  hasLiveQueries,
  navStepFor,
  restoreSnapshot,
  revisedQueryFor,
  showNav,
  takeSnapshot,
  verdictToServer,
} from "@/lib/screens";
import { sendTurn } from "@/lib/turn-stream";
import {
  applyQueryFeedback,
  applyTurnResponse,
  buildSelectedRolesTurnInput,
  canWriteQueries,
  confirmProfileSkill,
  nextStep,
  rejectProfileSkill,
} from "@/lib/workspace";

import FeedbackScreen from "./Feedback";
import FieldBoard from "./FieldBoard";
import FirstRun from "./FirstRun";
import Header from "./Header";
import Highlights from "./Highlights";
import Pending from "./Pending";
import ProfileDrawer from "./ProfileDrawer";
import Searches from "./Searches";

/**
 * Wall clock, read through a module-level helper: the turn runner is not a
 * render-phase function, but the purity lint cannot tell, and the timestamp
 * only ever labels a snapshot or a copy.
 */
function nowMs(): number {
  return Date.now();
}

export default function AppShell() {
  const router = useRouter();
  const [state, setState] = useState<SessionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState("0:00");
  const [errorText, setErrorText] = useState<string | undefined>(undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sectorGroups, setSectorGroups] = useState<string[]>([]);
  const [view, setView] = useState<View>("board");
  const [order, setOrder] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | undefined>(undefined);
  const [copiedAt, setCopiedAt] = useState<Record<string, number>>({});
  const [now, setNow] = useState(0);
  const [judged, setJudged] = useState<{ queryId: string; verdict: Verdict } | null>(null);
  const [sentFeedback, setSentFeedback] = useState<QueryFeedback | null>(null);
  const [snapshot, setSnapshot] = useState<TurnSnapshot | null>(null);
  const [revisionState, setRevisionState] = useState<RevisionState>("proposed");
  const [revisedReady, setRevisedReady] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // `localStorage` is read after mount so the server and first client render
  // agree (Next 16 hydration).
  useEffect(() => {
    // The first render has to match the server's (storage-free) output, so the
    // restore can only happen after mount — the documented exception to the
    // "no setState in an effect" rule.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(loadSession());
  }, []);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // "copied N min ago" is client state only (D41); one slow ticker keeps it true.
  useEffect(() => {
    const tick = () => setNow(nowMs());
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!busy) return;
    const tick = () => setElapsed(formatElapsed(nowMs() - startedAt));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [busy, startedAt]);

  function persist(next: SessionState) {
    setState(next);
    saveSession(next);
  }

  /** Applies a `workspace.ts` session update and saves it. */
  function writeSession(update: (current: SessionState) => SessionState) {
    setState((current) => {
      if (current === null) return current;
      const next = update(current);
      saveSession(next);
      return next;
    });
  }

  function writeProfile(mutate: (profile: Profile) => Profile) {
    setState((current) => {
      if (current === null) return current;
      const { profile } = parseProfile(current.profileMd);
      const next = { ...current, profileMd: serializeProfile(mutate(profile)) };
      saveSession(next);
      return next;
    });
  }

  /**
   * Sends one turn. `base` is the session state the request is built from,
   * so a caller that just wrote to the profile locally (the feedback screen)
   * sends the write it made rather than the state in this closure. Resolves
   * true when the turn landed without an error.
   */
  async function runTurn(step: StepName, input: TurnInput, base?: SessionState): Promise<boolean> {
    const source = base ?? state;
    if (source === null || busy) return false;
    const snapshot = takeSnapshot(source.profileMd, nowMs());
    setSnapshot(snapshot);
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setErrorText(undefined);
    setLog([]);
    setStartedAt(snapshot.startedAt);

    const request = buildTurnRequest(source, step, input);
    const result = await sendTurn(request, { signal: controller.signal });
    if (!result.ok) {
      setBusy(false);
      abortRef.current = null;
      if (result.kind === "unauthorized") {
        router.push("/enter");
        return false;
      }
      setErrorText(result.message);
      return false;
    }

    let failed: string | undefined;
    try {
      for await (const event of result.events) {
        if (event.type === "delta") {
          setLog((lines) => appendLogLines(lines, event.text, nowMs() - snapshot.startedAt));
        } else if (event.type === "error") {
          failed = event.message;
        } else if (event.type === "final") {
          const response = event.response;
          if (response.profileMd !== undefined) {
            // The board order is resolved on arrival, never live (D39).
            setOrder(boardOrder(parseProfile(response.profileMd).profile));
          }
          setState((current) => {
            if (current === null) return current;
            const next = applyTurnResponse(current, response);
            saveSession(next);
            return next;
          });
          const values = response.pills?.map((pill: AnswerPill) => pill.value) ?? [];
          if (values.length > 0) setSectorGroups(values);
        }
      }
    } catch {
      failed = "The connection dropped before the answer was complete.";
    }
    setErrorText(failed);
    setBusy(false);
    abortRef.current = null;
    return failed === undefined;
  }

  const profileMd = state?.profileMd ?? "";
  const parsed = parseProfile(profileMd);
  const profile = parsed.profile;
  const screenInput = {
    hasCards: profile.cards.length > 0,
    hasFields: profile.fields.length > 0,
    hasQueries: hasLiveQueries(profile),
    busy,
    view,
  };
  const screen = currentScreen(screenInput);
  // The post-turn assistant message is stored but never shown: there is no
  // rail to show it in, and the screens say what happened (technical-plan.md D49).

  function onStart(text: string) {
    void runTurn(nextStep(profile, { source: "paste" }), { kind: "message", content: text });
  }

  // Discovery never auto-starts: the person presses "Find climate roles" (D38).
  function onFindRoles() {
    void runTurn("discover", { kind: "message", content: FIND_ROLES_PILL.value });
  }

  function goToBoard() {
    setOrder(boardOrder(profile));
    setView("board");
  }

  function onNavigate(step: NavStep) {
    if (busy) return;
    if (step === "searches") setView("searches");
    else goToBoard();
  }

  // One turn writes a search for every selected role, whichever card's button is pressed (technical-plan.md D47).
  async function writeSearches() {
    const ok = await runTurn("queries", buildSelectedRolesTurnInput());
    if (ok) setView("searches");
  }

  const judgedQuery =
    judged === null ? undefined : profile.queries.find((query) => query.id === judged.queryId);
  const beforeProfile = snapshot === null ? undefined : parseProfile(snapshot.profileMd).profile;
  const revised =
    judged !== null && revisedReady && beforeProfile !== undefined
      ? revisedQueryFor(beforeProfile, profile, judged.queryId)
      : undefined;

  async function sendFeedback(verdict: Verdict, reason: string) {
    if (state === null || judged === null) return;
    const feedback: QueryFeedback = {
      queryId: judged.queryId,
      verdict: verdictToServer(verdict),
      reason,
    };
    // The verdict is recorded locally first, so it survives a failed turn.
    const applied = applyQueryFeedback(state, feedback);
    persist(applied);
    setSentFeedback(feedback);
    setRevisionState("proposed");
    const ok = await runTurn("revise", { kind: "feedback", feedback }, applied);
    setRevisedReady(ok);
  }

  /** "Keep the old one" is a whole-turn undo; the verdict stays recorded (D41). */
  function keepOldQuery() {
    if (snapshot === null) return;
    setState((current) => {
      if (current === null) return current;
      const restored = { ...current, profileMd: restoreSnapshot(snapshot) };
      const next = sentFeedback === null ? restored : applyQueryFeedback(restored, sentFeedback);
      saveSession(next);
      return next;
    });
    setRevisedReady(false);
    setRevisionState("proposed");
  }

  /** "Start over" in the header, after its confirm: clears this browser's copy. */
  function onStartOver() {
    abortRef.current?.abort();
    abortRef.current = null;
    clearSession();
    setBusy(false);
    setDrawerOpen(false);
    setSectorGroups([]);
    setErrorText(undefined);
    setLog([]);
    setView("board");
    setOrder([]);
    setExpandedId(undefined);
    setCopiedAt({});
    setJudged(null);
    setSentFeedback(null);
    setSnapshot(null);
    setRevisedReady(false);
    setRevisionState("proposed");
    persist(startOver());
  }

  return (
    <main className="cc-page">
      <div className="cc-shell">
        <Header
          input={screenInput}
          current={navStepFor(screen)}
          showNav={showNav(screen)}
          profileOpen={drawerOpen}
          onNavigate={onNavigate}
          onToggleProfile={() => setDrawerOpen((open) => !open)}
          onStartOver={onStartOver}
        />
        {drawerOpen && state !== null ? (
          <ProfileDrawer
            state={state}
            profileMd={profileMd}
            onImport={persist}
            onClose={() => setDrawerOpen(false)}
          />
        ) : null}
        <div className="cc-body">
          <div className="cc-main">
            {errorText !== undefined || parsed.warnings.length > 0 ? (
              <div className="cc-banner" role="alert">
                {errorText !== undefined ? <p>{errorText}</p> : null}
                {parsed.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}
            {screen === "firstRun" ? (
              <FirstRun busy={busy} onStart={onStart} onOpenProfile={() => setDrawerOpen(true)} />
            ) : null}
            {screen === "highlights" ? (
              <Highlights
                profile={profile}
                sectorGroups={sectorGroups}
                onExclude={(cardId, excluded) =>
                  writeProfile((p) => setCardExcluded(p, cardId, excluded))
                }
                onEditCard={(card: Card) => writeProfile((p) => upsertCard(p, card))}
                onConfirmSkill={(skill) => writeSession((s) => confirmProfileSkill(s, skill))}
                onRemoveSkill={(skill) => writeSession((s) => rejectProfileSkill(s, skill))}
                onAnswer={(key, pill) => writeProfile((p) => applyPillAnswer(p, key, pill))}
                onFindRoles={onFindRoles}
              />
            ) : null}
            {screen === "pending" ? <Pending elapsed={elapsed} log={log} /> : null}
            {screen === "board" ? (
              <FieldBoard
                profile={profile}
                order={order}
                expandedId={expandedId}
                onExpand={setExpandedId}
                onMark={(fieldId: string, status: FieldStatus) =>
                  writeProfile((p) => setFieldStatus(p, fieldId, status))
                }
                onRole={(roleId, selected) =>
                  writeProfile((p) => setRoleSelected(p, roleId, selected))
                }
                // The per-field ask has no home without the rail; the next step
                // puts it on the Roles screen (technical-plan.md D49).
                onAsk={() => undefined}
                askStateFor={() => "idle"}
                canWriteSearches={() => canWriteQueries(profile)}
                onWriteSearches={() => void writeSearches()}
                onMatchFields={onFindRoles}
              />
            ) : null}
            {screen === "searches" ? (
              <Searches
                profile={profile}
                copiedAt={copiedAt}
                now={now}
                onCopy={(queryId) =>
                  setCopiedAt((current) => ({ ...current, [queryId]: nowMs() }))
                }
                onFeedback={(queryId, verdict) => {
                  setJudged({ queryId, verdict: verdict === "good" ? "good" : "wrong" });
                  setSentFeedback(null);
                  setRevisedReady(false);
                  setRevisionState("proposed");
                  setView("feedback");
                }}
                canWriteSearches={() => canWriteQueries(profile)}
                onWriteSearches={() => void writeSearches()}
                onBackToFields={goToBoard}
              />
            ) : null}
            {screen === "feedback" && judged !== null && judgedQuery !== undefined ? (
              <FeedbackScreen
                query={judgedQuery}
                initialVerdict={judged.verdict}
                copiedMinutes={
                  copiedAt[judged.queryId] === undefined
                    ? undefined
                    : Math.max(0, Math.floor((now - copiedAt[judged.queryId]) / 60000))
                }
                revised={revised}
                revisionState={revisionState}
                onSend={(verdict, reason) => void sendFeedback(verdict, reason)}
                onEditRevised={(text) => {
                  if (revised === undefined) return;
                  writeProfile((p) => setQueryText(p, revised.query.id, text));
                  setRevisionState("edited");
                }}
                onAccept={() => setRevisionState("accepted")}
                onKeepOld={keepOldQuery}
                onBack={() => setView("searches")}
              />
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
