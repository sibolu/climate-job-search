"use client";

import { useState } from "react";

import type { AnswerPill } from "@/lib/session";
import type { PreferenceKey, Profile } from "@/lib/profile";
import type { LogLine } from "@/lib/screens";
import { activeQuestion, answerRows } from "@/lib/screens";

export interface RailAsk {
  fieldId: string;
  fieldName: string;
  question: string;
  /** The `other preferences` key the answer is written under (D43). */
  profileKey: string;
  placeholder?: string;
}

export interface RailProps {
  profile: Profile;
  busy: boolean;
  elapsed: string;
  log: readonly LogLine[];
  warnings: readonly string[];
  errorText?: string;
  assistantMessage?: string;
  /** Sector groups carried by the cards turn's pills, when it sent any. */
  sectorGroups: readonly string[];
  questionOverride?: PreferenceKey;
  /** A live per-field ask, mounted from the expanded field card in step 2b.5. */
  ask?: RailAsk;
  onPill: (key: PreferenceKey, pill: AnswerPill) => void;
  onChangeAnswer: (key: PreferenceKey | undefined) => void;
  onAsk: (profileKey: string, answer: string) => void;
  onOpenProfile: () => void;
}

/**
 * The assistant rail (technical-plan.md D42): preference questions, per-field asks, the
 * working log, errors and parser warnings, and "Change an answer". No
 * free-text composer in the beta.
 */
export default function Rail({
  profile,
  busy,
  elapsed,
  log,
  warnings,
  errorText,
  assistantMessage,
  sectorGroups,
  questionOverride,
  ask,
  onPill,
  onChangeAnswer,
  onAsk,
  onOpenProfile,
}: RailProps) {
  const [changing, setChanging] = useState(false);
  const [draft, setDraft] = useState("");
  const question = activeQuestion(profile, { sectorGroups, override: questionOverride });

  return (
    <aside className="cc-rail" aria-label="Assistant">
      <div className="cc-rail-inner">
        <div className="cc-rail-head">Assistant</div>
        <button type="button" className="cc-profile-row" onClick={onOpenProfile}>
          <span className="cc-square" aria-hidden="true" />
          <span>
            <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>Your Profile</span>
            <span className="cc-note">Everything known about you, kept on this device.</span>
          </span>
          <span style={{ marginLeft: "auto", color: "var(--green)", fontWeight: 600, fontSize: 12.5 }}>
            Examine
          </span>
        </button>

        <div className="cc-rail-scroll">
          {errorText ? (
            <div className="cc-bubble cc-bubble-warn">
              <div className="cc-speaker">Problem</div>
              {errorText}
            </div>
          ) : null}

          {warnings.map((warning) => (
            <div key={warning} className="cc-bubble cc-bubble-warn">
              <div className="cc-speaker">Note</div>
              {warning}
            </div>
          ))}

          {busy ? (
            <div className="cc-log">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="cc-spinner" aria-hidden="true" />
                <span style={{ fontSize: 13, fontWeight: 600 }}>Working · {elapsed}</span>
              </div>
              {log.map((line, index) => (
                <div className="cc-log-line" key={`${line.time}-${index}`}>
                  <span className="cc-log-time">{line.time}</span>
                  <span>{line.text}</span>
                </div>
              ))}
              <p className="cc-note" style={{ marginTop: 10 }}>
                Hold tight. Marking resumes when it lands.
              </p>
            </div>
          ) : null}

          {!busy && assistantMessage ? (
            <div className="cc-bubble cc-bubble-assistant">
              <div className="cc-speaker">Assistant</div>
              {assistantMessage}
            </div>
          ) : null}

          {ask ? (
            <div className="cc-ask">
              <div className="cc-mono-label" style={{ color: "var(--amber-text)" }}>
                More on this field
              </div>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{ask.fieldName}</div>
              <p style={{ fontSize: 13.5 }}>{ask.question}</p>
              <p className="cc-note">Optional — it sharpens the ranking.</p>
              <textarea
                className="cc-field-input"
                rows={3}
                placeholder={ask.placeholder ?? ""}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  className="cc-btn"
                  style={{ fontSize: 12.5, padding: "7px 11px" }}
                  disabled={draft.trim() === ""}
                  onClick={() => {
                    onAsk(ask.profileKey, draft.trim());
                    setDraft("");
                  }}
                >
                  Add to profile
                </button>
                <button type="button" className="cc-btn-outline" onClick={() => setDraft("")}>
                  Not now
                </button>
              </div>
            </div>
          ) : null}

          {!busy && question ? (
            <div className="cc-bubble cc-bubble-assistant">
              <div className="cc-speaker">Assistant</div>
              {question.question}
              <div className="cc-chips" style={{ marginTop: 10 }}>
                {question.pills.map((pill) => (
                  <button
                    key={pill.value}
                    type="button"
                    className="cc-pill"
                    onClick={() => {
                      onPill(question.key, pill);
                      setChanging(false);
                    }}
                  >
                    {pill.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {!busy && !question ? (
            <div style={{ marginTop: 4 }}>
              <button
                type="button"
                className="cc-btn-outline"
                onClick={() => setChanging((open) => !open)}
              >
                Change an answer
              </button>
              {changing ? (
                <div style={{ marginTop: 8 }}>
                  {answerRows(profile).map((row) => (
                    <button
                      key={row.key}
                      type="button"
                      className="cc-btn-outline"
                      style={{ display: "block", width: "100%", textAlign: "left", marginTop: 6 }}
                      onClick={() => onChangeAnswer(row.key)}
                    >
                      <span style={{ fontWeight: 600 }}>{row.label}</span>
                      {row.value === "" ? "" : ` — ${row.value}`}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
