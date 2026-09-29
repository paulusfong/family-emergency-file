import { Encrypter } from "age-encryption";

/**
 * Passphrase-protected export in the age format (https://age-encryption.org/v1):
 * scrypt passphrase stanza, ChaCha20-Poly1305 payload. Runs in the browser, so
 * the passphrase never leaves the device. Decrypt with the reference CLI:
 * `age -d family-emergency-file-YYYY-MM-DD.json.age > file.json`.
 */
export const MIN_PASSPHRASE = 12;
/** age's scrypt work factor (2^18); the reference implementation's default. */
export const SCRYPT_LOG_N = 18;

export function passphraseError(passphrase: string, confirm: string) {
  if (passphrase.length < MIN_PASSPHRASE) {
    return `Use at least ${MIN_PASSPHRASE} characters. Four or five random words work well.`;
  }
  return passphrase === confirm ? null : "The two passphrases do not match.";
}

export async function encryptExport(plaintext: string, passphrase: string, logN = SCRYPT_LOG_N) {
  const encrypter = new Encrypter();
  encrypter.setPassphrase(passphrase);
  encrypter.setScryptWorkFactor(logN);
  return encrypter.encrypt(plaintext);
}
