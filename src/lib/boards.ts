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

/**
 * Short numbered steps for turning a search into a recurring email alert.
 *
 * Every board's steps set location and remote/hybrid through that board's own
 * filters (PLAN.md §7.36): the query strings carry no place names and no
 * "remote" wording, because a filter the board maintains beats a term hacked
 * into the keyword box.
 */
export const ALERT_STEPS: Record<Board, string[]> = {
  linkedin: [
    "1. Open LinkedIn Jobs and paste the query into the keyword box — it carries no location or remote wording on purpose.",
    "2. Look for the location box and set where you want to work, then look for the remote / hybrid / on-site filter and set that too.",
    "3. Look for any other filter worth keeping (experience level, date posted) and set it before you save.",
    "4. On the results page, look for the alert control — usually a \"Set alert\" toggle near the top of the list — and turn it on.",
    "5. Look for a frequency choice (daily or weekly) and pick one; LinkedIn then emails new matches.",
    "6. Your saved alerts live under Jobs > Job alerts if you want to edit or delete this one later.",
  ],
  indeed: [
    "1. Open Indeed and run the query in the \"what\" box; leave the query itself free of location and remote wording.",
    "2. Look for the \"where\" box and set your city or region there, then look for the remote / hybrid filter above the results and set it.",
    "3. Scroll the results page and look for the email box — usually \"Get new jobs for this search by email\".",
    "4. Enter your email address and activate it; Indeed may send a confirmation mail you have to click.",
    "5. Look for a frequency or unsubscribe link in the alert emails themselves to change or stop it later.",
  ],
  climatebase: [
    "1. Climatebase needs a free account for alerts, so sign in (or create an account) first.",
    "2. Run the query in the job search box — it has no location or remote wording in it.",
    "3. Look for the location filter and set where you want to work, then look for the remote / hybrid filter and set that too.",
    "4. Look for a save control on the results page — usually \"Save search\" — and save it.",
    "5. Look for a job-alerts or notification setting in your account and make sure email is switched on for the saved search.",
  ],
  other: [
    "1. Run the query on the site's own job search; the query holds no location or remote wording.",
    "2. Look for the site's location filter and its remote / hybrid filter and set both there rather than typing a place name into the query.",
    "3. Look for a save-search or email-alert control on the results page; many niche boards hide it behind a bell or envelope icon.",
    "4. If the site has no alert control, check the careers page weekly instead and keep the query as your checklist.",
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
