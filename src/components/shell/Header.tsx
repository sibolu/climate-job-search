"use client";

import type { NavStep, Screen, ScreenInput } from "@/lib/screens";
import { NAV_LABELS, NAV_STEPS, navStepEnabled } from "@/lib/screens";

export interface HeaderProps {
  screen: Screen;
  input: ScreenInput;
  current: NavStep;
  showNav: boolean;
}

/**
 * Product mark plus the three-step nav. The nav is hidden on first run and
 * steps the person has not reached yet are disabled — there is no way to jump
 * ahead of the sequential flow (technical-plan.md D38).
 */
export default function Header({ input, current, showNav }: HeaderProps) {
  return (
    <header className="cc-header">
      <span className="cc-mark" aria-hidden="true" />
      <span className="cc-product">Climate Career Exploration</span>
      <span className="cc-badge">Alpha</span>
      {showNav ? (
        <nav className="cc-nav" aria-label="Steps">
          {NAV_STEPS.map((step) => (
            <button
              key={step}
              type="button"
              className="cc-step"
              disabled={!navStepEnabled(step, input)}
              aria-current={step === current ? "step" : undefined}
            >
              {NAV_LABELS[step]}
            </button>
          ))}
        </nav>
      ) : null}
    </header>
  );
}
