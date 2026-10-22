/**
 * Per-company API keys are encrypted with AES-256-GCM under APP_ENCRYPTION_KEY
 * (a 32-byte server-only secret). The company id is bound in as additional
 * authenticated data, so a ciphertext copied into another company's row
 * fails to decrypt instead of quietly working.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

function masterKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("APP_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return key;
}

export function encryptSecret(plaintext: string, companyId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  cipher.setAAD(Buffer.from(companyId, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}.${Buffer.concat([iv, tag, ct]).toString("base64url")}`;
}

export function decryptSecret(blob: string, companyId: string): string {
  const [version, body] = blob.split(".");
  if (version !== VERSION || !body) throw new Error("Unrecognised secret format");
  const buf = Buffer.from(body, "base64url");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAAD(Buffer.from(companyId, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function last4(secret: string): string {
  return secret.slice(-4);
}
