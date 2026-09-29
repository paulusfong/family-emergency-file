import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";
import { middleware, config } from "./middleware";

function req(path: string, cookie?: string) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(new URL(path, "http://localhost:3000"), { headers });
}

describe("middleware", () => {
  it("redirects unauthenticated /app to sign-in", () => {
    const res = middleware(req("http://localhost:3000/app"));
    assert.equal(res.status, 307);
    assert.match(res.headers.get("location") ?? "", /\/sign-in\?next=/);
  });

  it("allows request when session cookie present", () => {
    const res = middleware(
      req("http://localhost:3000/app", "better-auth.session_token=abc"),
    );
    assert.equal(res.status, 200);
  });

  it("allows request when secure session cookie present", () => {
    const res = middleware(
      req("http://localhost:3000/app/settings", "__Secure-better-auth.session_token=abc"),
    );
    assert.equal(res.status, 200);
  });

  it("exports matcher config", () => {
    assert.ok(config.matcher.includes("/app"));
  });
});
