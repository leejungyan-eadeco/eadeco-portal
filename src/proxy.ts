// Runs before every request: a valid login token, an active entry on the user list, and admin for /settings.
import { NextResponse, type NextRequest } from "next/server";
import { readToken, SESSION_COOKIE } from "./lib/session";
import { access } from "./lib/users";

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const token = await readToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = token ? await access(token.username) : null;

  if (path === "/login") return user ? NextResponse.redirect(new URL("/", req.url)) : NextResponse.next();

  if (!user) {
    const url = new URL("/login", req.url);
    const back = path + req.nextUrl.search;
    if (back !== "/") url.searchParams.set("next", back);
    if (token) url.searchParams.set("removed", "1"); // signed in, but taken off the list
    const res = NextResponse.redirect(url);
    if (token) res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  // Settings (companies, NAV connection, users) are for admins only.
  if (path.startsWith("/settings") && user.role !== "admin") return NextResponse.redirect(new URL("/", req.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo.png|logo-mark.png).*)"],
};
