"use client";

/**
 * One field on the Roles screen (technical-plan.md D50, D57): the field name,
 * one row with the fit label, the move label and a "Based on" disclosure (the
 * highlights the field cites, each with its evidence line), then the
 * two-sentence summary and any "Not sure yet" line. The roles are the rows
 * the person ticks.
 */

import { useState } from "react";

import type { RoleGroupView } from "@/lib/screens";
import { sourceLabel } from "@/lib/screens";

export interface RoleGroupProps {
  group: RoleGroupView;
  onRole: (roleId: string, selected: boolean) => void;
}

export default function RoleGroup({ group, onRole }: RoleGroupProps) {
  const { field, basedOn } = group;
  const [open, setOpen] = useState(false);
  const headingId = `role-group-${field.id}`;
  const basedOnId = `based-on-${field.id}`;

  return (
    <section className="cc-role-group" aria-labelledby={headingId}>
      <header className="cc-role-group-head">
        <h3 id={headingId} className="cc-role-group-name">
          {field.name}
        </h3>
        <div className="cc-role-group-meta">
          {group.fitLabel ? <span className="cc-fit-label">{group.fitLabel}</span> : null}
          {group.moveLabel ? <span>{group.moveLabel}</span> : null}
          {basedOn.length > 0 ? (
            <button
              type="button"
              className="cc-linkish cc-based-on-btn"
              aria-expanded={open}
              aria-controls={basedOnId}
              onClick={() => setOpen((current) => !current)}
            >
              Based on
            </button>
          ) : null}
        </div>
        {open && basedOn.length > 0 ? (
          <ul id={basedOnId} className="cc-based-on-list">
            {basedOn.map(({ title, evidence }) => (
              <li key={title}>
                <strong>{title}</strong>
                {evidence ? `: ${evidence}` : null}
              </li>
            ))}
          </ul>
        ) : null}
        {group.summary ? <p className="cc-role-group-summary">{group.summary}</p> : null}
        {group.uncertain ? (
          <p className="cc-role-uncertain">
            <strong>Not sure yet:</strong> {group.uncertain}
          </p>
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
