"use client";

import type { LogLine } from "@/lib/screens";
import { pendingStatusLine } from "@/lib/screens";

export interface PendingProps {
  /** `m:ss` since the turn was sent. */
  elapsed: string;
  log: readonly LogLine[];
}

/**
 * The main column while a turn is in flight: the status line, the elapsed
 * clock and the progress lines the server actually streams. One turn is in
 * flight at a time, so there are no counts or estimates (D38); there is no
 * rail, so the log lives here (technical-plan.md D49).
 */
export default function Pending({ elapsed, log }: PendingProps) {
  return (
    <section aria-busy="true">
      <div className="cc-status" role="status">
        <span className="cc-spinner" aria-hidden="true" />
        <div>
          <div className="cc-status-title">{pendingStatusLine(log)}</div>
          <div className="cc-note">Working · {elapsed}. Nothing to do until this finishes.</div>
        </div>
      </div>

      {log.length > 0 ? (
        <div className="cc-log" style={{ marginTop: 14 }}>
          {log.map((line, index) => (
            <div className="cc-log-line" key={`${line.time}-${index}`}>
              <span className="cc-log-time">{line.time}</span>
              <span>{line.text}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
