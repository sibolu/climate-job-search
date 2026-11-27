import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Enter your access code",
};

/**
 * Entry screen for a personal access code (technical-plan.md §1 "Access",
 * D68). A plain form post so the gate works without client JavaScript;
 * `/api/enter` sets the session cookie and redirects to the workspace. Codes
 * are shown as XXXX-XXXX-XXXX-XXXX; case, dashes and spaces do not matter.
 */
export default function EnterPage() {
  return (
    <main>
      <h1>Climate Career Exploration Tool</h1>
      <p>This alpha is open to invited fellows. Enter your access code.</p>
      <form method="post" action="/api/enter">
        <label htmlFor="code">Access code</label>
        <input
          id="code"
          name="code"
          type="text"
          placeholder="XXXX-XXXX-XXXX-XXXX"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          required
        />
        <button type="submit">Enter</button>
      </form>
    </main>
  );
}
