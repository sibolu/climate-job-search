"use client";

/**
 * The Searches screen (technical-plan.md D40): one group per field that has ticked roles
 * or live queries, Interesting first. Retired queries are hidden. A field
 * whose roles are ticked but whose searches have not been written yet keeps
 * its own CTA here.
 */

import type { Profile } from "@/lib/profile";
import { orderedFieldGroups } from "@/lib/screens";

import QueryCard from "./QueryCard";

export interface SearchesProps {
  profile: Profile;
  /** Query id → epoch ms of the last copy, kept in the browser only (D41). */
  copiedAt: Record<string, number>;
  now: number;
  onCopy: (queryId: string) => void;
  onFeedback: (queryId: string, verdict: "good" | "wrong") => void;
  onWriteSearches: (fieldId: string) => void;
  canWriteSearches: (fieldId: string) => boolean;
  onBackToFields: () => void;
}

export default function Searches({
  profile,
  copiedAt,
  now,
  onCopy,
  onFeedback,
  onWriteSearches,
  canWriteSearches,
  onBackToFields,
}: SearchesProps) {
  const groups = orderedFieldGroups(profile);

  return (
    <section>
      <div className="cc-screen-head">
        <div>
          <h2 className="cc-h2">Searches to run</h2>
          <p className="cc-sub">
            Built from the roles you selected, grouped by field. Copy one, run it in your own tab,
            then tell us how it went.
          </p>
        </div>
        <button type="button" className="cc-btn-outline" onClick={onBackToFields}>
          Back to roles
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="cc-empty">
          <div style={{ fontWeight: 600, fontSize: 15 }}>No roles selected yet</div>
          <p className="cc-note">
            Open a field, tick the roles that interest you, and the searches for them appear here.
          </p>
          <button type="button" className="cc-btn" onClick={onBackToFields}>
            Back to roles
          </button>
        </div>
      ) : null}

      {groups.map((group, index) => (
        <div key={group.field.id} className="cc-group">
          <div className="cc-group-head">
            <span className="cc-rank">{index + 1}</span>
            <span style={{ fontSize: 15.5, fontWeight: 600 }}>{group.field.name}</span>
          </div>
          {group.roles.length > 0 ? (
            <div className="cc-group-roles">
              <div className="cc-mono-label">Selected roles</div>
              <div className="cc-chips">
                {group.roles.map((role) => (
                  <span key={role.id} className="cc-chip cc-chip-green">
                    {role.title}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {group.queries.length === 0 ? (
            <div className="cc-group-roles">
              <button
                type="button"
                className="cc-btn"
                disabled={!canWriteSearches(group.field.id)}
                onClick={() => onWriteSearches(group.field.id)}
              >
                Write searches for these roles
              </button>
            </div>
          ) : (
            <div className="cc-query-grid">
              {group.queries.map((query) => {
                const at = copiedAt[query.id];
                return (
                  <QueryCard
                    key={query.id}
                    query={query}
                    copiedMinutes={
                      at === undefined ? undefined : Math.max(0, Math.floor((now - at) / 60000))
                    }
                    onCopy={() => onCopy(query.id)}
                    onFeedback={(verdict) => onFeedback(query.id, verdict)}
                  />
                );
              })}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
