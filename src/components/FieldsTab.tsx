"use client";

/**
 * The Fields tab: a board of the climate fields discovery proposed, each with
 * accept / reject / unsure controls, the move type, the fit reasoning with the
 * cards it cites, what is still uncertain, its sources, and the shortlisted
 * roles that belong to it.
 *
 * The user is in charge (PRD): statuses are local profile edits with no server
 * call, and nothing is ever deleted. Only the Explore button posts a turn.
 */

import type { Field, FieldStatus, MoveType, Profile, Role } from "@/lib/profile";
import { citedCardIds } from "@/lib/profile";
import { rolesForField, unassignedRoles } from "@/lib/workspace";

export interface FieldsTabProps {
  profile: Profile;
  busy: boolean;
  onSetFieldStatus: (fieldId: string, status: FieldStatus) => void;
  onExplore: (field: Field) => void;
}

const STATUS_BUTTONS: { status: FieldStatus; label: string }[] = [
  { status: "accepted", label: "Accept" },
  { status: "unsure", label: "Unsure" },
  { status: "rejected", label: "Reject" },
];

const STATUS_LABELS: Record<FieldStatus, string> = {
  candidate: "Candidate",
  accepted: "Accepted",
  unsure: "Unsure",
  rejected: "Rejected",
};

const MOVE_LABELS: Record<MoveType, string> = {
  sector: "Sector switch — same work, climate employer",
  adjacent: "Adjacent move — nearby work, some new ground",
  retraining: "Needs retraining",
};

function SourceList({ sources }: { sources: string[] }) {
  if (sources.length === 0) return null;
  return (
    <ul className="source-list">
      {sources.map((source) => (
        <li key={source}>
          {/^https?:\/\//.test(source) ? (
            <a href={source} target="_blank" rel="noreferrer">
              {source}
            </a>
          ) : (
            source
          )}
        </li>
      ))}
    </ul>
  );
}

function RoleItem({ role }: { role: Role }) {
  return (
    <li className="role">
      <div className="role-head">
        <strong>{role.title}</strong>
        <span className="muted">{role.id}</span>
      </div>
      {role.why === "" ? null : <p>{role.why}</p>}
      {role.companies.length === 0 ? null : (
        <p className="muted">Example employers: {role.companies.join(", ")}</p>
      )}
      <SourceList sources={role.sources} />
    </li>
  );
}

export default function FieldsTab({ profile, busy, onSetFieldStatus, onExplore }: FieldsTabProps) {
  const orphans = unassignedRoles(profile);

  if (profile.fields.length === 0 && orphans.length === 0) {
    return (
      <div className="panel-body">
        <p className="muted">
          No fields yet. Once your profile has experience cards and your preferences, ask in the
          chat which climate fields fit you and they will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="panel-body">
      {profile.fields.map((field) => {
        const cited = citedCardIds(field.fit);
        const roles = rolesForField(profile, field.id);
        return (
          <section
            key={field.id}
            className={field.status === "rejected" ? "field-card field-rejected" : "field-card"}
          >
            <div className="field-head">
              <h3>
                {field.name} <span className="muted">{field.id}</span>
              </h3>
              <span className={`badge badge-${field.status}`}>{STATUS_LABELS[field.status]}</span>
            </div>

            <p className="muted">
              {field.move === undefined ? "Move type not set" : MOVE_LABELS[field.move]}
              {field.explored ? " · explored" : ""}
            </p>

            {field.fit === "" ? null : (
              <>
                <h4>Why it fits</h4>
                <p>{field.fit}</p>
                <p className="muted">
                  {cited.length === 0
                    ? "No experience cards cited yet."
                    : `Cites ${cited.join(", ")}`}
                </p>
              </>
            )}

            {field.uncertain === "" ? null : (
              <>
                <h4>Still uncertain</h4>
                <p>{field.uncertain}</p>
              </>
            )}

            {field.sources.length === 0 ? null : (
              <>
                <h4>Sources</h4>
                <SourceList sources={field.sources} />
              </>
            )}

            {roles.length === 0 ? null : (
              <>
                <h4>Roles in this field</h4>
                <ul className="role-list">
                  {roles.map((role) => (
                    <RoleItem key={role.id} role={role} />
                  ))}
                </ul>
              </>
            )}

            <div className="button-row">
              {STATUS_BUTTONS.map((b) => (
                <button
                  key={b.status}
                  type="button"
                  className="secondary"
                  aria-pressed={field.status === b.status}
                  onClick={() => onSetFieldStatus(field.id, b.status)}
                >
                  {b.label}
                </button>
              ))}
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => onExplore(field)}
              >
                Explore
              </button>
            </div>
          </section>
        );
      })}

      {orphans.length === 0 ? null : (
        <section className="panel-section">
          <h3>Roles without a field</h3>
          <ul className="role-list">
            {orphans.map((role) => (
              <RoleItem key={role.id} role={role} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
