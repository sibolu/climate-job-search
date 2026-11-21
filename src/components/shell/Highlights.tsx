"use client";

import { useState } from "react";

import { activeSkills, type Card, type Profile } from "@/lib/profile";
import {
  FIND_ROLES_PILL,
  INTEREST_NOTE,
  QUESTION_LABELS,
  findRolesGate,
  interestPills,
} from "@/lib/screens";

export interface HighlightsProps {
  profile: Profile;
  onExclude: (cardId: string, excluded: boolean) => void;
  onEditCard: (card: Card) => void;
  onRemoveSkill: (skill: string) => void;
  /** Puts a removed skill back, so a mis-click is not final (technical-plan.md D53). */
  onRestoreSkill: (skill: string) => void;
  /** Adds or removes one climate area; written locally, no turn (D54). */
  onToggleInterest: (area: string) => void;
  onFindRoles: () => void;
}

/**
 * The Highlights step, top to bottom: the person's skills, the collapsed
 * highlight cards, the one optional interest question (technical-plan.md
 * D54), and one button. Corrections
 * happen here, through the UI — there is no free-text composer (D42) and no
 * rail (technical-plan.md D49). Discovery starts only when the person presses
 * the button (D38).
 */
export default function Highlights({
  profile,
  onExclude,
  onEditCard,
  onRemoveSkill,
  onRestoreSkill,
  onToggleInterest,
  onFindRoles,
}: HighlightsProps) {
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const gate = findRolesGate(profile);
  const interests = interestPills(profile);
  // Skills are accepted unless removed: no confirm step (technical-plan.md D53).
  const skills = activeSkills(profile);
  const removed = profile.skills.excluded;

  return (
    <section>
      <h2 className="cc-h2">Your highlights</h2>
      <p className="cc-sub">
        Every suggested field and role is tied to at least one highlight. Skills sum up what you
        know across them and shape your searches.
      </p>

      {skills.length + removed.length > 0 ? (
        <div className="cc-block">
          <h3 className="cc-h3">Skills</h3>
          <p className="cc-note">Inferred from your resume.</p>
          <div className="cc-chips" style={{ marginTop: 8 }}>
            {skills.map((skill) => (
              <span key={skill} className="cc-skill">
                <span>{skill}</span>
                <button
                  type="button"
                  className="cc-skill-btn"
                  aria-label={`Remove ${skill}`}
                  title="Remove"
                  onClick={() => onRemoveSkill(skill)}
                >
                  ×
                </button>
              </span>
            ))}
            {removed.map((skill) => (
              <span key={`removed-${skill}`} className="cc-skill cc-skill-removed">
                <s>{skill}</s>
                <button
                  type="button"
                  className="cc-skill-btn"
                  aria-label={`Add ${skill} back`}
                  title="Add back"
                  onClick={() => onRestoreSkill(skill)}
                >
                  +
                </button>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="cc-block">
        <h3 className="cc-h3">Highlights</h3>
        <div className="cc-grid">
          {profile.cards.map((card) =>
            editing === card.id ? (
              <CardEditor
                key={card.id}
                card={card}
                onCancel={() => setEditing(undefined)}
                onSave={(next) => {
                  onEditCard(next);
                  setEditing(undefined);
                }}
              />
            ) : (
              <article key={card.id} className="cc-card" data-excluded={card.excluded}>
                <div className="cc-card-head">
                  <span className="cc-card-title">{card.title}</span>
                </div>
                {card.results ? (
                  <p className="cc-card-result" title={card.results}>
                    {card.results}
                  </p>
                ) : null}
                <div className="cc-chips">
                  {card.skills.map((skill) => (
                    <span key={skill} className="cc-chip">
                      {skill}
                    </span>
                  ))}
                </div>
                <details className="cc-details">
                  <summary>Details</summary>
                  <dl className="cc-dl">
                    <dt>Situation</dt>
                    <dd>{card.situation}</dd>
                    <dt>Action</dt>
                    <dd>{card.actions}</dd>
                    <dt>Result</dt>
                    <dd>{card.results}</dd>
                  </dl>
                </details>
                <div className="cc-card-footer">
                  <button
                    type="button"
                    className="cc-btn-outline"
                    onClick={() => setEditing(card.id)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="cc-btn-outline"
                    aria-pressed={card.excluded}
                    onClick={() => onExclude(card.id, !card.excluded)}
                  >
                    {card.excluded ? "Excluded — include" : "Exclude"}
                  </button>
                </div>
              </article>
            ),
          )}
        </div>
      </div>

      <div className="cc-block">
        <h3 className="cc-h3">{QUESTION_LABELS.climateInterests}</h3>
        <p className="cc-question-text">{INTEREST_NOTE}</p>
        <div className="cc-chips" role="group" aria-label={QUESTION_LABELS.climateInterests}>
          {interests.map((pill) => (
            <button
              key={pill.value}
              type="button"
              className="cc-pill"
              aria-pressed={pill.pressed}
              onClick={() => onToggleInterest(pill.value)}
            >
              {pill.label}
            </button>
          ))}
        </div>
      </div>

      <div className="cc-cta-row" style={{ marginTop: 26 }}>
        <button type="button" className="cc-btn" disabled={!gate.enabled} onClick={onFindRoles}>
          {FIND_ROLES_PILL.label}
        </button>
        <span className="cc-note">{gate.note}</span>
      </div>
    </section>
  );
}

interface CardEditorProps {
  card: Card;
  onSave: (card: Card) => void;
  onCancel: () => void;
}

function CardEditor({ card, onSave, onCancel }: CardEditorProps) {
  const [draft, setDraft] = useState({
    title: card.title,
    situation: card.situation,
    actions: card.actions,
    results: card.results,
    skills: card.skills.join(", "),
  });

  const set = (key: keyof typeof draft) => (value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <article className="cc-card">
      <Labelled label="Title" value={draft.title} onChange={set("title")} />
      <Labelled label="Situation" value={draft.situation} onChange={set("situation")} multiline />
      <Labelled label="Action" value={draft.actions} onChange={set("actions")} multiline />
      <Labelled label="Result" value={draft.results} onChange={set("results")} multiline />
      <Labelled label="Skills (comma separated)" value={draft.skills} onChange={set("skills")} />
      <div className="cc-card-footer">
        <button
          type="button"
          className="cc-btn-outline"
          onClick={() =>
            onSave({
              ...card,
              title: draft.title.trim(),
              situation: draft.situation.trim(),
              actions: draft.actions.trim(),
              results: draft.results.trim(),
              skills: draft.skills
                .split(",")
                .map((skill) => skill.trim())
                .filter((skill) => skill !== ""),
            })
          }
        >
          Save
        </button>
        <button type="button" className="cc-btn-outline" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </article>
  );
}

function Labelled({
  label,
  value,
  onChange,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  return (
    <label className="cc-edit-label">
      <span className="cc-field-label">{label}</span>
      {multiline ? (
        <textarea
          className="cc-field-input"
          rows={3}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          className="cc-field-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}
