"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import * as oidc from "openid-client";
import { ID_TOKEN_COOKIE, oidcConfig } from "@/lib/oidc";
import { SESSION_COOKIE } from "@/lib/session";

// Ends the portal session and the Keycloak session too; otherwise "Sign in" would let them straight back in.
export async function logout() {
  const jar = await cookies();
  const idToken = jar.get(ID_TOKEN_COOKIE)?.value;
  jar.delete(SESSION_COOKIE);
  jar.delete(ID_TOKEN_COOKIE);

  const back = new URL("/login?signedout=1", (await headers()).get("origin") ?? "http://localhost").href;
  let target = back;
  try {
    target = oidc.buildEndSessionUrl(await oidcConfig(), { post_logout_redirect_uri: back, ...(idToken ? { id_token_hint: idToken } : {}) }).href;
  } catch (e) {
    console.error("Could not reach Keycloak to sign out there:", e);
  }
  redirect(target);
}
