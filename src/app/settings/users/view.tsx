"use client";

import { useMemo } from "react";
import type { PortalUser } from "@/lib/users";
import { columnHelper, DataTable, type Columns } from "../../data-table";
import { fmtDateTime, PageHeader, panel, StatusBadge } from "../../ui";

const col = columnHelper<PortalUser>();

// Read-only: who may use the portal and with which role is decided in Keycloak (client "eadepro-portal",
// roles "user" and "admin"). This list shows what Keycloak said at each person's last sign-in.
export function UsersView({ users, me }: { users: PortalUser[]; me: string }) {
  const columns = useMemo<Columns<PortalUser>>(
    () => [
      col.accessor((u) => `${u.displayName ?? ""} ${u.username} ${u.email ?? ""}`, {
        id: "name",
        header: "Name",
        cell: ({ row: { original: u } }) => (
          <>
            <div className="font-medium">
              {u.displayName ?? u.username}
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
    ],
    [me],
  );

  return (
    <>
      <PageHeader
        title="Users"
        description="Everyone who has signed in. Access and roles are managed centrally in Keycloak (app: eadepro-portal); changes apply at the person's next sign-in."
      />
      <section className={panel}>
        <DataTable data={users} columns={columns} minWidth={640} search="Search name, username or email" empty={{ title: "No one has signed in yet", hint: "People appear here after their first sign-in." }} />
      </section>
    </>
  );
}
