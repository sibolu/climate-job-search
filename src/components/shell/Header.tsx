"use client";

import type { NavStep, ScreenInput } from "@/lib/screens";
import { NAV_LABELS, NAV_STEPS, navStepEnabled } from "@/lib/screens";

export interface HeaderProps {
  input: ScreenInput;
  current: NavStep;
  profileOpen: boolean;
  onNavigate: (step: NavStep) => void;
  onToggleProfile: () => void;
}

/**
 * The product name, the four-step nav and "Your profile". The nav is always
 * shown: every step the person has reached is a link back to its screen, and
 * steps ahead are disabled, so there is no way to jump ahead of the
 * sequential flow (technical-plan.md D38, D55). "Start over" lives only on
 * the Resume page. There is no rail: the profile opens from here
 * (technical-plan.md D49).
 */
export default function Header({
  input,
  current,
  profileOpen,
  onNavigate,
  onToggleProfile,
}: HeaderProps) {
  return (
    <header className="cc-header">
      <span className="cc-product">Climate Career Exploration</span>
      <span className="cc-badge">Alpha</span>
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
      </div>
    </header>
  );
}
