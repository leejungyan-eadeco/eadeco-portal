// Passwords the portal must send to other systems (parking portal accounts), encrypted at rest.
// AES-256-GCM with CREDENTIALS_KEY from .env, so a database copy alone doesn't reveal them.
// Changing the key makes saved passwords unreadable: they then have to be typed in again.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const k = Buffer.from(process.env.CREDENTIALS_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("Parking setup: CREDENTIALS_KEY in the portal's .env must be 32 random bytes in base64 (IT: openssl rand -base64 32).");
  return k;
}

export function seal(text: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return ["v1", iv, c.getAuthTag(), data].map((p) => (typeof p === "string" ? p : p.toString("base64"))).join(".");
}

export function unseal(sealed: string): string {
  const [v, iv, tag, data] = sealed.split(".");
  if (v !== "v1") throw new Error("Parking setup: the saved password is in an unknown format; type it in again.");
  try {
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch {
    throw new Error("Parking setup: the saved password can't be read (CREDENTIALS_KEY changed?); type it in again.");
  }
}
