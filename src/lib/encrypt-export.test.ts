import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Decrypter } from "age-encryption";
import { MIN_PASSPHRASE, SCRYPT_LOG_N, encryptExport, passphraseError } from "./encrypt-export";

const header = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1").split("\n").slice(0, 2);

describe("passphraseError", () => {
  it("needs 12+ characters and a matching confirmation", () => {
    assert.equal(MIN_PASSPHRASE, 12);
    assert.equal(passphraseError("a".repeat(11), "a".repeat(11)), "Use at least 12 characters. Four or five random words work well.");
    assert.equal(passphraseError("a".repeat(12), "a".repeat(12)), null);
    assert.equal(passphraseError("a".repeat(12), "b".repeat(12)), "The two passphrases do not match.");
  });
});

describe("encryptExport", () => {
  it("writes an age v1 file with a scrypt stanza that the passphrase decrypts", async () => {
    const bytes = await encryptExport('{"kind":"family-emergency-file"}', "correct horse battery", 4);
    const [version, stanza] = header(bytes);
    assert.equal(version, "age-encryption.org/v1");
    assert.match(stanza, /^-> scrypt \S+ 4$/);
    const d = new Decrypter();
    d.addPassphrase("correct horse battery");
    assert.equal(await d.decrypt(bytes, "text"), '{"kind":"family-emergency-file"}');
    const wrong = new Decrypter();
    wrong.addPassphrase("wrong horse battery");
    await assert.rejects(() => wrong.decrypt(bytes, "text"));
  });

  it("uses age's default scrypt work factor unless told otherwise", async () => {
    assert.equal(SCRYPT_LOG_N, 18);
    const [, stanza] = header(await encryptExport("{}", "correct horse battery"));
    assert.match(stanza, / 18$/);
  });
});
