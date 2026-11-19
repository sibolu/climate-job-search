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

import type { AnswerPill, SessionState, StepName, TurnInput } from "@/lib/session";
import { clearSession, buildTurnRequest, loadSession, saveSession, startOver } from "@/lib/session";
import { applyPillAnswer } from "@/lib/elicit";
import type { Card, Profile } from "@/lib/profile";
import {
  addOtherPreference,
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
  currentScreen,
  formatElapsed,
  hasLiveQueries,
  navStepFor,
  showNav,
} from "@/lib/screens";
import { sendTurn } from "@/lib/turn-stream";
import {
  applyTurnResponse,
  buildSelectedRolesTurnInput,
  confirmProfileSkill,
  nextStep,
  rejectProfileSkill,
} from "@/lib/workspace";

import FirstRun from "./FirstRun";
import Header from "./Header";
import Highlights from "./Highlights";
import Pending from "./Pending";
import ProfileDrawer from "./ProfileDrawer";
import RoleBoard from "./RoleBoard";
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
  const [sectorGroups, setSectorGroups] = useState<string[]>([]);
  const [view, setView] = useState<View>("roles");
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

  /** Sends one turn. Resolves true when the turn landed without an error. */
  async function runTurn(step: StepName, input: TurnInput): Promise<boolean> {
    if (state === null || busy) return false;
    const turnStartedAt = nowMs();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setErrorText(undefined);
    setLog([]);
    setStartedAt(turnStartedAt);

    const request = buildTurnRequest(state, step, input);
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

  function onNavigate(step: NavStep) {
    if (busy) return;
    setView(step === "searches" ? "searches" : "roles");
  }

  // One turn writes a search for every ticked role and replaces a role's
  // untried one (technical-plan.md D47).
  async function writeSearches() {
    const ok = await runTurn("queries", buildSelectedRolesTurnInput());
    if (ok) setView("searches");
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
    setView("roles");
    setCopiedAt({});
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
            {screen === "roles" ? (
              <RoleBoard
                profile={profile}
                onRole={(roleId, selected) =>
                  writeProfile((p) => setRoleSelected(p, roleId, selected))
                }
                // Saved to the profile only; it does not re-rank (technical-plan.md D43).
                onAnswerAsk={(key, answer) =>
                  writeProfile((p) => addOtherPreference(p, key, answer, "stated"))
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
