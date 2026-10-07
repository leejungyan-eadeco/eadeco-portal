// Sign-in through EADECO's central login (Keycloak, OpenID Connect). Keycloak checks the Windows password (it is
// connected to AD), blocks people without access to the portal, and says which portal role they have.
import * as oidc from "openid-client";
import type { Role } from "./users";

// PKCE verifier, state and where to go afterwards, kept for the 10 minutes between leaving for Keycloak and coming back.
export const LOGIN_COOKIE = "eadepro_login";
// Keycloak's ID token, sent back on sign-out so Keycloak ends its session without asking "are you sure?".
export const ID_TOKEN_COOKIE = "eadepro_id_token";

export const cookieOptions = { httpOnly: true, sameSite: "lax", secure: process.env.COOKIE_SECURE === "true", path: "/" } as const;

const clientId = () => process.env.OIDC_CLIENT_ID ?? "";

let config: Promise<oidc.Configuration> | undefined;

// Keycloak's endpoints, read once from OIDC_ISSUER/.well-known/openid-configuration (retried if that failed).
export function oidcConfig(): Promise<oidc.Configuration> {
  const issuer = process.env.OIDC_ISSUER;
  const secret = process.env.OIDC_CLIENT_SECRET;
  if (!issuer || !clientId() || !secret) throw new Error("OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET must be set in .env.");
  // Plain http is only acceptable for a Keycloak on this machine while testing.
  const options = issuer.startsWith("http://") ? { execute: [oidc.allowInsecureRequests] } : undefined;
  config ??= oidc.discovery(new URL(issuer), clientId(), secret, undefined, options).catch((e) => {
    config = undefined;
    throw e;
  });
  return config;
}

// Only paths on this site: resolve like a browser would (it drops tabs/newlines, so "/\t/evil.com" means //evil.com).
export const safeNext = (n: string) => {
  const u = new URL(n, "http://portal.invalid");
  return u.origin === "http://portal.invalid" ? u.pathname + u.search : "/";
};

// The portal role from Keycloak's client roles for this app. Admin and user are bundles in Keycloak, so an admin
// also carries "user"; null means no portal role at all.
export function portalRole(accessToken: string): Role | null {
  // Read without re-checking the signature: the token came straight from Keycloak's token endpoint, not via the browser.
  const claims = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8"));
  const roles: unknown = claims.resource_access?.[clientId()]?.roles;
  if (!Array.isArray(roles)) return null;
  return roles.includes("admin") ? "admin" : roles.includes("user") ? "user" : null;
}
