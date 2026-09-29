import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";
import { config, proxy } from "./proxy";

function req(path: string, cookie?: string) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(new URL(path, "http://localhost:3000"), { headers });
}

describe("proxy", () => {
  it("redirects unauthenticated /app to sign-in with next param", () => {
    const res = proxy(req("http://localhost:3000/app/settings"));
    assert.equal(res.status, 307);
    assert.equal(
      res.headers.get("location"),
      "http://localhost:3000/sign-in?next=%2Fapp%2Fsettings",
    );
  });

  it("allows request when session cookie present", () => {
    const res = proxy(req("http://localhost:3000/app", "better-auth.session_token=abc"));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("location"), null);
  });

  it("allows request when secure session cookie present", () => {
    const res = proxy(
      req("http://localhost:3000/app/settings", "__Secure-better-auth.session_token=abc"),
    );
    assert.equal(res.status, 200);
  });

  it("matches /app and nested /app paths only", () => {
    assert.deepEqual(config.matcher, ["/app", "/app/:path*"]);
  });
});
