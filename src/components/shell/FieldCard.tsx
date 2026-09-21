"use client";

/**
 * One ranked field card (technical-plan.md D39). Collapsed it shows the move type, the
 * three-level fit label, the sector, the blurb, chips and the three-way mark;
 * expanded in place it shows the evidence lines, the roles with checkboxes,
 * the employers, the uncertainty and its ask, the sources, and the CTA that
 * writes searches for the ticked roles (D40). Everything rendered here comes
 * from discovery data — there is no example-posting or day-to-day text.
 */

import type { Field, FieldStatus, Profile, Role } from "@/lib/profile";

export const FIT_LABELS: Record<string, string> = {
  strong: "Strong overlap",
  some: "Some overlap",
  stretch: "Stretch",
};

/** Three labels drawn at three fixed widths — never a percentage (D39). */
const FIT_WIDTHS: Record<string, string> = {
  strong: "100%",
  some: "62%",
  stretch: "30%",
};

export const MOVE_LABELS: Record<string, string> = {
  sector: "Sector move",
  adjacent: "Adjacent role",
  retraining: "Retraining",
};

const MARKS: { status: FieldStatus; label: string }[] = [
  { status: "accepted", label: "Interesting" },
  { status: "unsure", label: "Unsure" },
  { status: "rejected", label: "Not for me" },
];

/** Where the field's ask has got to, which is what the button label says. */
export type AskState = "idle" | "live" | "noted";

const ASK_LABELS: Record<AskState, string> = {
  idle: "Add info in chat",
  live: "Open in the chat rail",
  noted: "Noted — in your profile",
};

export interface FieldCardProps {
  profile: Profile;
  field: Field;
  rank: number;
  open: boolean;
  roles: Role[];
  askState: AskState;
  canWriteSearches: boolean;
  onToggle: () => void;
  onMark: (status: FieldStatus) => void;
  onRole: (roleId: string, selected: boolean) => void;
  onAsk: () => void;
  onWriteSearches: () => void;
}

export default function FieldCard({
  profile,
  field,
  rank,
  open,
  roles,
  askState,
  canWriteSearches,
  onToggle,
  onMark,
  onRole,
  onAsk,
  onWriteSearches,
}: FieldCardProps) {
  const selected = roles.filter((role) => role.selected);
  const employers = [...new Set(selected.flatMap((role) => role.companies))];
  const allEmployers = employers.length > 0 ? employers : [...new Set(roles.flatMap((r) => r.companies))];
  const fit = field.fitLevel ?? "some";

  function cardTitle(cardId: string): string {
    return profile.cards.find((card) => card.id === cardId)?.title ?? cardId;
  }

  return (
    <article className="cc-field-card" data-open={open} data-rejected={field.status === "rejected"}>
      <div
        className="cc-field-body"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
      >
        <div className="cc-field-top">
          <span className="cc-rank">{rank}</span>
          <span>
            <span className="cc-field-name">{field.name}</span>
            <span className="cc-field-sector">{field.sector}</span>
          </span>
          <span className="cc-see-roles">{open ? "Close" : "See Roles"}</span>
        </div>

        <div className="cc-field-meta">
          {field.move ? (
            <span className="cc-move">
              <span className="cc-move-dot" data-move={field.move} aria-hidden="true" />
              {MOVE_LABELS[field.move] ?? field.move}
            </span>
          ) : null}
          <span className="cc-fit-wrap">
            <span
              className="cc-fit-bar"
              aria-hidden="true"
              style={{
                background: `linear-gradient(to right, var(--green) ${FIT_WIDTHS[fit]}, var(--skeleton) ${FIT_WIDTHS[fit]})`,
              }}
            />
            {FIT_LABELS[fit] ?? fit}
          </span>
        </div>

        <p className="cc-field-summary">{field.summary}</p>
        <div className="cc-chips">
          {field.chips.map((chip) => (
            <span key={chip} className="cc-chip">
              {chip}
            </span>
          ))}
        </div>

        {open ? (
          <div className="cc-field-open" onClick={(event) => event.stopPropagation()}>
            {field.evidence.length > 0 ? (
              <div>
                <div className="cc-mono-label">From your highlights</div>
                {field.evidence.map((line) => (
                  <div key={`${line.cardId}-${line.why}`} className="cc-evidence">
                    <span className="cc-dot" aria-hidden="true" />
                    <span>
                      <strong>{cardTitle(line.cardId)}</strong> — {line.why}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="cc-two-col">
              <div className="cc-roles">
                <div className="cc-mono-label">Roles to look at</div>
                <p className="cc-note">Select the ones you want searches for.</p>
                {roles.length === 0 ? (
                  <p className="cc-note">No roles on this field yet.</p>
                ) : null}
                {roles.map((role) => (
                  <button
                    key={role.id}
                    type="button"
                    className="cc-role"
                    aria-pressed={role.selected}
                    onClick={() => onRole(role.id, !role.selected)}
                  >
                    <span className="cc-check" aria-hidden="true">
                      {role.selected ? "✓" : ""}
                    </span>
                    <span>
                      <span style={{ display: "block", fontWeight: role.selected ? 600 : 500 }}>
                        {role.title}
                      </span>
                      {role.why ? <span className="cc-note">{role.why}</span> : null}
                    </span>
                  </button>
                ))}
              </div>

              {field.uncertain ? (
                <div className="cc-uncertain">
                  <div className="cc-mono-label" style={{ color: "var(--amber-text)" }}>
                    What is uncertain
                  </div>
                  <p style={{ fontSize: 13.5, lineHeight: 1.55 }}>{field.uncertain}</p>
                  {field.ask ? (
                    <button
                      type="button"
                      className="cc-btn-outline"
                      disabled={askState === "noted"}
                      onClick={onAsk}
                    >
                      {ASK_LABELS[askState]}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            {allEmployers.length > 0 ? (
              <div>
                <div className="cc-mono-label">Potential employers</div>
                <div className="cc-chips">
                  {allEmployers.map((name) => (
                    <span key={name} className="cc-chip cc-chip-outline">
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {field.sources.length > 0 ? (
              <div>
                <div className="cc-mono-label">Sources</div>
                <div className="cc-sources">
                  {field.sources.map((source) => (
                    <a key={source} href={source} target="_blank" rel="noreferrer noopener">
                      {source}
                    </a>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="cc-cta-row">
              <button
                type="button"
                className="cc-btn"
                disabled={!canWriteSearches}
                onClick={onWriteSearches}
              >
                {selected.length > 0
                  ? `Write searches for ${selected.length} role${selected.length === 1 ? "" : "s"}`
                  : "Select a role first"}
              </button>
              <span className="cc-note">
                {selected.length > 0
                  ? `${selected.length} role${selected.length === 1 ? "" : "s"} selected.`
                  : "Tick the roles you want searched."}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="cc-field-footer">
        {MARKS.map((mark) => (
          <button
            key={mark.status}
            type="button"
            className="cc-mark"
            data-mark={mark.status}
            aria-pressed={field.status === mark.status}
            onClick={() => onMark(field.status === mark.status ? "candidate" : mark.status)}
          >
            {mark.label}
          </button>
        ))}
      </div>
    </article>
  );
}
