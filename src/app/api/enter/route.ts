import { NextResponse } from "next/server";

import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  isValidPasscode,
  signSession,
} from "@/lib/passcode";

/**
 * Checks the shared passcode and, on success, sets the signed session cookie.
 *
 * Stateless by design: nothing is persisted and the submitted passcode is
 * never logged (PRD: no user data stored server-side).
 */

async function readPasscode(request: Request): Promise<string> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body: unknown = await request.json();
      const passcode =
        typeof body === "object" && body !== null
          ? (body as Record<string, unknown>).passcode
          : undefined;
      return typeof passcode === "string" ? passcode : "";
    } catch {
      return "";
    }
  }
  const form = await request.formData();
  const passcode = form.get("passcode");
  return typeof passcode === "string" ? passcode : "";
}

function wantsJson(request: Request): boolean {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return true;
  return (request.headers.get("accept") ?? "").includes("application/json");
}

const DENIED_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Incorrect passcode</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="font-family: system-ui, sans-serif; margin: 4rem auto; max-width: 26rem;">
    <h1 style="font-size: 1.25rem;">Incorrect passcode</h1>
    <p><a href="/enter">Try again</a></p>
  </body>
</html>
`;

export async function POST(request: Request) {
  const secret = process.env.PASSCODE_COOKIE_SECRET;
  const expected = process.env.APP_PASSCODE;

  if (!secret || !expected) {
    // Misconfiguration, not a bad passcode: fail closed and say so without
    // revealing anything about the expected value.
    return NextResponse.json(
      { error: "Access is not configured on this deployment." },
      { status: 500 },
    );
  }

  const submitted = await readPasscode(request);
  if (!isValidPasscode(submitted, expected)) {
    return wantsJson(request)
      ? NextResponse.json({ error: "Incorrect passcode." }, { status: 401 })
      : new NextResponse(DENIED_HTML, {
          status: 401,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
  }

  const response = wantsJson(request)
    ? NextResponse.json({ ok: true })
    : NextResponse.redirect(new URL("/", request.url), 303);

  response.cookies.set(SESSION_COOKIE_NAME, await signSession(secret), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
