// Keycloak sends people back here after signing in: swap the one-time code for tokens, take the role, start a session.
import { NextResponse, type NextRequest } from "next/server";
import * as oidc from "openid-client";
import { cookieOptions, ID_TOKEN_COOKIE, LOGIN_COOKIE, oidcConfig, portalRole } from "@/lib/oidc";
import { createToken, SESSION_COOKIE, SESSION_HOURS } from "@/lib/session";
import { isUsername, recordSignIn, toUsername } from "@/lib/users";

export async function GET(req: NextRequest) {
  const fail = (error: string) => {
    const res = NextResponse.redirect(new URL(`/login?error=${error}`, req.url));
    res.cookies.delete({ name: LOGIN_COOKIE, path: "/auth" });
    return res;
  };

  let saved: { verifier: string; state: string; next: string };
  try {
    saved = JSON.parse(req.cookies.get(LOGIN_COOKIE)?.value ?? "");
  } catch {
    return fail("expired"); // took over 10 minutes, or came back in a different browser
  }

  try {
    // Checks the state, the PKCE verifier and the ID token's signature, issuer, audience and expiry.
    const tokens = await oidc.authorizationCodeGrant(await oidcConfig(), new URL(req.url), { pkceCodeVerifier: saved.verifier, expectedState: saved.state });
    const claims = tokens.claims();
    const username = toUsername(String(claims?.preferred_username ?? ""));
    if (!isUsername(username)) return fail("account");

    const role = portalRole(tokens.access_token);
    await recordSignIn({ username, name: String(claims?.name || username), email: String(claims?.email ?? ""), role });
    if (!role) return fail("no-access"); // Keycloak normally stops these people before they get here

    const res = NextResponse.redirect(new URL(saved.next, req.url));
    res.cookies.delete({ name: LOGIN_COOKIE, path: "/auth" });
    res.cookies.set(SESSION_COOKIE, await createToken({ username, name: String(claims?.name || username) }), { ...cookieOptions, maxAge: SESSION_HOURS * 3600 });
    if (tokens.id_token) res.cookies.set(ID_TOKEN_COOKIE, tokens.id_token, { ...cookieOptions, maxAge: SESSION_HOURS * 3600 });
    return res;
  } catch (e) {
    console.error("Sign-in callback failed:", e);
    return fail("failed");
  }
}
