"use client";

import type { NavStep, ScreenInput } from "@/lib/screens";
import { NAV_LABELS, NAV_STEPS, START_OVER_CONFIRM, navStepEnabled } from "@/lib/screens";

export interface HeaderProps {
  input: ScreenInput;
  current: NavStep;
  showNav: boolean;
  profileOpen: boolean;
  onNavigate: (step: NavStep) => void;
  onToggleProfile: () => void;
  /** Called only after the person confirmed; clears this browser's copy. */
  onStartOver: () => void;
}

/**
 * Product mark, the three-step nav, "Your profile" and "Start over". All of
 * it is hidden on first run; steps the person has not reached yet are
 * disabled, so there is no way to jump ahead of the sequential flow
 * (technical-plan.md D38). There is no rail: the profile opens from here
 * (technical-plan.md D49).
 */
export default function Header({
  input,
  current,
  showNav,
  profileOpen,
  onNavigate,
  onToggleProfile,
  onStartOver,
}: HeaderProps) {
  return (
    <header className="cc-header">
      <span className="cc-mark" aria-hidden="true" />
      <span className="cc-product">Climate Career Exploration</span>
      <span className="cc-badge">Alpha</span>
      {showNav ? (
        <>
          <nav className="cc-nav" aria-label="Steps">
            {NAV_STEPS.map((step) => (
              <button
                key={step}
                type="button"
                className="cc-step"
                disabled={!navStepEnabled(step, input)}
                aria-current={step === current ? "step" : undefined}
                onClick={() => onNavigate(step)}
              >
                {NAV_LABELS[step]}
              </button>
            ))}
          </nav>
          <div className="cc-header-actions">
            <button
              type="button"
              className="cc-btn-outline"
              aria-expanded={profileOpen}
              onClick={onToggleProfile}
            >
              Your profile
            </button>
            <button
              type="button"
              className="cc-btn-outline"
              onClick={() => {
                if (window.confirm(START_OVER_CONFIRM)) onStartOver();
              }}
            >
              Start over
            </button>
          </div>
        </>
      ) : null}
    </header>
  );
}
