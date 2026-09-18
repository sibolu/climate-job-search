"use client";

/**
 * The left two thirds of the workspace: the conversation, the pills the
 * assistant offered with a message, and a free-text box that is always
 * available (PLAN.md Phase 2.1). It holds no rules — every decision lives in
 * `workspace.ts` — and it never touches storage.
 */

import { useEffect, useRef, useState } from "react";

import type { AnswerPill, ChatMessage } from "@/lib/session";

export interface ChatPaneProps {
  messages: ChatMessage[];
  /** The accumulated progress lines of the in-flight turn, or `null` between turns. */
  progress: string | null;
  /** A failed turn, shown as an error bubble and cleared on the next send. */
  error: string | null;
  busy: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onPill: (pill: AnswerPill) => void;
}

/**
 * What clicking an answer pill turns into: the `value` goes on the wire
 * because the server matches on it byte for byte (`GO_PILL` in `turn.ts`, and
 * the elicitation answer lookup `pillsFor(...).find(p => p.value === answer)`),
 * while the chat bubble shows the `label` the user actually clicked. Sending
 * the label, or showing the value, breaks one side or the other: a pill
 * reading "Find climate fields for me" must not leave a "You" bubble saying
 * "go".
 */
export function pillTurn(pill: AnswerPill): { content: string; display: string } {
  return { content: pill.value, display: pill.label };
}

/**
 * How long a turn has to go quiet — no new progress line — before the bubble
 * stops repeating itself and reassures instead. Discovery runs two to three
 * minutes with long silent stretches, so the wire's empty heartbeat deltas
 * (PLAN.md §7.31) leave the text unchanged for minutes at a time.
 */
export const WORKING_REASSURE_MS = 45_000;

/** How often the in-flight bubble re-checks how long it has been quiet. */
export const WORKING_TICK_MS = 5_000;

export interface WorkingMessage {
  /** The line shown beside the animated dots. */
  text: string;
  /** A quieter second line, or `null` while the turn is still fresh. */
  note: string | null;
  /** Whether `text` came from the server or is our generic stand-in. */
  source: "progress" | "fallback";
}

/**
 * The last non-empty line of the accumulated progress stream. Progress arrives
 * as whole newline-terminated lines and heartbeats arrive as empty deltas, so
 * the newest non-empty line is the newest thing the server actually said.
 */
export function latestProgressLine(streamed: string): string {
  const lines = streamed.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (line !== "") return line;
  }
  return "";
}

/**
 * What the in-flight bubble should say, given the newest progress line the
 * server sent (`""` when it has sent none) and how long it has been since that
 * line arrived. Pure so the timing is unit-testable: never invents a step the
 * server did not report, it only falls back to a generic line.
 */
export function workingMessage(progress: string, quietMs: number): WorkingMessage {
  const latest = latestProgressLine(progress);
  const quiet = quietMs >= WORKING_REASSURE_MS;
  if (latest === "") {
    return {
      text: "Working on it",
      note: quiet ? "This step can take a couple of minutes." : null,
      source: "fallback",
    };
  }
  return {
    // The server ends its progress lines with an ellipsis; the animated dots
    // are that ellipsis here, so drop the written one rather than doubling it.
    text: latest.replace(/(?:\.{3}|…)$/u, "").trimEnd(),
    note: quiet ? "Still going — this step can take a couple of minutes." : null,
    source: "progress",
  };
}

/**
 * The in-flight bubble's body. Keyed by the latest progress line in the render
 * below, so a new line remounts this and restarts the quiet clock; the
 * interval is cleared when the turn settles and the bubble unmounts. The dots
 * animate in CSS, so a quiet turn costs one render per tick, not per frame.
 */
function WorkingIndicator({ progress }: { progress: string }) {
  const [quietMs, setQuietMs] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(() => setQuietMs(Date.now() - startedAt), WORKING_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const { text, note } = workingMessage(progress, quietMs);

  return (
    <>
      <p className="working">
        <span>{text}</span>
        <span className="working-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </p>
      {note === null ? null : <p className="working-note">{note}</p>}
    </>
  );
}

export default function ChatPane({
  messages,
  progress,
  error,
  busy,
  draft,
  onDraftChange,
  onSend,
  onPill,
}: ChatPaneProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  /**
   * The one way this pane sends. Enter and the submit button both go through
   * it, so neither can hand `Workspace` a send it will refuse — a refused send
   * still clears the draft, which loses what the user typed.
   */
  const submit = () => {
    if (busy || draft.trim() === "") return;
    onSend();
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, progress, error]);

  return (
    <section className="chat" aria-label="Conversation">
      <div className="chat-log">
        {messages.length === 0 && progress === null ? (
          <p className="chat-empty">
            Paste your resume text into the Profile tab to start, or just say what you are looking for.
          </p>
        ) : null}

        {messages.map((message, i) => (
          <div key={`${message.createdAt}-${i}`} className={`bubble bubble-${message.role}`}>
            <div className="bubble-role">{message.role === "user" ? "You" : "Assistant"}</div>
            <div className="bubble-text">{message.content}</div>
            {message.pills && message.pills.length > 0 ? (
              <div className="pills">
                {message.pills.map((pill, j) => (
                  <button
                    key={`${pill.value}-${j}`}
                    type="button"
                    className="pill"
                    disabled={busy}
                    onClick={() => onPill(pill)}
                  >
                    {pill.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}

        {progress !== null ? (
          <div className="bubble bubble-assistant">
            <div className="bubble-role">Assistant</div>
            <div className="bubble-text" aria-live="polite">
              <WorkingIndicator key={latestProgressLine(progress)} progress={progress} />
            </div>
          </div>
        ) : null}

        {error !== null ? (
          <div className="bubble bubble-error" role="alert">
            <div className="bubble-role">Something went wrong</div>
            <div className="bubble-text">{error}</div>
          </div>
        ) : null}

        <div ref={endRef} />
      </div>

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="sr-only" htmlFor="chat-input">
          Message
        </label>
        <textarea
          id="chat-input"
          value={draft}
          rows={3}
          placeholder="Type a message. Enter sends, Shift+Enter makes a new line."
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button type="submit" disabled={busy || draft.trim() === ""}>
          {busy ? "Working..." : "Send"}
        </button>
      </form>
    </section>
  );
}
