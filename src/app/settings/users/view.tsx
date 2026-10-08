"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { UserPlus } from "@phosphor-icons/react";
import type { DirectoryUser } from "@/lib/directory";
import type { PortalUser, Role } from "@/lib/users";
import { getDirectoryUsers, inviteUser, removeUser, updateUser } from "../../actions";
import { columnHelper, DataTable, RowActions, type Columns } from "../../data-table";
import { Confirm, Dialog, ErrorNote } from "../../dialog";
import { SearchSelect } from "../../select";
import { btn, Field, field, fmtDateTime, PageHeader, panel, StatusBadge, Toggle } from "../../ui";

const roles = [
  { value: "user", label: "User" },
  { value: "admin", label: "Admin" },
];

function InviteForm({ taken, onClose }: { taken: string[]; onClose: () => void }) {
  const [who, setWho] = useState("");
  // null while loading; if AD cannot be read, fall back to typing the username.
  const [directory, setDirectory] = useState<DirectoryUser[] | null>(null);
  const [directoryError, setDirectoryError] = useState("");
  useEffect(() => {
    getDirectoryUsers().then((r) => (r.ok ? setDirectory(r.data) : setDirectoryError(r.error)));
  }, []);
  const options = (directory ?? [])
    .filter((d) => !taken.includes(d.username))
    .map((d) => ({ value: d.username, label: `${d.name} (${d.username})`, search: `${d.email} ${d.ou}` }));
  const picked = directory?.find((d) => d.username === who);
  const [role, setRole] = useState<Role>("user");
  const [error, setError] = useState("");
  const [saving, start] = useTransition();
  const save = () =>
    start(async () => {
      const r = await inviteUser(who, role);
      if (r.ok) onClose();
      else setError(r.error);
    });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Invite user"
      footer={
        <>
          <button className={`${btn.primary} disabled:pointer-events-none disabled:opacity-50`} disabled={!who.trim() || saving} onClick={save}>
            {saving ? "Adding" : "Add to portal"}
          </button>
          <button className={btn.secondary} onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <form className="grid gap-5" onSubmit={(e) => (e.preventDefault(), save())}>
        {error && <ErrorNote>{error}</ErrorNote>}
        {directoryError ? (
          <Field label="Windows username or email" required hint={`${directoryError} Type the username instead, e.g. jenyee or jenyee@eadeco.com.my.`}>
            <input className={field} value={who} onChange={(e) => setWho(e.target.value)} autoFocus autoCapitalize="none" spellCheck={false} />
          </Field>
        ) : (
          <Field as="div" label="User" required>
            <SearchSelect label="User" placeholder={directory ? "Search by name, username or email" : "Loading EADECO users"} value={who} disabled={!directory} options={options} onChange={setWho} />
          </Field>
        )}
        {picked && (
          <Field label="Email">
            <input className={field} value={picked.email || "None in AD"} disabled />
          </Field>
        )}
        <Field as="div" label="Role" required hint="Admins also manage companies, the NAV connection, the scheduler and users.">
          <SearchSelect label="Role" value={role} onChange={(v) => setRole(v as Role)} options={roles} />
        </Field>
      </form>
    </Dialog>
  );
}

