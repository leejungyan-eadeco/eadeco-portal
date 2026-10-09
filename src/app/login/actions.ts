"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adLogin, LoginError } from "@/lib/ad";
import { createToken, SESSION_COOKIE, SESSION_HOURS } from "@/lib/session";
import { admit } from "@/lib/users";

// Only same-site paths, so a crafted link cannot bounce people to another site after signing in.
// Only paths on this site: resolve like a browser would (it drops tabs/newlines, so "/\t/evil.com" means //evil.com).
const safeNext = (n: string) => {
  const u = new URL(n, "http://portal.invalid");
  return u.origin === "http://portal.invalid" ? u.pathname + u.search : "/";
};

// Returns the error to show plus the username, so the form can keep it after a failed attempt.
export type LoginState = { error: string; username: string } | null;

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const next = safeNext(String(form.get("next") ?? "/"));
  const username = String(form.get("username") ?? "");
  try {
    const user = await adLogin(username, String(form.get("password") ?? ""));
    // AD said the password is right; the portal's user list decides whether they get in.
    if (!(await admit(user))) throw new LoginError("Your Windows account works, but you don't have access to the portal yet. Ask an admin to add you.");
    (await cookies()).set(SESSION_COOKIE, await createToken({ username: user.username, name: user.name }), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.COOKIE_SECURE === "true",
      path: "/",
      maxAge: SESSION_HOURS * 3600,
    });
  } catch (e) {
    if (e instanceof LoginError) return { error: e.message, username };
    console.error("Login failed:", e);
    return { error: "Could not reach the domain controller. Try again, or contact IT if it keeps happening.", username };
  }
  redirect(next);
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
