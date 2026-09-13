import { describe, expect, it } from "vitest";

import { MAX_DURATION_SECONDS } from "@/lib/llm";

import { maxDuration, POST } from "./route";

describe("POST /api/turn", () => {
  it("keeps the segment config literal equal to MAX_DURATION_SECONDS", () => {
    expect(maxDuration).toBe(MAX_DURATION_SECONDS);
  });

  it("returns 400 for a body that is not JSON", async () => {
    const res = await POST(new Request("http://localhost/api/turn", { method: "POST", body: "nope" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a JSON body that is not a turn request, without echoing it", async () => {
    const res = await POST(
      new Request("http://localhost/api/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "not-hex", step: "cards", profileMd: "SECRET", messages: [], input: { kind: "message", content: "hi" } }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("SECRET");
  });
});
