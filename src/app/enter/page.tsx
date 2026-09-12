import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Enter passcode",
};

/**
 * Entry screen for the shared passcode (PLAN.md §2 "Access"). A plain form
 * post so the gate works without client JavaScript; `/api/enter` sets the
 * session cookie and redirects to the workspace.
 */
export default function EnterPage() {
  return (
    <main>
      <h1>Climate Career Exploration Tool</h1>
      <p>This alpha is open to invited fellows. Enter the shared passcode.</p>
      <form method="post" action="/api/enter">
        <label htmlFor="passcode">Passcode</label>
        <input
          id="passcode"
          name="passcode"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
        />
        <button type="submit">Enter</button>
      </form>
    </main>
  );
}
