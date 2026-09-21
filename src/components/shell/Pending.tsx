"use client";

import type { LogLine } from "@/lib/screens";

export interface PendingProps {
  /** `m:ss` since the turn was sent. */
  elapsed: string;
  log: readonly LogLine[];
}

/**
 * The board while the assistant is still producing fields. One turn is in
 * flight at a time, so there are no field counts or time estimates — only the
 * elapsed clock and the progress lines the server actually streams (D38).
 */
export default function Pending({ elapsed, log }: PendingProps) {
  const last = log.length > 0 ? log[log.length - 1].text : "Thinking it through…";

  return (
    <section>
      <div className="cc-status">
        <span className="cc-spinner" aria-hidden="true" />
        <div>
          <div className="cc-status-title">Working · {elapsed}</div>
          <div className="cc-note">Nothing to do until this finishes.</div>
        </div>
      </div>

      <div className="cc-grid">
        <div className="cc-skeleton" aria-hidden="true">
          <div className="cc-bar" style={{ height: 15, width: "62%" }} />
          <div className="cc-bar" style={{ height: 11, width: "40%", marginTop: 10 }} />
          <div className="cc-bar-soft" style={{ height: 10, marginTop: 14 }} />
          <div className="cc-bar-soft" style={{ height: 10, marginTop: 8 }} />
          <div className="cc-bar-soft" style={{ height: 10, width: "70%", marginTop: 8 }} />
          <div className="cc-mono-label" style={{ marginTop: 14 }}>
            {last}
          </div>
        </div>
      </div>
    </section>
  );
}
