"use client";

import { useId, useState } from "react";

export interface InfoTipProps {
  /** What the input next to this icon changes. */
  text: string;
  /** The button's accessible name; says which input it explains. */
  label?: string;
}

/**
 * A small "i" next to an input, saying what the input changes (step 2b.11).
 * A real button, so it is reachable by keyboard; the tooltip opens on hover
 * and on focus, closes on Escape, and is the button's description either way.
 */
export default function InfoTip({ text, label = "What this changes" }: InfoTipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);

  return (
    <span
      className="cc-infotip"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="cc-infotip-btn"
        aria-label={label}
        aria-describedby={id}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      >
        i
      </button>
      <span role="tooltip" id={id} className="cc-infotip-text" data-open={open}>
        {text}
      </span>
    </span>
  );
}
