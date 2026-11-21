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

import type { SessionState, StepName, TurnInput } from "@/lib/session";
import { clearSession, buildTurnRequest, loadSession, saveSession, startOver } from "@/lib/session";
import { toggleClimateInterest } from "@/lib/elicit";
import type { Card, Profile } from "@/lib/profile";
import {
  parseProfile,
  serializeProfile,
  setCardExcluded,
  setRoleSelected,
  upsertCard,
} from "@/lib/profile";
import type { LogLine, NavStep, View } from "@/lib/screens";
import {
  FIND_ROLES_PILL,
  appendLogLines,
  composeStartText,
  currentScreen,
  formatElapsed,
  hasLiveQueries,
  navStepFor,
  resumeView,
} from "@/lib/screens";
import { sendTurn } from "@/lib/turn-stream";
import {
  applyTurnResponse,
  buildSelectedRolesTurnInput,
  nextStep,
  recordStartInputs,
  rejectProfileSkill,
  restoreProfileSkill,
} from "@/lib/workspace";

import Header from "./Header";
import Highlights from "./Highlights";
import Pending from "./Pending";
import ProfileDrawer from "./ProfileDrawer";
import ResumeScreen from "./ResumeScreen";
import RoleBoard from "./RoleBoard";
import { saveSessionExport } from "./save-file";
import Searches from "./Searches";

/**
 * Wall clock, read through a module-level helper: the turn runner is not a
 * render-phase function, but the purity lint cannot tell, and the timestamp
 * only ever labels the elapsed counter or a copy.
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
  const [view, setView] = useState<View | undefined>(undefined);
  const [copiedAt, setCopiedAt] = useState<Record<string, number>>({});
  const [now, setNow] = useState(0);
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
   * Sends one turn. Resolves true when the turn landed without an error.
   * `from` is a session written just before the turn (the Start inputs,
   * technical-plan.md D56): it is saved and sent instead of the React state,
   * which has not caught up yet, so the response does not wipe it.
   */
  async function runTurn(step: StepName, input: TurnInput, from?: SessionState): Promise<boolean> {
    const base = from ?? state;
    if (base === null || busy) return false;
    if (from !== undefined && from !== state) persist(from);
    const turnStartedAt = nowMs();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setErrorText(undefined);
    setLog([]);
    setStartedAt(turnStartedAt);

    const request = buildTurnRequest(base, step, input);
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
          setLog((lines) => appendLogLines(lines, event.text, nowMs() - turnStartedAt));
        } else if (event.type === "error") {
          failed = event.message;
        } else if (event.type === "final") {
          const response = event.response;
          setState((current) => {
            if (current === null) return current;
            const next = applyTurnResponse(current, response);
            saveSession(next);
            return next;
          });
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

  // What was typed is kept in the profile before the turn goes out, so a
  // failed read keeps it (technical-plan.md D56); the cards step still reads
  // the message.
  async function onStart(resume: string, notes: string) {
    if (state === null || busy) return;
    const recorded = recordStartInputs(state, resume, notes);
    const step = nextStep(profile, { source: "paste" });
    const content = composeStartText(resume, notes);
    const ok = await runTurn(step, { kind: "message", content }, recorded);
    if (ok) setView("highlights");
  }

  // Discovery never auto-starts: the person presses "Find climate roles" (D38).
  async function onFindRoles() {
    const ok = await runTurn("discover", { kind: "message", content: FIND_ROLES_PILL.value });
    if (ok) setView("roles");
  }

  function onNavigate(step: NavStep) {
    if (busy) return;
    setView(step);
  }

  // One turn writes a search for every ticked role and replaces a role's
  // untried one (technical-plan.md D47).
  async function writeSearches() {
    const ok = await runTurn("queries", buildSelectedRolesTurnInput());
    if (ok) setView("searches");
  }

  /**
   * "Start over", after the Resume page's dialog (technical-plan.md D55):
   * clears this browser's copy.
   */
  function onStartOver() {
    abortRef.current?.abort();
    abortRef.current = null;
    clearSession();
    setBusy(false);
    setDrawerOpen(false);
    setErrorText(undefined);
    setLog([]);
    setView("resume");
    setCopiedAt({});
    persist(startOver());
  }

  return (
    <main className="cc-page">
      <div className="cc-shell">
        <Header
          input={screenInput}
          current={navStepFor(screen)}
          profileOpen={drawerOpen}
          onNavigate={onNavigate}
          onToggleProfile={() => setDrawerOpen((open) => !open)}
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
            {screen === "resume" ? (
              <ResumeScreen
                // Remount once the stored session loads, so the boxes start from it.
                key={state === null ? "loading" : "loaded"}
                view={resumeView(profile)}
                busy={busy}
                onStart={(resume, notes) => void onStart(resume, notes)}
                onOpenProfile={() => setDrawerOpen(true)}
                onDownloadProfile={() => {
                  if (state !== null) saveSessionExport(state);
                }}
                onStartOver={onStartOver}
              />
            ) : null}
            {screen === "highlights" ? (
              <Highlights
                profile={profile}
                onExclude={(cardId, excluded) =>
                  writeProfile((p) => setCardExcluded(p, cardId, excluded))
                }
                onEditCard={(card: Card) => writeProfile((p) => upsertCard(p, card))}
                onRemoveSkill={(skill) => writeSession((s) => rejectProfileSkill(s, skill))}
                onRestoreSkill={(skill) => writeSession((s) => restoreProfileSkill(s, skill))}
                onToggleInterest={(area) => writeProfile((p) => toggleClimateInterest(p, area))}
                onFindRoles={() => void onFindRoles()}
              />
            ) : null}
            {screen === "pending" ? <Pending elapsed={elapsed} log={log} /> : null}
            {screen === "roles" ? (
              <RoleBoard
                profile={profile}
                onRole={(roleId, selected) =>
                  writeProfile((p) => setRoleSelected(p, roleId, selected))
                }
                onWriteSearches={() => void writeSearches()}
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
                onWriteSearches={() => void writeSearches()}
                onChangeRoles={() => setView("roles")}
              />
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
