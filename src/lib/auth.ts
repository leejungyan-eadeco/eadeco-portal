// Who is signed in, for server components and server actions: a valid token AND still active on the user list.
import { cookies } from "next/headers";
import { readToken, SESSION_COOKIE } from "./session";
import { access, type Role } from "./users";

export type CurrentUser = { username: string; name: string; role: Role };

export async function currentUser(): Promise<CurrentUser | null> {
  const token = await readToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!token) return null;
  const a = await access(token.username);
  return a ? { username: token.username, name: a.name, role: a.role } : null;
}
