"use client";

/**
 * The exploration-first shell (technical-plan.md D37, D38, D42). It owns the
 * browser session (`localStorage` through `session.ts` — nothing is stored
 * server-side), the single in-flight turn and its abort controller, and the
 * screen state, which is derived in `screens.ts` rather than tracked here.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { AnswerPill, SessionState, StepName } from "@/lib/session";
import { clearSession, buildTurnRequest, loadSession, saveSession, startOver } from "@/lib/session";
import { applyPillAnswer } from "@/lib/elicit";
import type { Card, PreferenceKey, Profile } from "@/lib/profile";
import {
  addOtherPreference,
  parseProfile,
  serializeProfile,
  setCardExcluded,
  upsertCard,
} from "@/lib/profile";
import type { LogLine } from "@/lib/screens";
import {
  appendLogLines,
  currentScreen,
  formatElapsed,
  navStepFor,
  showNav,
  showRail,
  takeSnapshot,
} from "@/lib/screens";
import { sendTurn } from "@/lib/turn-stream";
import { applyTurnResponse, nextStep } from "@/lib/workspace";

import FieldBoard from "./FieldBoard";
import FirstRun from "./FirstRun";
import Header from "./Header";
import Highlights from "./Highlights";
import Pending from "./Pending";
import ProfileDrawer from "./ProfileDrawer";
import Rail from "./Rail";

export default function AppShell() {
  const router = useRouter();
  const [state, setState] = useState<SessionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState("0:00");
  const [errorText, setErrorText] = useState<string | undefined>(undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [questionOverride, setQuestionOverride] = useState<PreferenceKey | undefined>(undefined);
  const [sectorGroups, setSectorGroups] = useState<string[]>([]);
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

  useEffect(() => {
    if (!busy) return;
    const tick = () => setElapsed(formatElapsed(Date.now() - startedAt));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [busy, startedAt]);

  function persist(next: SessionState) {
    setState(next);
    saveSession(next);
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

  async function runTurn(step: StepName, content: string) {
    if (state === null || busy) return;
    const snapshot = takeSnapshot(state.profileMd, Date.now());
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setErrorText(undefined);
    setLog([]);
    setStartedAt(snapshot.startedAt);

    const request = buildTurnRequest(state, step, { kind: "message", content });
    const result = await sendTurn(request, { signal: controller.signal });
    if (!result.ok) {
      setBusy(false);
      abortRef.current = null;
      if (result.kind === "unauthorized") {
        router.push("/enter");
        return;
      }
      setErrorText(result.message);
      return;
    }

    let failed: string | undefined;
    try {
      for await (const event of result.events) {
        if (event.type === "delta") {
          setLog((lines) => appendLogLines(lines, event.text, Date.now() - snapshot.startedAt));
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
  }

  const profileMd = state?.profileMd ?? "";
  const parsed = parseProfile(profileMd);
  const profile = parsed.profile;
  const screenInput = {
    hasCards: profile.cards.length > 0,
    hasFields: profile.fields.length > 0,
    busy,
  };
  const screen = currentScreen(screenInput);
  const lastAssistant = [...(state?.messages ?? [])].reverse().find((m) => m.role === "assistant");

  function onStart(text: string) {
    void runTurn(nextStep(profile, { source: "paste" }), text);
  }

  function onDelete() {
    clearSession();
    setDrawerOpen(false);
    setSectorGroups([]);
    setQuestionOverride(undefined);
    setErrorText(undefined);
    setLog([]);
    persist(startOver());
  }

  return (
    <main className="cc-page">
      <div className="cc-shell">
        <Header
          screen={screen}
          input={screenInput}
          current={navStepFor(screen)}
          showNav={showNav(screen)}
        />
        {drawerOpen && state !== null ? (
          <ProfileDrawer
            state={state}
            profileMd={profileMd}
            onImport={persist}
            onDelete={onDelete}
            onClose={() => setDrawerOpen(false)}
          />
        ) : null}
        <div className="cc-body" data-rail={showRail(screen) ? "open" : "closed"}>
          <div className="cc-main">
            {screen === "firstRun" ? (
              <FirstRun busy={busy} onStart={onStart} onOpenProfile={() => setDrawerOpen(true)} />
            ) : null}
            {screen === "highlights" ? (
              <Highlights
                profile={profile}
                onExclude={(cardId, excluded) =>
                  writeProfile((p) => setCardExcluded(p, cardId, excluded))
                }
                onEditCard={(card: Card) => writeProfile((p) => upsertCard(p, card))}
                onMatchFields={() => void runTurn("discover", "go")}
              />
            ) : null}
            {screen === "pending" ? <Pending elapsed={elapsed} log={log} /> : null}
            {screen === "board" ? (
              <FieldBoard profile={profile} onMatchFields={() => void runTurn("discover", "go")} />
            ) : null}
          </div>
          {showRail(screen) ? (
            <Rail
              profile={profile}
              busy={busy}
              elapsed={elapsed}
              log={log}
              warnings={parsed.warnings}
              errorText={errorText}
              assistantMessage={lastAssistant?.content}
              sectorGroups={sectorGroups}
              questionOverride={questionOverride}
              onPill={(key, pill) => {
                writeProfile((p) => applyPillAnswer(p, key, pill));
                setQuestionOverride(undefined);
              }}
              onChangeAnswer={setQuestionOverride}
              // D43: a per-field ask is a local profile write, never a model call.
              onAsk={(key, answer) => {
                writeProfile((p) => addOtherPreference(p, key, answer, "stated"));
                setDrawerOpen(true);
              }}
              onOpenProfile={() => setDrawerOpen((open) => !open)}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}
