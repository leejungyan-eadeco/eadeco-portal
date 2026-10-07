// Signed login token kept in an httpOnly cookie. Valid for 1 day; no server-side session table.
// ponytail: stateless token, so a disabled AD account keeps access until its token expires (max 24h).
// Add a sessions table if instant sign-out of others is ever needed.

export const SESSION_COOKIE = "eadepro_session";
export const SESSION_HOURS = 24;

export type SessionUser = { username: string; name: string };

const enc = new TextEncoder();

async function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be set in .env (32+ characters).");
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function createToken(user: SessionUser): Promise<string> {
  const payload = Buffer.from(JSON.stringify({ ...user, exp: Date.now() + SESSION_HOURS * 3_600_000 })).toString("base64url");
  const sig = Buffer.from(await crypto.subtle.sign("HMAC", await key(), enc.encode(payload))).toString("base64url");
  return `${payload}.${sig}`;
}

// Returns the user for a valid, unexpired token; null for anything else.
export async function readToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", await key(), Buffer.from(sig, "base64url"), enc.encode(payload));
    if (!valid) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof data.exp === "number" && data.exp > Date.now() ? { username: String(data.username), name: String(data.name) } : null;
  } catch {
    return null;
  }
}
