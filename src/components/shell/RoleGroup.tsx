"use client";

/**
 * One field on the Roles screen (technical-plan.md D50): the field is a
 * heading with no marking, and its roles are the rows the person ticks. The
 * field's optional ask sits inline under its uncertainty; the answer is saved
 * to the profile and does not re-rank anything (technical-plan.md D43).
 */

import { useState } from "react";

import type { RoleGroupView } from "@/lib/screens";
import { INFO_TIPS, sourceLabel } from "@/lib/screens";

import InfoTip from "./InfoTip";

export interface RoleGroupProps {
  group: RoleGroupView;
  onRole: (roleId: string, selected: boolean) => void;
  /** Saves the answer under the ask's preference key (`addOtherPreference`). */
  onAnswerAsk: (key: string, answer: string) => void;
}

export default function RoleGroup({ group, onRole, onAnswerAsk }: RoleGroupProps) {
  const { field, ask, askAnswer } = group;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const headingId = `role-group-${field.id}`;
  const showForm = ask !== undefined && (askAnswer === undefined || editing);

  return (
    <section className="cc-role-group" aria-labelledby={headingId}>
      <header className="cc-role-group-head">
        <h3 id={headingId} className="cc-role-group-name">
          {field.name}
        </h3>
        <div className="cc-role-group-meta">
          {field.sector ? <span>{field.sector}</span> : null}
          {group.fitLabel ? <span className="cc-fit-label">{group.fitLabel}</span> : null}
          {group.moveLabel ? <span>{group.moveLabel}</span> : null}
        </div>
        {group.summary ? <p className="cc-role-group-summary">{group.summary}</p> : null}
        {group.drawsOn.length > 0 ? (
          <p className="cc-note">Draws on: {group.drawsOn.join(", ")}</p>
        ) : null}
        {group.uncertain ? (
          <p className="cc-role-uncertain">
            <strong>Not sure yet:</strong> {group.uncertain}
          </p>
        ) : null}

        {ask !== undefined ? (
          <div className="cc-role-ask">
            <div className="cc-with-tip">
              <span className="cc-role-ask-question">{ask.question}</span>
              <InfoTip text={INFO_TIPS.fieldAsk} label="What this answer changes" />
            </div>
            {showForm ? (
              <div className="cc-role-ask-form">
                <textarea
                  className="cc-field-input"
                  rows={2}
                  placeholder={ask.placeholder}
                  aria-label={ask.question}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <div className="cc-cta-row">
                  <button
                    type="button"
                    className="cc-btn-outline"
                    disabled={draft.trim() === ""}
                    onClick={() => {
                      onAnswerAsk(ask.key, draft.trim());
                      setDraft("");
                      setEditing(false);
                    }}
                  >
                    Save answer
                  </button>
                  {editing ? (
                    <button
                      type="button"
                      className="cc-linkish"
                      onClick={() => {
                        setDraft("");
                        setEditing(false);
                      }}
                    >
                      Cancel
                    </button>
                  ) : (
                    <span className="cc-note">Optional.</span>
                  )}
                </div>
              </div>
            ) : (
              <p className="cc-note">
                Your answer: {askAnswer}{" "}
                <button
                  type="button"
                  className="cc-linkish"
                  onClick={() => {
                    setDraft(askAnswer ?? "");
                    setEditing(true);
                  }}
                >
                  Change
                </button>
              </p>
            )}
          </div>
        ) : null}
      </header>

      {group.roles.length === 0 ? (
        <p className="cc-note">No roles under this field yet.</p>
      ) : (
        <ul className="cc-role-list">
          {group.roles.map(({ role, why, companies }) => (
            <li key={role.id} className="cc-role-row" data-selected={role.selected}>
              <label className="cc-role-label">
                <input
                  type="checkbox"
                  className="cc-role-check"
                  checked={role.selected}
                  onChange={(event) => onRole(role.id, event.target.checked)}
                />
                <span className="cc-role-title">{role.title}</span>
              </label>
              <div className="cc-role-detail">
                {why ? <p className="cc-role-why">{why}</p> : null}
                {companies ? <p className="cc-note">{companies}</p> : null}
                {role.sources.length > 0 ? (
                  <p className="cc-role-sources">
                    {role.sources.map((source) => (
                      <a key={source} href={source} target="_blank" rel="noopener noreferrer">
                        {sourceLabel(source)}
                      </a>
                    ))}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
