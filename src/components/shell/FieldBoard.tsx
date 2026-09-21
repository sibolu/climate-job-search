"use client";

// step 2b.5 replaces this with the real field board: ranked cards, the
// three-way mark, expand-in-place with roles, evidence and the per-field ask.

import type { Profile } from "@/lib/profile";

export interface FieldBoardProps {
  profile: Profile;
  onMatchFields: () => void;
}

const FIT_LABELS: Record<string, string> = {
  strong: "Strong overlap",
  some: "Some overlap",
  stretch: "Stretch",
};

export default function FieldBoard({ profile, onMatchFields }: FieldBoardProps) {
  if (profile.fields.length === 0) {
    return (
      <section>
        <h2 className="cc-h2">Climate fields worth a look</h2>
        <p className="cc-sub">No fields yet. Matching reads your included highlights.</p>
        <button type="button" className="cc-btn" style={{ marginTop: 16 }} onClick={onMatchFields}>
          Match fields
        </button>
      </section>
    );
  }

  return (
    <section>
      <h2 className="cc-h2">Climate fields worth a look</h2>
      <p className="cc-sub">Click on a card to see more info and roles.</p>
      <ul className="cc-fieldlist">
        {profile.fields.map((field) => (
          <li key={field.id}>
            <span style={{ fontWeight: 600 }}>{field.name}</span>
            <span className="cc-note">{field.sector}</span>
            {field.fitLevel ? (
              <span className="cc-fit">{FIT_LABELS[field.fitLevel] ?? field.fitLevel}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
