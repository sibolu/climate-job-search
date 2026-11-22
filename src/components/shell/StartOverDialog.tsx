"use client";

import { useEffect, useRef } from "react";

export interface StartOverDialogProps {
  open: boolean;
  onDownload: () => void;
  onStartOver: () => void;
  onCancel: () => void;
}

/**
 * The confirmation in front of "Start over" (technical-plan.md D55): a native
 * modal `<dialog>` that offers the profile download before anything is
 * cleared (design-language.md, "Density and structure").
 */
export default function StartOverDialog({
  open,
  onDownload,
  onStartOver,
  onCancel,
}: StartOverDialogProps) {
  const ref = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="cc-dialog"
      aria-labelledby="cc-start-over-title"
      // Escape closes a modal dialog natively; keep the parent's state in step.
      onClose={() => {
        if (open) onCancel();
      }}
    >
      <h2 id="cc-start-over-title" className="cc-h2">
        Start over?
      </h2>
      <p className="cc-dialog-body">
        This clears your resume, highlights, answers, roles and searches from this browser.
        Download your profile first if you want to pick up where you left off.
      </p>
      <div className="cc-dialog-actions">
        <button type="button" className="cc-btn" onClick={onDownload}>
          Download profile
        </button>
        <button type="button" className="cc-btn-outline" onClick={onStartOver}>
          Start over
        </button>
        <button type="button" className="cc-btn-outline" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
