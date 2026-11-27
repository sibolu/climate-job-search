import { NextResponse } from "next/server";

import { accessCodeKey, isAccessCodeShape, normalizeAccessCode } from "@/lib/access-code";
import { BudgetLedgerError, budgetVerdict, supabaseBudgetLedger } from "@/lib/budget";
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  isValidPasscode,
  signSession,
} from "@/lib/passcode";

/**
 * Checks an access code (or the optional operator passcode) and, on success,
 * sets the signed session cookie carrying the code's key (technical-plan.md
 * D68).
 *
 * Order: (1) when `OPERATOR_PASSCODE` is set, the typed text is compared to it in
 * constant time; a match is an operator session, with no key and not
 * metered. Phase 2d's `APP_PASSCODE` is deliberately not read: its value was
 * the passcode shared with every fellow, and honouring it would give each of
 * them an uncapped session (technical-plan.md D70). (2) Otherwise the text is normalised; anything that cannot be a
 * code is refused without a database round trip. (3) The key is read from the
 * budget ledger: unknown or disabled is the same 401 as a malformed code, so
 * the response never says which. A code at its cap still enters, because the
 * person's profile is in their browser and they must be able to read and
 * export it; it is the next model call that is refused. A ledger that cannot
 * be read is a 503.
 *
 * Read-only and stateless: nothing is written, and the typed text, the code
 * and its key are never logged (PRD: no user data stored server-side).
 */

/**
 * Never throws. A body that is neither JSON nor a form (`text/plain`, no body
 * at all) makes `request.json()` / `request.formData()` throw a `TypeError`;
 * that is treated as an empty code, so the caller gets the same 401 as a
 * wrong code rather than a 500 that reveals how the endpoint parses.
 */
async function readTypedCode(request: Request): Promise<string> {
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body: unknown = await request.json();
      const code =
        typeof body === "object" && body !== null
          ? (body as Record<string, unknown>).code
          : undefined;
      return typeof code === "string" ? code : "";
    }
    const form = await request.formData();
    const code = form.get("code");
    return typeof code === "string" ? code : "";
  } catch {
    return "";
  }
}

function wantsJson(request: Request): boolean {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return true;
  return (request.headers.get("accept") ?? "").includes("application/json");
}

const DENIED_MESSAGE =
  "That access code wasn't recognised. Check it and try again, or ask the person who invited you.";
const UNAVAILABLE_MESSAGE = "Access codes can't be checked right now. Try again in a minute.";

function page(title: string, message: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="font-family: system-ui, sans-serif; margin: 4rem auto; max-width: 26rem;">
    <h1 style="font-size: 1.25rem;">${title}</h1>
    <p>${message}</p>
    <p><a href="/enter">Try again</a></p>
  </body>
</html>
`;
}

function refuse(request: Request, status: 401 | 503): NextResponse {
  const message = status === 401 ? DENIED_MESSAGE : UNAVAILABLE_MESSAGE;
  const title = status === 401 ? "Code not recognised" : "Try again in a minute";
  return wantsJson(request)
    ? NextResponse.json({ error: message }, { status })
    : new NextResponse(page(title, message), {
        status,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
}

async function enter(request: Request, secret: string, codeKey: string | null) {
  const response = wantsJson(request)
    ? NextResponse.json({ ok: true })
    : NextResponse.redirect(new URL("/", request.url), 303);

  response.cookies.set(SESSION_COOKIE_NAME, await signSession(secret, { codeKey }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}

export async function POST(request: Request) {
  const secret = process.env.PASSCODE_COOKIE_SECRET;

  if (!secret) {
    // Misconfiguration, not a bad code: fail closed and say so without
    // revealing anything else.
    return NextResponse.json(
      { error: "Access is not configured on this deployment." },
      { status: 500 },
    );
  }

  const typed = await readTypedCode(request);

  // isValidPasscode rejects an empty typed value and an unset OPERATOR_PASSCODE.
  if (isValidPasscode(typed, process.env.OPERATOR_PASSCODE)) {
    return enter(request, secret, null);
  }

  const normalized = normalizeAccessCode(typed);
  if (!isAccessCodeShape(normalized)) return refuse(request, 401);

  const codeKey = await accessCodeKey(normalized);
  let verdict;
  try {
    verdict = budgetVerdict(await supabaseBudgetLedger().read(codeKey));
  } catch (error) {
    // The error code only: never the typed text, the code or the key.
    console.warn(
      "enter: budget ledger read failed",
      error instanceof BudgetLedgerError ? (error.code ?? "unknown") : "unexpected",
    );
    return refuse(request, 503);
  }

  if (verdict === "inactive") return refuse(request, 401);
  return enter(request, secret, codeKey);
}
