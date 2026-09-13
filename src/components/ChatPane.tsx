"use client";

/**
 * The left two thirds of the workspace: the conversation, the pills the
 * assistant offered with a message, and a free-text box that is always
 * available (PLAN.md Phase 2.1). It holds no rules — every decision lives in
 * `workspace.ts` — and it never touches storage.
 */

import { useEffect, useRef } from "react";

import type { AnswerPill, ChatMessage } from "@/lib/session";

export interface ChatPaneProps {
  messages: ChatMessage[];
  /** Assistant text streaming in right now, or `null` between turns. */
  streaming: string | null;
  /** A failed turn, shown as an error bubble and cleared on the next send. */
  error: string | null;
  busy: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onPill: (pill: AnswerPill) => void;
}

export default function ChatPane({
  messages,
  streaming,
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
  }, [messages.length, streaming, error]);

  return (
    <section className="chat" aria-label="Conversation">
      <div className="chat-log">
        {messages.length === 0 && streaming === null ? (
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

        {streaming !== null ? (
          <div className="bubble bubble-assistant">
            <div className="bubble-role">Assistant</div>
            <div className="bubble-text">
              {streaming === "" ? <span className="chat-empty">Thinking...</span> : streaming}
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
