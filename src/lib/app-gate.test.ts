import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SESSION_COOKIE_NAMES,
  hasSessionCookie,
  signInRedirectUrl,
} from "./app-gate";

describe("app-gate", () => {
  it("detects plain and secure session cookies", () => {
    assert.equal(hasSessionCookie(() => undefined), false);
    assert.equal(
      hasSessionCookie((name) =>
        name === "better-auth.session_token" ? { value: "tok" } : undefined,
      ),
      true,
    );
    assert.equal(
      hasSessionCookie((name) =>
        name === "__Secure-better-auth.session_token" ? { value: "tok" } : undefined,
      ),
      true,
    );
    assert.equal(
      hasSessionCookie((name) =>
        name === "better-auth.session_token" ? { value: "" } : undefined,
      ),
      false,
    );
  });

  it("builds sign-in redirect with next param", () => {
    const url = signInRedirectUrl("http://localhost:3000/app", "/app/settings");
    assert.equal(url, "http://localhost:3000/sign-in?next=%2Fapp%2Fsettings");
  });

  it("exports both cookie names", () => {
    assert.equal(SESSION_COOKIE_NAMES.length, 2);
  });
});
