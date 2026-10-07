// The portal's copy of who may sign in. Keycloak decides access and role; each sign-in writes them here, and every
// request checks this list.
import { db } from "./db";

export type Role = "admin" | "user";
export type PortalUser = {
  username: string;
  displayName: string | null;
  email: string | null;
  role: Role;
  active: boolean;
  invitedBy: string;
  createdAt: string;
  lastLoginAt: string | null;
};

// "EADECO\jenyee", "jenyee@eadeco.com.my" or "JenYee" all mean the AD account "jenyee".
export const toUsername = (input: string) => input.trim().replace(/^.*\\/, "").replace(/@.*$/, "").toLowerCase();
export const isUsername = (u: string) => /^[a-z0-9._-]{1,64}$/.test(u);

// Called after Keycloak signed someone in. Name, email and role come from Keycloak; role null means Keycloak no
// longer gives them the portal, so they are marked inactive (an existing session in another tab stops too).
export async function recordSignIn(u: { username: string; name: string; email: string; role: Role | null }) {
  if (!u.role) {
    await db.query(`update users set active = false where username = $1`, [u.username]);
    return;
  }
  await db.query(
    `insert into users (username, display_name, email, role, active, invited_by, last_login_at) values ($1, $2, nullif($3, ''), $4, true, 'keycloak', now())
     on conflict (username) do update set display_name = excluded.display_name, email = excluded.email, role = excluded.role, active = true, last_login_at = now()`,
    [u.username, u.name, u.email, u.role],
  );
}

// Checked on every request. Changes made in Keycloak arrive at the person's next sign-in (sessions last SESSION_HOURS).
export async function access(username: string): Promise<{ role: Role; name: string } | null> {
  const { rows } = await db.query<{ role: Role; name: string }>(`select role, coalesce(display_name, username) as name from users where username = $1 and active`, [username]);
  return rows[0] ?? null;
}

export async function listUsers(): Promise<PortalUser[]> {
  const { rows } = await db.query(
    `select username, display_name as "displayName", email, role, active, invited_by as "invitedBy",
            to_char(created_at at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM-DD"T"HH24:MI') as "createdAt",
            to_char(last_login_at at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM-DD"T"HH24:MI') as "lastLoginAt"
     from users order by active desc, role, coalesce(display_name, username)`,
  );
  return rows;
}
