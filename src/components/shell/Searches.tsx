"use client";

/**
 * The Searches screen (technical-plan.md D47): one card per ticked role, in
 * `selectedRoles` order. A role ticked after the last write has no search
 * yet; the screen says so and offers the same button as the Roles screen
 * rather than showing an empty card. No verdicts (D51).
 */

import type { Profile } from "@/lib/profile";
import { copyKey, missingSearchesNote, searchCards, selectedRolesNote, writeSearchesLabel } from "@/lib/screens";
import { canWriteQueries } from "@/lib/workspace";

import QueryCard from "./QueryCard";

export interface SearchesProps {
  profile: Profile;
  /** `copyKey(query)` → epoch ms of the last copy, kept in the browser only (D41). */
  copiedAt: Record<string, number>;
  now: number;
  onCopy: (key: string) => void;
  onWriteSearches: () => void;
  onChangeRoles: () => void;
}

export default function Searches({
  profile,
  copiedAt,
  now,
  onCopy,
  onWriteSearches,
  onChangeRoles,
}: SearchesProps) {
  const cards = searchCards(profile);
  const missing = cards.filter((card) => card.query === undefined);

  return (
    <section className="cc-searches-screen">
      <div className="cc-screen-head">
        <div>
          <h2 className="cc-h2">Your LinkedIn searches</h2>
          <p className="cc-sub">
            One search for each role you ticked. Open it on LinkedIn, then set your location and
            remote filters there.
          </p>
        </div>
        <button type="button" className="cc-btn-outline cc-screen-head-action" onClick={onChangeRoles}>
          Change roles
        </button>
      </div>

      {cards.length === 0 ? (
        <div className="cc-empty">
          <div style={{ fontWeight: 600, fontSize: 15 }}>No searches yet</div>
          <p className="cc-note">Tick the roles you want on the Roles screen.</p>
          <button type="button" className="cc-btn" onClick={onChangeRoles}>
            Change roles
          </button>
        </div>
      ) : null}

      {missing.length > 0 ? (
        <div className="cc-empty">
          <div style={{ fontWeight: 600, fontSize: 15 }}>
            {missing.length === 1
              ? "1 ticked role has no search yet"
              : `${missing.length} ticked roles have no search yet`}
          </div>
          <p className="cc-note">{missingSearchesNote(missing)}</p>
          <div className="cc-cta-row">
            <button
              type="button"
              className="cc-btn"
              disabled={!canWriteQueries(profile)}
              onClick={onWriteSearches}
            >
              {writeSearchesLabel(cards.length)}
            </button>
            {selectedRolesNote(cards.length) ? (
              <span className="cc-note">{selectedRolesNote(cards.length)}</span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="cc-query-list">
        {cards.map(({ role, fieldName, query }) => {
          if (query === undefined) return null;
          const key = copyKey(query);
          const at = copiedAt[key];
          return (
            <QueryCard
              key={role.id}
              roleTitle={role.title}
              fieldName={fieldName}
              query={query}
              copiedMinutes={at === undefined ? undefined : Math.max(0, Math.floor((now - at) / 60000))}
              onCopy={() => onCopy(key)}
            />
          );
        })}
      </div>
    </section>
  );
}
