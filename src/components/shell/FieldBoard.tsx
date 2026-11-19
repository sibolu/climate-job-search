"use client";

/**
 * The field board (technical-plan.md D39): ranked cards in the order discovery wrote
 * them, re-banded by mark only on arrival (the order comes in as a snapshot
 * from the shell, so nothing jumps out from under the cursor while marking).
 */

import type { FieldStatus, Profile } from "@/lib/profile";
import { rolesForField } from "@/lib/profile";
import { FIND_ROLES_PILL, findRolesGate, orderFields } from "@/lib/screens";

import FieldCard from "./FieldCard";
import type { AskState } from "./FieldCard";

export interface FieldBoardProps {
  profile: Profile;
  /** Field ids in the order snapshotted when the board was entered. */
  order: readonly string[];
  expandedId?: string;
  onExpand: (fieldId: string | undefined) => void;
  onMark: (fieldId: string, status: FieldStatus) => void;
  onRole: (roleId: string, selected: boolean) => void;
  onAsk: (fieldId: string) => void;
  askStateFor: (fieldId: string) => AskState;
  canWriteSearches: (fieldId: string) => boolean;
  onWriteSearches: (fieldId: string) => void;
  onMatchFields: () => void;
}

export default function FieldBoard({
  profile,
  order,
  expandedId,
  onExpand,
  onMark,
  onRole,
  onAsk,
  askStateFor,
  canWriteSearches,
  onWriteSearches,
  onMatchFields,
}: FieldBoardProps) {
  if (profile.fields.length === 0) {
    const gate = findRolesGate(profile);
    return (
      <section>
        <h2 className="cc-h2">Climate fields worth a look</h2>
        <p className="cc-sub">No fields yet. Matching reads your included highlights.</p>
        <button
          type="button"
          className="cc-btn"
          style={{ marginTop: 16 }}
          disabled={!gate.enabled}
          onClick={onMatchFields}
        >
          {FIND_ROLES_PILL.label}
        </button>
        <p className="cc-note" style={{ marginTop: 8 }}>
          {gate.note}
        </p>
      </section>
    );
  }

  const fields = orderFields(profile, order);

  return (
    <section>
      <h2 className="cc-h2">Climate fields worth a look</h2>
      <p className="cc-sub">Click on a card to see more info and roles.</p>
      <div className="cc-field-grid">
        {fields.map((field, index) => (
          <FieldCard
            key={field.id}
            profile={profile}
            field={field}
            rank={index + 1}
            open={field.id === expandedId}
            roles={rolesForField(profile, field.id)}
            askState={askStateFor(field.id)}
            canWriteSearches={canWriteSearches(field.id)}
            onToggle={() => onExpand(field.id === expandedId ? undefined : field.id)}
            onMark={(status) => onMark(field.id, status)}
            onRole={onRole}
            onAsk={() => onAsk(field.id)}
            onWriteSearches={() => onWriteSearches(field.id)}
          />
        ))}
      </div>
    </section>
  );
}
