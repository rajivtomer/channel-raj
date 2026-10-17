import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

let cachedKey: Buffer | undefined;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  let raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ENCRYPTION_KEY must be set in production.");
    }
    const file = path.join(process.cwd(), ".data", "dev-encryption-key");
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, randomBytes(32).toString("base64"), { mode: 0o600 });
    }
    raw = fs.readFileSync(file, "utf8").trim();
  }
  let key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    // Accept any long random string (hex, passphrase-style generators) by hashing it to 32 bytes.
    if (raw.length < 32) throw new Error("ENCRYPTION_KEY must be at least 32 characters.");
    key = createHash("sha256").update(raw).digest();
  }
  cachedKey = key;
  return key;
}

/** AES-256-GCM. Output is "v1.<iv>.<tag>.<ciphertext>" in base64url. */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", loadKey(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decrypt(payload: string): string {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== "v1" || !iv || !tag || data === undefined) throw new Error("Unrecognised encrypted payload.");
  const decipher = createDecipheriv("aes-256-gcm", loadKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Shows only the last few characters of a secret, for display. */
export function mask(value: string, visible = 4): string {
  if (value.length <= visible) return "•".repeat(value.length);
  return "•".repeat(Math.min(12, value.length - visible)) + value.slice(-visible);
}
