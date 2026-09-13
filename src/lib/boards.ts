/**
 * `boards.ts` — how the four job boards are named in the UI and how a saved
 * search becomes an email alert on each one (PLAN.md Phase 2.4).
 *
 * Client-safe: no server-only imports, no network access. The app never
 * fetches a job board (PRD: no scraping, no self-built job index) — these are
 * instructions the user follows in their own browser, written as "look for..."
 * so a board's UI redesign makes them vague rather than wrong.
 */

import type { Board, Query } from "./profile";

/** `extra` key naming the site for a query on the `other` board. */
export const BOARD_NAME_KEY = "Board name";
/** `extra` keys a revision sets on an untried query it retires (never deleted; PLAN.md §7.10). */
export const RETIRED_KEY = "Retired";
export const RETIRED_REASON_KEY = "Retired reason";

/** True when a revision retired this untried query. */
export function isRetiredQuery(query: Query): boolean {
  return query.extra[RETIRED_KEY] === "yes";
}

export const BOARD_LABELS: Record<Board, string> = {
  linkedin: "LinkedIn",
  indeed: "Indeed",
  climatebase: "Climatebase",
  other: "Other",
};

/** Short numbered steps for turning a search into a recurring email alert. */
export const ALERT_STEPS: Record<Board, string[]> = {
  linkedin: [
    "1. Open LinkedIn Jobs and paste the query into the keyword box.",
    "2. Set your location and any filters you want kept (remote, experience level).",
    "3. On the results page, look for the alert control — usually a \"Set alert\" toggle near the top of the list — and turn it on.",
    "4. Look for a frequency choice (daily or weekly) and pick one; LinkedIn then emails new matches.",
    "5. Your saved alerts live under Jobs > Job alerts if you want to edit or delete this one later.",
  ],
  indeed: [
    "1. Open Indeed and run the query in the \"what\" box, with your city or \"remote\" in the \"where\" box.",
    "2. Scroll the results page and look for the email box — usually \"Get new jobs for this search by email\".",
    "3. Enter your email address and activate it; Indeed may send a confirmation mail you have to click.",
    "4. Look for a frequency or unsubscribe link in the alert emails themselves to change or stop it later.",
  ],
  climatebase: [
    "1. Climatebase needs a free account for alerts, so sign in (or create an account) first.",
    "2. Run the query in the job search box and apply the filters you care about.",
    "3. Look for a save control on the results page — usually \"Save search\" — and save it.",
    "4. Look for a job-alerts or notification setting in your account and make sure email is switched on for the saved search.",
  ],
  other: [
    "1. Run the query on the site's own job search.",
    "2. Look for a save-search or email-alert control on the results page; many niche boards hide it behind a bell or envelope icon.",
    "3. If the site has no alert control, check the careers page weekly instead and keep the query as your checklist.",
  ],
};

/**
 * What to call a query's board in the UI. A query on `other` may name its site
 * in `extra["Board name"]`; anything else falls back to the generic label.
 */
export function boardLabel(query: Query): string {
  if (query.board === "other") {
    const named = query.extra[BOARD_NAME_KEY]?.trim();
    if (named !== undefined && named !== "") return named;
  }
  return BOARD_LABELS[query.board];
}