// Edit in a small pop-up, like Remove. You, and the .env admins, keep their role and access: there is always an admin left.
function EditUserForm({ user: u, fixed, onClose }: { user: PortalUser; fixed: string; onClose: () => void }) {
  const [displayName, setDisplayName] = useState(u.displayName ?? "");
  const [email, setEmail] = useState(u.email ?? "");
  const [role, setRole] = useState<Role>(u.role);
  const [active, setActive] = useState(u.active);
  const [error, setError] = useState("");
  const [saving, start] = useTransition();
  const save = () =>
    start(async () => {
      const r = await updateUser(u.username, { displayName, email, ...(fixed ? {} : { role, active }) });
      if (r.ok) onClose();
      else setError(r.error);
    });

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Edit ${u.displayName ?? u.username}`}
      footer={
        <>
          <button className={`${btn.primary} disabled:pointer-events-none disabled:opacity-50`} disabled={saving} onClick={save}>
            {saving ? "Saving" : "Save changes"}
          </button>
          <button className={btn.secondary} onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <form className="grid gap-5" onSubmit={(e) => (e.preventDefault(), save())}>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label="Windows account" hint="Cannot change. Invite a new user for a different account.">
          <input className={field} value={`EADECO\\${u.username}`} disabled />
        </Field>
        <Field label="Name" hint="Filled from AD at first sign-in. Your change is kept after that.">
          <input className={field} value={displayName} maxLength={100} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label="Email">
          <input className={field} type="email" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field as="div" label="Role" hint={fixed || "Admins also manage companies, the NAV connection, the scheduler and users."}>
          <SearchSelect label="Role" value={role} disabled={!!fixed} onChange={(v) => setRole(v as Role)} options={roles} />
        </Field>
        <div className="flex items-center gap-3 text-sm">
          <Toggle checked={active} disabled={!!fixed} onChange={setActive} label="Active" />
          {active ? "Active: can sign in" : "Inactive: cannot sign in, but stays on the list"}
        </div>
      </form>
    </Dialog>
  );
}

const col = columnHelper<PortalUser>();

export function UsersView({ users, me, bootstrap }: { users: PortalUser[]; me: string; bootstrap: string[] }) {
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<PortalUser | null>(null);
  const [removing, setRemoving] = useState<PortalUser | null>(null);

  // Why someone's role and access are locked, or "" when they are not.
  const fixed = (u: PortalUser) =>
    u.username === me ? "You can't change your own role or access. Ask another admin." : bootstrap.includes(u.username) ? "Admin set in the server's .env (BOOTSTRAP_ADMINS)." : "";

  const columns = useMemo<Columns<PortalUser>>(
    () => [
      col.accessor((u) => `${u.displayName ?? ""} ${u.username} ${u.email ?? ""}`, {
        id: "name",
        header: "Name",
        cell: ({ row: { original: u } }) => (
          <>
            <div className="font-medium">
              {u.displayName ?? <span className="text-ink-3">Waiting for first sign-in</span>}
              {u.username === me && <span className="ml-2 text-xs font-normal text-ink-3">(you)</span>}
            </div>
            <div className="text-xs text-ink-3">
              EADECO\{u.username}
              {u.email ? ` · ${u.email}` : ""}
            </div>
          </>
        ),
      }),
      col.accessor((u) => (u.role === "admin" ? "Admin" : "User"), {
        id: "role",
        header: "Role",
        meta: { filter: "roles" },
        cell: (c) => <StatusBadge status={c.getValue()} />,
      }),
      col.accessor((u) => (u.active ? "Active" : "Inactive"), {
        id: "active",
        header: "Status",
        meta: { filter: "statuses" },
        cell: (c) => <StatusBadge status={c.getValue()} />,
      }),
      col.accessor((u) => u.lastLoginAt ?? undefined, {
        id: "lastLogin",
        header: "Last sign-in",
        sortUndefined: "last",
        cell: (c) => <span className="whitespace-nowrap">{c.getValue() ? fmtDateTime(c.getValue()!) : <span className="text-ink-3">Never</span>}</span>,
      }),
      col.accessor((u) => (u.invitedBy === ".env" ? "Server setup" : u.invitedBy), { id: "invitedBy", header: "Added by", cell: (c) => <span className="text-ink-2">{c.getValue()}</span> }),
      col.display({
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row: { original: u } }) => (
          <RowActions name={u.username} onEdit={() => setEditing(u)} onDelete={fixed(u) ? undefined : () => setRemoving(u)} />
        ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [me, bootstrap],
  );

  return (
    <>
      <PageHeader
        title="Users"
        description="Who can use the portal. People sign in with their Windows account; only those listed here get in."
        actions={
          <button className={btn.primary} onClick={() => setInviting(true)}>
            <UserPlus size={16} weight="bold" /> Invite user
          </button>
        }
      />

      <section className={panel}>
        <DataTable data={users} columns={columns} minWidth={760} search="Search name, username or email" empty={{ title: "No users yet", hint: "Invite the first person with Invite user." }} />
      </section>

      {inviting && <InviteForm taken={users.map((u) => u.username)} onClose={() => setInviting(false)} />}
      {editing && <EditUserForm key={editing.username} user={editing} fixed={fixed(editing)} onClose={() => setEditing(null)} />}
      {removing && (
        <Confirm title="Remove from portal?" action="Remove" onClose={() => setRemoving(null)} onConfirm={() => removeUser(removing.username)}>
          <p>
            {removing.displayName ?? removing.username} loses access straight away. Their Windows account is not touched, and you can invite them again later.
          </p>
        </Confirm>
      )}
    </>
  );
}
