// Sends the browser to Keycloak's sign-in page. Someone already signed in to another EADECO app comes straight back.
import { NextResponse, type NextRequest } from "next/server";
import * as oidc from "openid-client";
import { cookieOptions, LOGIN_COOKIE, oidcConfig, safeNext } from "@/lib/oidc";

export async function GET(req: NextRequest) {
  const next = safeNext(req.nextUrl.searchParams.get("next") ?? "/");
  try {
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const url = oidc.buildAuthorizationUrl(await oidcConfig(), {
      redirect_uri: new URL("/auth/callback", req.url).href,
      scope: "openid",
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      state,
    });
    const res = NextResponse.redirect(url);
    res.cookies.set(LOGIN_COOKIE, JSON.stringify({ verifier, state, next }), { ...cookieOptions, path: "/auth", maxAge: 600 });
    return res;
  } catch (e) {
    console.error("Could not reach Keycloak:", e);
    return NextResponse.redirect(new URL("/login?error=unreachable", req.url));
  }
}
