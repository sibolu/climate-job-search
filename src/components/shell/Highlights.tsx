"use client";

import { useState } from "react";

import type { Card, Profile } from "@/lib/profile";
import { activeCards } from "@/lib/profile";
import { matchFieldsGate } from "@/lib/screens";

export interface HighlightsProps {
  profile: Profile;
  onExclude: (cardId: string, excluded: boolean) => void;
  onEditCard: (card: Card) => void;
  onMatchFields: () => void;
}

/**
 * The extracted work highlights. Corrections happen here and in the rail —
 * there is no free-text composer in the beta (technical-plan.md D42).
 */
export default function Highlights({
  profile,
  onExclude,
  onEditCard,
  onMatchFields,
}: HighlightsProps) {
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const gate = matchFieldsGate(profile);
  const included = activeCards(profile).length;

  return (
    <section>
      <div className="cc-screen-head">
        <div>
          <h2 className="cc-h2">Your highlights</h2>
          <p className="cc-sub">
            Fix anything wrong. Exclude what you do not want to be matched on.
          </p>
        </div>
        <span className="cc-counter">
          Matching fields · {included} of {profile.cards.length} in
        </span>
      </div>

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
                {card.years ? <span className="cc-years">{card.years}</span> : null}
              </div>
              <dl className="cc-dl">
                <dt>Situation</dt>
                <dd>{card.situation}</dd>
                <dt>Action</dt>
                <dd>{card.actions}</dd>
                <dt>Result</dt>
                <dd>{card.results}</dd>
              </dl>
              <div className="cc-chips">
                {card.skills.map((skill) => (
                  <span key={skill} className="cc-chip">
                    {skill}
                  </span>
                ))}
              </div>
              <div className="cc-card-footer">
                <button type="button" className="cc-btn-outline" onClick={() => setEditing(card.id)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="cc-btn-outline"
                  onClick={() => onExclude(card.id, !card.excluded)}
                >
                  {card.excluded ? "Excluded — include" : "Exclude"}
                </button>
              </div>
            </article>
          ),
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 22 }}>
        <button type="button" className="cc-btn" disabled={!gate.enabled} onClick={onMatchFields}>
          Match fields
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
    years: card.years ?? "",
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
      <Labelled label="Years" value={draft.years} onChange={set("years")} />
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
              years: draft.years.trim() === "" ? undefined : draft.years.trim(),
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
      <span className="cc-mono-label">{label}</span>
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
