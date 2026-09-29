import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { isProductionMailEnv, mailFrom, sendMail } from "./mail";

const originalCwd = process.cwd();
const originalFetch = globalThis.fetch;

afterEach(() => {
  process.chdir(originalCwd);
  globalThis.fetch = originalFetch;
});

describe("mail helpers", () => {
  it("mailFrom uses env or default", () => {
    assert.equal(mailFrom({ MAIL_FROM: "Custom <c@x>" }), "Custom <c@x>");
    assert.match(mailFrom({}), /Family Emergency File/);
  });

  it("isProductionMailEnv for production and Vercel", () => {
    assert.equal(isProductionMailEnv({ NODE_ENV: "production" }), true);
    assert.equal(isProductionMailEnv({ VERCEL: "1", NODE_ENV: "test" }), true);
    assert.equal(isProductionMailEnv({ NODE_ENV: "development" }), false);
    assert.equal(isProductionMailEnv({}), false);
  });
});

describe("sendMail", () => {
  it("throws in production when RESEND_API_KEY is missing", async () => {
    await assert.rejects(
      () => sendMail("a@b.co", "s", "body", { NODE_ENV: "production" }),
      /RESEND_API_KEY is required in production/,
    );
  });

  it("throws when VERCEL=1 and RESEND_API_KEY is missing", async () => {
    await assert.rejects(
      () => sendMail("a@b.co", "s", "body", { VERCEL: "1", NODE_ENV: "test" }),
      /RESEND_API_KEY is required in production/,
    );
  });

  it("posts to Resend when API key is set (ok)", async () => {
    const calls: unknown[] = [];
    globalThis.fetch = (async (url, init) => {
      calls.push({ url, init });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    await sendMail("a@b.co", "Sub", "Text", {
      RESEND_API_KEY: "rk_test",
      NODE_ENV: "production",
      MAIL_FROM: "FEF <f@x>",
    });
    assert.equal(calls.length, 1);
    const c = calls[0] as { url: string; init: RequestInit };
    assert.equal(c.url, "https://api.resend.com/emails");
    assert.equal(c.init.method, "POST");
    const headers = c.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer rk_test");
    assert.equal(headers["Content-Type"], "application/json");
    const body = JSON.parse(String(c.init.body));
    assert.equal(body.from, "FEF <f@x>");
    assert.equal(body.to, "a@b.co");
    assert.equal(body.subject, "Sub");
    assert.equal(body.text, "Text");
  });

  it("does not log an error when Resend returns OK", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      await sendMail("a@b.co", "Sub", "Text", { RESEND_API_KEY: "rk_test", NODE_ENV: "test" });
    } finally {
      console.error = orig;
    }
    assert.equal(errors.length, 0);
  });

  it("logs status (never the body) and throws when Resend returns non-OK", async () => {
    globalThis.fetch = (async () => new Response("nope", { status: 500 })) as typeof fetch;
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      await assert.rejects(
        () => sendMail("a@b.co", "Sub", "Text", { RESEND_API_KEY: "rk_test", NODE_ENV: "test" }),
        /Resend failed with status 500/,
      );
    } finally {
      console.error = orig;
    }
    assert.deepEqual(errors, [["Resend failed", 500]]);
  });

  it("writes last-magic-link.txt in non-production when body has a URL", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fef-mail-"));
    process.chdir(dir);
    const logs: unknown[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args);
    };
    try {
      await sendMail(
        "dev@example.com",
        "Hello",
        "Sign in: http://localhost:3000/sign-in/confirm?token=abc",
        { NODE_ENV: "development" },
      );
    } finally {
      console.log = orig;
    }
    const out = path.join(dir, "tmp", "last-magic-link.txt");
    assert.ok(fs.existsSync(out));
    assert.match(fs.readFileSync(out, "utf8"), /token=abc/);
    assert.equal(logs.length, 1);
    const line = String((logs[0] as unknown[])[0]);
    assert.match(line, /\[mail:dev\] To: dev@example\.com/);
    assert.match(line, /Subject: Hello/);
    assert.match(line, /token=abc/);
  });

  it("does not write a file when body has no URL", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fef-mail-"));
    process.chdir(dir);
    const orig = console.log;
    console.log = () => {};
    try {
      await sendMail("dev@example.com", "Hello", "no link here", { NODE_ENV: "development" });
    } finally {
      console.log = orig;
    }
    assert.equal(fs.existsSync(path.join(dir, "tmp", "last-magic-link.txt")), false);
  });

  it("uses process.env default when env arg omitted", async () => {
    const orig = console.log;
    const origKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    console.log = () => {};
    try {
      await sendMail("x@y.z", "s", "plain text only");
    } finally {
      console.log = orig;
      if (origKey !== undefined) process.env.RESEND_API_KEY = origKey;
    }
  });
});
