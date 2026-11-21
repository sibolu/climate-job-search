"use client";

/**
 * The Roles screen (technical-plan.md D50): one centred column (D49), one
 * group per discovered field in rank order. Fields are headings with no
 * marking; roles are the unit of choice. One sticky footer button writes a
 * LinkedIn search for every ticked role in one turn (D47).
 */

import type { Profile } from "@/lib/profile";
import { roleGroups, selectedRolesNote, writeSearchesLabel } from "@/lib/screens";
import { canWriteQueries, selectedRoles } from "@/lib/workspace";

import RoleGroup from "./RoleGroup";

export interface RoleBoardProps {
  profile: Profile;
  onRole: (roleId: string, selected: boolean) => void;
  onWriteSearches: () => void;
}

export default function RoleBoard({ profile, onRole, onWriteSearches }: RoleBoardProps) {
  const groups = roleGroups(profile);
  const count = selectedRoles(profile).length;
  const note = selectedRolesNote(count);

  return (
    <section className="cc-roles-screen">
      <h2 className="cc-h2">Climate roles worth a look</h2>
      <p className="cc-sub">
        Grouped by field, closest match first. Tick the roles you want to search for.
      </p>

      {groups.map((group) => (
        <RoleGroup key={group.field.id} group={group} onRole={onRole} />
      ))}

      <div className="cc-roles-footer">
        <button
          type="button"
          className="cc-btn"
          disabled={!canWriteQueries(profile)}
          onClick={onWriteSearches}
        >
          {writeSearchesLabel(count)}
        </button>
        {note ? <span className="cc-note">{note}</span> : null}
      </div>
    </section>
  );
}
