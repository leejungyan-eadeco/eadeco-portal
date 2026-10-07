// The portal's own user list: AD checks the password, this list decides who gets in and with which role.
import { db } from "./db";
import type { AdUser } from "./ad";

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

export const bootstrapAdmins = () => (process.env.BOOTSTRAP_ADMINS ?? "").split(",").map(toUsername).filter(Boolean);

// Called after AD accepted the password. Returns the role, or null when the person is not on the list.
export async function admit(u: AdUser): Promise<Role | null> {
  if (bootstrapAdmins().includes(u.username)) {
    // Break-glass: .env admins are always active admins.
    await db.query(
      `insert into users (username, role, active, invited_by) values ($1, 'admin', true, '.env')
       on conflict (username) do update set role = 'admin', active = true`,
      [u.username],
    );
  }
  const { rows } = await db.query<{ role: Role }>(
    // Name and email come from AD the first time only, so an admin's edits are kept.
    `update users set display_name = coalesce(display_name, $2), email = coalesce(email, nullif($3, '')), last_login_at = now() where username = $1 and active returning role`,
    [u.username, u.name, u.email],
  );
  return rows[0]?.role ?? null;
}

// Checked on every request, so removing someone or changing their role takes effect immediately.
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
